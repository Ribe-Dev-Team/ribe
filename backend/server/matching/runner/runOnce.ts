import { Coord } from '../../matching.schema';
import { MatchOffer, MatchRequest, MatchRunResult, RoadDistanceMatrix, TravelTimeMatrix } from '../types';
import {
  batchPoints, groupIntoBatches, MONASH_CLAYTON, offerDeparture, OfferDoc, RequestDoc,
  Skipped, toMatchInputs,
} from '../adapter';
import { runMatchingProvisional } from '../deferredAcceptance';
import { waypointOf } from '../filter';
import { evaluateRoute, timetableFor } from '../route';
import {
  MatchWrite, MatchWriteSkip, ScheduleWrite, Settled, StoredSchedule, toMatchWrites, toStoredSchedule,
} from '../writes';
import { priceSchedule, Pricing } from '../../costSplitting/tripCosts';

/**
 * One matching run, start to finish:
 *
 *   1. settle matched requests: expire matches nobody accepted in time,
 *      freeing those drivers' slots, return riders whose driver removed
 *      the offer to the pool, and free the seats of riders who cancelled
 *   2. read every request and offer still looking for a match, and every
 *      done car
 *   3. group them into batches - one date, one direction each
 *   4. per batch: build travel times and distances once, convert, fill in the
 *      timetable of any car with confirmed riders whose timetable is missing,
 *      out of date or not yet priced, run the matcher, write
 *
 * Every timetable the run writes carries the car's cost split
 * (costSplitting/tripCosts.ts), priced from the same matrix - so the app reads
 * costs, never works them out.
 *
 * Storage is behind `MatchingStore` so the whole flow runs against an in-memory
 * store in tests; runner/firestore.ts is the real one.
 */

export interface MatchingStore {
  settleMatched(now: Date): Promise<Settled>;
  /** Offers still looking for riders and done ones (SETTLED_OFFER_STATUS) alike. */
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
  /** Builds the travel-time and road-distance matrix for one batch's points.
   *  Called once per batch. */
  travelTimes: (points: Coord[]) => Promise<TravelTimeMatrix & RoadDistanceMatrix>;
  /** The fuel price and vehicle economy every car in this run is priced with. */
  pricing: Pricing;
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
    /** The rider's suggested contribution ($) if they accept. */
    contribution?: number;
  }>;
  /** Riders this batch didn't match, with each driver's reason. */
  unmatched: MatchRunResult['unmatchedReasons'];
  applied: string[];
  writeSkips: Array<{ reqId: string; reason: MatchWriteSkip; }>;
  /** Cars with confirmed riders whose missing, outdated or unpriced timetable
   *  this run filled in (on a dry run: would have). */
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
    ? { released: [], expired: [], vacated: [] }
    : await store.settleMatched(opts.now);

  const pending = await store.loadPending();
  const { batches, skipped } = groupIntoBatches(pending.requests, pending.offers, opts.now);

  const confirmedIds = batches.flatMap((b) =>
    [...b.offers, ...b.settledOffers].flatMap((o) => o.confirmedRequestIds ?? []));
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

    // Cars with confirmed riders whose stored timetable doesn't list exactly
    // those riders, or has no costs on it yet.
    const needTimetable = new Set([...batch.offers, ...batch.settledOffers]
      .filter((o) => (o.confirmedRequestIds ?? []).length > 0
        && (!sameList(o.scheduledRiders ?? [], o.confirmedRequestIds ?? []) || !o.scheduleCosted))
      .map((o) => o.id));
    const canMatch = batch.offers.length > 0 && batch.requests.length > 0;

    // Nothing to pair or fill in - and no reason to pay for a matrix.
    if (!canMatch && needTimetable.size === 0) continue;

    try {
      const t = await opts.travelTimes(batchPoints(batch, confirmedById, MONASH_CLAYTON));
      const inputs = toMatchInputs(batch, confirmedById, t, { campus: MONASH_CLAYTON });
      const settledInputs = toMatchInputs(
        { ...batch, offers: batch.settledOffers, requests: [] }, confirmedById, t, { campus: MONASH_CLAYTON },
      );
      skipped.push(...inputs.skipped, ...settledInputs.skipped);

      const waypointById = waypointsOf(inputs.requests, [...inputs.offers, ...settledInputs.offers]);
      const price = (schedule: StoredSchedule, offer: MatchOffer) =>
        priceSchedule(schedule, offer, waypointById, t, opts.pricing, opts.now);

      const scheduleWrites = [...inputs.offers, ...settledInputs.offers]
        .filter((o) => needTimetable.has(o.offerId) && o.onBoard.length > 0)
        .map((o) => {
          const w = confirmedTimetable(o, t);
          return { ...w, schedule: price(w.schedule, o) };
        });
      report.timetablesFilled = opts.dryRun
        ? scheduleWrites.map((w) => w.offerId)
        : await store.writeSchedules(scheduleWrites);

      if (!canMatch) continue;

      const result = runMatchingProvisional(
        batch.batchKey, inputs.requests, inputs.offers, offerDeparture, opts.now, t,
      );
      const offerById = new Map(inputs.offers.map((o) => [o.offerId, o]));
      const writes = toMatchWrites(result.matches, inputs.offers)
        .map((w) => ({ ...w, schedule: price(w.schedule, offerById.get(w.offerId)!) }));

      report.matches = result.matches.map((m, i) => ({
        reqId: m.rideId,
        offerId: m.offerId,
        riderDetour: m.riderDetour,
        driverAddedMinutes: m.driverAddedMinutes,
        departAt: m.departAt,
        pickupAt: m.pickupAt,
        arriveAt: m.arriveAt,
        contribution: writes[i].schedule.stops.find((s) => s.requestId === m.rideId)?.cost?.passengerContribution,
      }));
      report.unmatched = result.unmatchedReasons;

      if (!opts.dryRun) {
        const written = await store.writeMatches(writes);
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

/** Every rider's waypoint - pickup going to campus, drop-off coming from it -
 *  for unmatched riders and riders already in a car alike. */
function waypointsOf(requests: MatchRequest[], offers: MatchOffer[]): Map<string, Coord> {
  return new Map<string, Coord>([
    ...requests.map((r): [string, Coord] => [r.reqId, waypointOf(r)]),
    ...offers.flatMap((o) => o.onBoard.map((r): [string, Coord] => [r.reqId, r.waypoint])),
  ]);
}

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
