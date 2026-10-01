import { Coord, MatchRunResult, TravelTimeMatrix } from '../src/types';
import {
  batchPoints, groupIntoBatches, MONASH_CLAYTON, offerDeparture, OfferDoc, RequestDoc,
  Skipped, toMatchInputs,
} from '../src/adapter';
import { runMatchingProvisional } from '../src/deferredAcceptance';
import { MatchWrite, MatchWriteSkip, Settled, toMatchWrites } from '../src/writes';

/**
 * One matching run, start to finish:
 *
 *   1. settle matched requests: expire matches nobody accepted in time,
 *      freeing those drivers' slots, and return riders whose driver removed
 *      the offer to the pool
 *   2. read every request and offer still looking for a match
 *   3. group them into batches - one date, one direction each
 *   4. per batch: build travel times once, convert, run the matcher, write
 *
 * Storage is behind `MatchingStore` so the whole flow runs against an in-memory
 * store in tests; runner/firestore.ts is the real one.
 */

export interface MatchingStore {
  settleMatched(now: Date): Promise<Settled>;
  loadPending(): Promise<{ requests: RequestDoc[]; offers: OfferDoc[] }>;
  loadRequestsById(ids: string[]): Promise<Map<string, RequestDoc>>;
  writeMatches(writes: MatchWrite[]): Promise<{
    applied: string[];
    skipped: Array<{ reqId: string; reason: MatchWriteSkip }>;
  }>;
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
  matches: Array<{ reqId: string; offerId: string; riderDetour: number; driverAddedMinutes: number }>;
  /** Riders this batch didn't match, with each driver's reason. */
  unmatched: MatchRunResult['unmatchedReasons'];
  applied: string[];
  writeSkips: Array<{ reqId: string; reason: MatchWriteSkip }>;
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
    };
    reports.push(report);
    // Nothing to pair - and no reason to pay for a travel-time matrix.
    if (batch.requests.length === 0 || batch.offers.length === 0) continue;

    try {
      const t = await opts.travelTimes(batchPoints(batch, confirmedById, MONASH_CLAYTON));
      const inputs = toMatchInputs(batch, confirmedById, t, { campus: MONASH_CLAYTON });
      skipped.push(...inputs.skipped);

      const result = runMatchingProvisional(
        batch.batchKey, inputs.requests, inputs.offers, offerDeparture, opts.now, t,
      );
      report.matches = result.matches.map((m) => ({
        reqId: m.reqId,
        offerId: m.offerId,
        riderDetour: m.riderDetour,
        driverAddedMinutes: m.driverAddedMinutes,
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
