/**
 * SMART Goal 1 evidence run (KEY-68 / KEY-44).
 *
 *   "Match at least 80% of requests in a simulated batch of 100, with average
 *    added detour per matched rider under 15% of their original trip."
 *
 * Runs runMatchingProvisional the way the app uses it. One run offers each
 * driver at most one new rider, so a single run says little about match rate:
 * the batch is run repeatedly, every match is accepted in between (the best
 * case - real riders sometimes decline), until a run offers nobody new.
 * Detour is measured on each car's FINAL route, since every later pickup can
 * add to the detour of riders already aboard.
 *
 * No database, no API — a synthetic travel-time matrix with a fixed seed, so
 * the numbers are reproducible and can be quoted in the report.
 *
 *   npx ts-node test/simulate.ts
 */
import { runMatchingProvisional } from '../../matching/src/deferredAcceptance';
import { waypointOf } from '../../matching/src/filter';
import { evaluateRoute } from '../../matching/src/route';
import { SyntheticTravelTime } from '../../matching/src/travelTime';
import {
  DEFAULT_CONFIG, MatchOffer, MatchRequest, MatchingConfig, ProposedMatch, TravelTimeMatrix,
} from '../../matching/src/types';
import { at, makeOffer, makeRequest, ring } from '../fixtures';

const DEPART = at(8);
const NOW = at(0);

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

/** What the app's acceptMatch does: the rider joins the car at their pickup
 *  position and becomes a confirmed rider for every later run. */
function accept(m: ProposedMatch, req: MatchRequest, offer: MatchOffer, t: TravelTimeMatrix) {
  req.status = 'confirmed';
  offer.onBoard.splice(m.insertionIndex, 0, {
    reqId: req.reqId,
    riderId: req.riderId,
    waypoint: waypointOf(req),
    arriveBy: req.arriveBy,
    maxDetour: req.maxDetour,
    currentDetour: 0,
    earliest: req.travelWindow.start,
  });
  const ev = evaluateRoute(
    offer.start, offer.onBoard.map((r) => r.waypoint), offer.end, DEPART, t, offer.direction,
  );
  offer.onBoard.forEach((r, i) => { r.currentDetour = ev.riderDetours[i]; });
  offer.seatsFilled = offer.onBoard.length;
  offer.currTripDuration = ev.totalMinutes;
  if (offer.seatsFilled >= offer.seatsOffered) offer.status = 'closed';
}

function run(label: string, cfg: MatchingConfig, nReq = 100, nOff = 30) {
  const { requests, offers } = buildBatch(nReq, nOff, 11);
  const t = new SyntheticTravelTime({ seed: 20260917, jitter: 0.15 });
  const reqById = new Map(requests.map((r) => [r.reqId, r]));
  const offerById = new Map(offers.map((o) => [o.offerId, o]));

  let rounds = 0;
  let last;
  for (; ;) {
    last = runMatchingProvisional('2026-09-18_TO_CAMPUS_0930', requests, offers, DEPART, NOW, t, cfg);
    if (last.matches.length === 0) break;
    rounds++;
    for (const m of last.matches) accept(m, reqById.get(m.reqId)!, offerById.get(m.offerId)!, t);
  }

  // Every matched rider's detour on their car's final route, in minutes and
  // as a share of their own direct trip - the form the SMART goal is written in.
  const detourMin: number[] = [];
  const detourPct: number[] = [];
  const driverAdded: number[] = [];
  for (const o of offers) {
    if (o.onBoard.length === 0) continue;
    const ev = evaluateRoute(o.start, o.onBoard.map((r) => r.waypoint), o.end, DEPART, t, o.direction);
    driverAdded.push(ev.driverAddedMinutes);
    o.onBoard.forEach((r, i) => {
      const req = reqById.get(r.reqId)!;
      detourMin.push(ev.riderDetours[i]);
      detourPct.push(ev.riderDetours[i] / t.minutes(req.start, req.end));
    });
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const matched = detourMin.length;
  const matchRate = matched / requests.length;
  const s = last.stats;
  const seatsTotal = offers.reduce((a, o) => a + o.seatsOffered, 0);

  console.log(`\n=== ${label} ===`);
  console.log(`requests in           ${requests.length}`);
  console.log(`offers in             ${offers.length}`);
  console.log(`runs until settled    ${rounds}`);
  console.log(`matched               ${matched}`);
  console.log(`match rate            ${(matchRate * 100).toFixed(1)}%   (target >= 80%)`);
  console.log(`avg rider detour      ${mean(detourMin).toFixed(1)} min`);
  console.log(`avg detour vs direct  ${(mean(detourPct) * 100).toFixed(1)}%   (target < 15%)`);
  console.log(`avg driver added      ${mean(driverAdded).toFixed(1)} min per car carrying anyone`);
  console.log(`seats available       ${seatsTotal}  (supply ceiling ${(Math.min(1, seatsTotal / requests.length) * 100).toFixed(0)}%)`);
  console.log(`seat utilisation      ${(matched / seatsTotal * 100).toFixed(0)}%`);
  console.log(`seats left unused     ${s.seatsLeftOnClosedTrips}`);
  console.log(`  closed by driver    ${s.closedByDriverChoice}`);
  console.log(`  closed by slack     ${s.closedBySlack}`);
  return { matchRate, meanPct: mean(detourPct) };
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
