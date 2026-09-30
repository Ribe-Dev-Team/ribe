/*
Scratch harness - NOT part of the test suite, safe to delete.

Shows a single readable batch end to end: who matched with whom, what it cost
each side, and why anyone who missed out missed out. Run it with:

    npx ts-node scratch-demo.ts

No Firebase, no Google Maps, no network - SyntheticTravelTime stands in for the
Distance Matrix, so this runs anywhere `npm install` has been run.
*/

import { runMatchingProvisional } from './src/deferredAcceptance';
import { runMatching } from './src/match';
import { SyntheticTravelTime } from './src/travelTime';
import { DEFAULT_CONFIG } from './src/types';
import { CAMPUS, at, makeOffer, makeRequest } from './test/fixtures';

// Points around Monash Clayton. Positive lat = north of campus.
const km = (n: number) => n / 110.57;

// Three riders strung out along the same northern corridor, so they can
// plausibly share a car, plus one far to the east who should NOT match.
const requests = [
  makeRequest({ reqId: 'r1-north-close', start: { lat: CAMPUS.lat + km(4), lon: CAMPUS.lon } }),
  makeRequest({ reqId: 'r2-north-mid', start: { lat: CAMPUS.lat + km(7), lon: CAMPUS.lon + km(0.5) } }),
  makeRequest({ reqId: 'r3-north-far', start: { lat: CAMPUS.lat + km(11), lon: CAMPUS.lon - km(0.5) } }),
  makeRequest({ reqId: 'r4-far-east', start: { lat: CAMPUS.lat, lon: CAMPUS.lon + km(25) } }),
];

// One driver coming down that northern corridor with 3 seats.
const offers = [
  makeOffer({
    offerId: 'd1-north',
    start: { lat: CAMPUS.lat + km(14), lon: CAMPUS.lon },
    seatsOffered: 3,
    maxDetour: 25,
  }),
];

const t = new SyntheticTravelTime({ seed: 42 });
const departAt = at(8);
const now = at(4); // 4 hours before departure, safely outside the 120 min cutoff

const result = runMatchingProvisional(
  'demo-batch', requests, offers, departAt, now, t, DEFAULT_CONFIG,
);

console.log('=== MATCHES ===');
for (const m of result.matches) {
  console.log(
    `  ${m.reqId.padEnd(16)} -> ${m.offerId}` +
    `  seat #${m.insertionIndex + 1}` +
    `  riderDetour=${m.riderDetour.toFixed(1)}min` +
    `  driverCost=${m.driverAddedMinutes.toFixed(1)}min` +
    `  arrives=${m.finalArrival.toISOString().slice(11, 16)}Z`,
  );
}

console.log('\n=== UNMATCHED ===');
if (result.unmatchedRequestIds.length === 0) console.log('  (none)');
for (const id of result.unmatchedRequestIds) {
  // Every reason this request was filtered out, across all offers.
  const why = result.rejected.filter((r) => r.reqId === id).map((r) => r.reason);
  console.log(`  ${id.padEnd(16)} reasons: ${why.length ? [...new Set(why)].join(', ') : 'no feasible insertion'}`);
}

console.log('\n=== STATS ===');
console.log(`  match rate        ${(result.stats.matchRate * 100).toFixed(0)}%`);
console.log(`  avg rider detour  ${result.stats.avgRiderDetourMinutes.toFixed(2)} min`);
console.log(`  avg driver added  ${result.stats.avgDriverAddedMinutes.toFixed(2)} min`);

// Same batch through the greedy baseline, for contrast.
const greedy = runMatching('demo-batch', requests, offers, departAt, now, t, DEFAULT_CONFIG);
console.log(`\n  greedy baseline   ${greedy.matches.length} matched` +
  ` vs provisional ${result.matches.length} matched`);
