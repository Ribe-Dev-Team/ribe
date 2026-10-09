import { Coord, MatchOffer, MatchRunResult, TravelTimeMatrix } from '../src/types';
import {
  batchPoints, groupIntoBatches, MONASH_CLAYTON, offerDeparture, OfferDoc, RequestDoc,
  Skipped, toMatchInputs,
} from '../src/adapter';
import { runMatchingProvisional } from '../src/deferredAcceptance';
import { evaluateRoute, timetableFor } from '../src/route';
import {
  MatchWrite, MatchWriteSkip, ScheduleWrite, Settled, toMatchWrites, toStoredSchedule,
} from '../src/writes';

/**
 * One matching run, start to finish:
 *
 *   1. settle matched requests: expire matches nobody accepted in time,
 *      freeing those drivers' slots, and return riders whose driver removed
 *      the offer to the pool
 *   2. read every request and offer still looking for a match
 *   3. group them into batches - one date, one direction each
 *   4. per batch: build travel times once, convert, fill in the timetable of
 *      any confirmed car missing one, run the matcher, write
 *
 * Storage is behind `MatchingStore` so the whole flow runs against an in-memory
 * store in tests; runner/firestore.ts is the real one.
 */

export interface MatchingStore {
  settleMatched(now: Date): Promise<Settled>;
  loadPending(): Promise<{ requests: RequestDoc[]; offers: OfferDoc[]; }>;
  loadRequestsById(ids: string[]): Promise<Map<string, RequestDoc>>;
  writeMatches(writes: MatchWrite[]): Promise<{
    applied: string[];
    skipped: Array<{ reqId: string; reason: MatchWriteSkip; }>;
  }>;
  /** Returns the offers whose timetable was written. */
  writeSchedules(writes: ScheduleWrite[]): Promise<string[]>;
}

export interface RunOptions {
  now: Date;
  /** Compute and report, but write nothing - not even expiries. */
  dryRun: boolean;
  /** Builds the travel-time matrix for one batch's points. Called once per batch. */
  travelTimes: (points: Coord[]) => Promise<TravelTimeMatrix>;
}

export interface BatchReport {
  batchKey: string;
  requests: number;
  offers: number;
  matches: Array<{
    reqId: string;
    offerId: string;
    riderDetour: number;
    driverAddedMinutes: number;
    /** The planned timetable: when the driver leaves, and the rider's pickup and arrival. */
    departAt: Date;
    pickupAt: Date;
    arriveAt: Date;
  }>;
  /** Riders this batch didn't match, with each driver's reason. */
  unmatched: MatchRunResult['unmatchedReasons'];
  applied: string[];
  writeSkips: Array<{ reqId: string; reason: MatchWriteSkip; }>;
  /** Confirmed cars whose missing or outdated timetable this run filled in
   *  (on a dry run: would have). */
  timetablesFilled: string[];
  /** Set when this batch failed (e.g. Google refused the matrix); other batches still run. */
  error?: string;
}

export interface RunReport {
  /** Matched requests this run returned to the pool or expired. */
  settled: Settled;
  /** Bookings left out before matching, and why. */
  skipped: Skipped[];
  batches: BatchReport[];
}

export async function runOnce(store: MatchingStore, opts: RunOptions): Promise<RunReport> {
  const settled: Settled = opts.dryRun
    ? { released: [], expired: [] }
    : await store.settleMatched(opts.now);

  const pending = await store.loadPending();
  const { batches, skipped } = groupIntoBatches(pending.requests, pending.offers, opts.now);

  const confirmedIds = batches.flatMap((b) => b.offers.flatMap((o) => o.confirmedRequestIds ?? []));
  const confirmedById = await store.loadRequestsById(confirmedIds);

  const reports: BatchReport[] = [];
  for (const batch of batches) {
    const report: BatchReport = {
      batchKey: batch.batchKey,
      requests: batch.requests.length,
      offers: batch.offers.length,
      matches: [],
      unmatched: [],
      applied: [],
      writeSkips: [],
      timetablesFilled: [],
    };
    reports.push(report);

    // Check there are scheduled riders who haven't been matched to this ride
    const needTimetable = new Set(batch.offers
      .filter((o) => (o.confirmedRequestIds ?? []).length > 0
        && !sameList(o.scheduledRiders ?? [], o.confirmedRequestIds ?? []))
      .map((o) => o.id));

    // Nothing to pair or fill in - and no reason to run travel-time matrix for this batch
    if (batch.offers.length === 0 || (batch.requests.length === 0 && needTimetable.size === 0)) continue;

    try {
      const t = await opts.travelTimes(batchPoints(batch, confirmedById, MONASH_CLAYTON));
      const inputs = toMatchInputs(batch, confirmedById, t, { campus: MONASH_CLAYTON });
      skipped.push(...inputs.skipped);

      const scheduleWrites = inputs.offers
        .filter((o) => needTimetable.has(o.offerId) && o.onBoard.length > 0)
        .map((o) => confirmedTimetable(o, t));
      report.timetablesFilled = opts.dryRun
        ? scheduleWrites.map((w) => w.offerId)
        : await store.writeSchedules(scheduleWrites);

      if (batch.requests.length === 0) continue;

      const result = runMatchingProvisional(
        batch.batchKey, inputs.requests, inputs.offers, offerDeparture, opts.now, t,
      );
      report.matches = result.matches.map((m) => ({
        reqId: m.reqId,
        offerId: m.offerId,
        riderDetour: m.riderDetour,
        driverAddedMinutes: m.driverAddedMinutes,
        departAt: m.departAt,
        pickupAt: m.pickupAt,
        arriveAt: m.arriveAt,
      }));
      report.unmatched = result.unmatchedReasons;

      if (!opts.dryRun) {
        const written = await store.writeMatches(toMatchWrites(result.matches, inputs.offers));
        report.applied = written.applied;
        report.writeSkips = written.skipped;
      }
    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err);
    }
  }

  return { settled, skipped, batches: reports };
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The timetable of a car's confirmed riders, planned the way a match's is. */
function confirmedTimetable(offer: MatchOffer, t: TravelTimeMatrix): ScheduleWrite {
  const departAt = offerDeparture(offer);
  const ev = evaluateRoute(offer.start, offer.onBoard.map((r) => r.waypoint), offer.end, departAt, t, offer.direction);
  return {
    offerId: offer.offerId,
    baseline: offer.onBoard.map((r) => r.reqId),
    schedule: toStoredSchedule(timetableFor(offer, offer.onBoard, ev, departAt)),
  };
}
