/**
 * SMART Goal 1 evidence run (KEY-68 / KEY-44).
 *
 *   "Match at least 80% of requests in a simulated batch of 100, with average
 *    added detour per matched rider under 15% of their original trip."
 *
 * No database, no API — a synthetic travel-time matrix with a fixed seed, so
 * the numbers are reproducible and can be quoted in the report.
 *
 *   npx ts-node test/simulate.ts
 */
import { runMatching } from '../src/match';
import { SyntheticTravelTime } from '../src/travelTime';
import { DEFAULT_CONFIG, MatchOffer, MatchRequest, MatchingConfig } from '../src/types';
import { CAMPUS, at, makeOffer, makeRequest, ring } from './fixtures';

function buildBatch(nRequests: number, nOffers: number, seed: number) {
  const riderPts = ring(nRequests, 18, seed);
  const driverPts = ring(nOffers, 18, seed + 41);

  const requests: MatchRequest[] = riderPts.map((p, i) =>
    makeRequest({
      reqId: `r${i}`,
      start: p,
      maxDetour: 8 + (i % 4) * 4,                    // 8..20 minutes
      travelWindow: { start: at(7, 30), end: at(8, 45) },
      arriveBy: at(9, 30),
    }),
  );

  const offers: MatchOffer[] = driverPts.map((p, i) =>
    makeOffer({
      offerId: `o${i}`,
      start: p,
      seatsOffered: 2 + (i % 3),                      // 2..4 seats
      maxDetour: 20 + (i % 3) * 10,                   // 20..40 minutes
      travelWindow: { start: at(7, 30), end: at(8, 45) },
    }),
  );

  return { requests, offers };
}

function run(label: string, cfg: MatchingConfig, nReq = 100, nOff = 30) {
  const { requests, offers } = buildBatch(nReq, nOff, 11);
  const t = new SyntheticTravelTime({ seed: 20260917, jitter: 0.15 });
  const res = runMatching('2026-09-18_TO_CAMPUS_0930', requests, offers, at(8), at(0), t, cfg);
  const s = res.stats;

  // Detour as a proportion of each rider's own direct trip - the form the
  // SMART goal is written in.
  const pct = res.matches.map((m) => {
    const req = requests.find((r) => r.reqId === m.reqId)!;
    const direct = t.minutes(req.start, req.end);
    return m.riderDetour / direct;
  });
  const meanPct = pct.length ? pct.reduce((a, b) => a + b, 0) / pct.length : 0;

  console.log(`\n=== ${label} ===`);
  console.log(`requests in           ${s.requestsIn}`);
  console.log(`offers in             ${s.offersIn}`);
  console.log(`matched               ${s.matchesMade}`);
  console.log(`match rate            ${(s.matchRate * 100).toFixed(1)}%   (target >= 80%)`);
  console.log(`avg rider detour      ${s.avgRiderDetourMinutes.toFixed(1)} min`);
  console.log(`avg detour vs direct  ${(meanPct * 100).toFixed(1)}%   (target < 15%)`);
  console.log(`avg driver added      ${s.avgDriverAddedMinutes.toFixed(1)} min`);
  const seatsTotal = offers.reduce((a, o) => a + o.seatsOffered, 0);
  console.log(`seats available       ${seatsTotal}  (supply ceiling ${(Math.min(1, seatsTotal / s.requestsIn) * 100).toFixed(0)}%)`);
  console.log(`seat utilisation      ${(s.matchesMade / seatsTotal * 100).toFixed(0)}%`);
  console.log(`seats left unused     ${s.seatsLeftOnClosedTrips}`);
  console.log(`  closed by driver    ${s.closedByDriverChoice}`);
  console.log(`  closed by slack     ${s.closedBySlack}`);
  return { matchRate: s.matchRate, meanPct };
}

// KEY-136: measure what the bearing filter actually costs, rather than assuming.
// Supply sweep: match rate is bounded by seats, not by the algorithm.
console.log('\n### supply sweep (bearing off) ###');
for (const nOff of [30, 40, 50, 60]) {
  run(`${nOff} drivers vs 100 riders`, { ...DEFAULT_CONFIG, useBearingFilter: false }, 100, nOff);
}

console.log('\n### bearing filter cost, at 40 drivers ###');
run('bearing OFF', { ...DEFAULT_CONFIG, useBearingFilter: false }, 100, 40);
run('bearing 90 deg (default)', { ...DEFAULT_CONFIG, useBearingFilter: true, bearingThresholdDegrees: 90 }, 100, 40);
run('bearing 45 deg (as specced in KEY-136)', { ...DEFAULT_CONFIG, useBearingFilter: true, bearingThresholdDegrees: 45 }, 100, 40);
