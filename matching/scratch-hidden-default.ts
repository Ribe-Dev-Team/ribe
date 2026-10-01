/*
Scratch experiment - NOT part of the suite, safe to delete.

Question: could we skip asking riders for their detour tolerance and just
inject a hidden constant instead?

Method. Each rider has a TRUE tolerance (what they'd actually accept, 8-20 min,
same spread simulate.ts uses). We run matching with a DECLARED cap instead -
either that true value (we asked) or a constant (we didn't) - then score the
resulting matches against the true tolerances that were never collected.

    matched          matches the algorithm produced
    would decline    matched riders whose real tolerance was exceeded
    net confirmed    matched - would decline, i.e. matches that survive contact
                     with an actual human

    npx ts-node scratch-hidden-default.ts
*/
import { runMatchingProvisional } from './src/deferredAcceptance';
import { SyntheticTravelTime } from './src/travelTime';
import { DEFAULT_CONFIG, MatchOffer, MatchRequest } from './src/types';
import { at, makeOffer, makeRequest, ring } from './test/fixtures';

const N_REQ = 100;
const N_OFF = 30;

/** What each rider would really accept. Never shown to the algorithm unless
 *  the 'ask the rider' strategy is in play. */
const trueTolerance = (i: number) => 8 + (i % 4) * 4; // 8..20 min

const t = new SyntheticTravelTime({ seed: 20260917, jitter: 0.15 });

function build(declaredCap: (i: number, directMin: number) => number) {
  const riderPts = ring(N_REQ, 18, 11);
  const driverPts = ring(N_OFF, 18, 11 + 41);

  const requests: MatchRequest[] = riderPts.map((p, i) =>
    makeRequest({
      reqId: `r${i}`,
      start: p,
      maxDetour: declaredCap(i, t.minutes(p, makeRequest({ reqId: 'x', start: p }).end)),
      travelWindow: { start: at(7, 30), end: at(8, 45) },
      arriveBy: at(9, 30),
    }),
  );

  const offers: MatchOffer[] = driverPts.map((p, i) =>
    makeOffer({
      offerId: `o${i}`,
      start: p,
      seatsOffered: 2 + (i % 3),
      maxDetour: 20 + (i % 3) * 10,
      travelWindow: { start: at(7, 30), end: at(8, 45) },
    }),
  );

  return { requests, offers };
}

function evaluate(label: string, declaredCap: (i: number, directMin: number) => number) {
  const { requests, offers } = build(declaredCap);
  const res = runMatchingProvisional('exp', requests, offers, at(8), at(0), t, DEFAULT_CONFIG);

  let declined = 0;
  let detourSum = 0;
  let pctSum = 0;
  for (const m of res.matches) {
    const i = Number(m.reqId.slice(1));
    if (m.riderDetour > trueTolerance(i)) declined++;
    detourSum += m.riderDetour;
    const req = requests.find((r) => r.reqId === m.reqId)!;
    pctSum += m.riderDetour / t.minutes(req.start, req.end);
  }

  const matched = res.matches.length;
  const net = matched - declined;
  console.log(
    `${label.padEnd(30)} matched=${String(matched).padStart(3)}` +
    `  wouldDecline=${String(declined).padStart(3)}` +
    `  netConfirmed=${String(net).padStart(3)}` +
    `  avgDetour=${(matched ? detourSum / matched : 0).toFixed(1)}m` +
    `  vsDirect=${(matched ? (pctSum / matched) * 100 : 0).toFixed(1)}%`,
  );
}

/** Same experiment across several batch layouts, so a result isn't one seed's
 *  accident. Returns the mean of each metric. */
function evaluateSeeds(label: string, declaredCap: (i: number, directMin: number) => number) {
  const seeds = [11, 23, 37, 59, 71, 83];
  let matched = 0, declined = 0, pct = 0;

  for (const seed of seeds) {
    const riderPts = ring(N_REQ, 18, seed);
    const driverPts = ring(N_OFF, 18, seed + 41);

    const requests: MatchRequest[] = riderPts.map((p, i) =>
      makeRequest({
        reqId: `r${i}`, start: p,
        maxDetour: declaredCap(i, t.minutes(p, { lat: -37.9105, lon: 145.1362 })),
        travelWindow: { start: at(7, 30), end: at(8, 45) },
        arriveBy: at(9, 30),
      }),
    );
    const offers: MatchOffer[] = driverPts.map((p, i) =>
      makeOffer({
        offerId: `o${i}`, start: p,
        seatsOffered: 2 + (i % 3), maxDetour: 20 + (i % 3) * 10,
        travelWindow: { start: at(7, 30), end: at(8, 45) },
      }),
    );

    const res = runMatchingProvisional('exp', requests, offers, at(8), at(0), t, DEFAULT_CONFIG);
    for (const m of res.matches) {
      const i = Number(m.reqId.slice(1));
      if (m.riderDetour > trueTolerance(i)) declined++;
      const req = requests.find((r) => r.reqId === m.reqId)!;
      pct += m.riderDetour / t.minutes(req.start, req.end);
    }
    matched += res.matches.length;
  }

  const n = seeds.length;
  console.log(
    `${label.padEnd(30)} matched=${(matched / n).toFixed(1).padStart(5)}` +
    `  wouldDecline=${(declined / n).toFixed(1).padStart(4)}` +
    `  netConfirmed=${((matched - declined) / n).toFixed(1).padStart(5)}` +
    `  vsDirect=${(matched ? (pct / matched) * 100 : 0).toFixed(1)}%`,
  );
}

console.log('true rider tolerance: 8-20 min, varying per rider');
console.log('=== single seed (11) ===\n');

evaluate('ask the rider (current)', (i) => trueTolerance(i));
console.log('');
evaluate('hidden constant 10 min', () => 10);
evaluate('hidden constant 15 min', () => 15);
evaluate('hidden constant 20 min', () => 20);
evaluate('hidden constant 40 min', () => 40);
console.log('');
// A flat cap ignores that 15 min on a 10-min trip is a 150% detour while 15 min
// on an hour trip is 25%. The SMART goal is stated as a PERCENTAGE, so try one.
evaluate('hidden 15% of direct trip', (_i, direct) => Math.max(5, direct * 0.15));
evaluate('hidden 50% of direct trip', (_i, direct) => Math.max(5, direct * 0.5));

console.log('\n=== mean of 6 seeds ===\n');
evaluateSeeds('ask the rider (current)', (i) => trueTolerance(i));
console.log('');
evaluateSeeds('hidden constant 10 min', () => 10);
evaluateSeeds('hidden constant 15 min', () => 15);
evaluateSeeds('hidden constant 20 min', () => 20);
evaluateSeeds('hidden constant 40 min', () => 40);
console.log('');
evaluateSeeds('hidden 15% of direct trip', (_i, direct) => Math.max(5, direct * 0.15));
evaluateSeeds('hidden 50% of direct trip', (_i, direct) => Math.max(5, direct * 0.5));

console.log('\n=== percentage sweep (floor 5 min), mean of 6 seeds ===\n');
for (const pct of [0.20, 0.25, 0.30, 0.35, 0.40, 0.50, 0.60, 0.75]) {
  evaluateSeeds(`hidden ${(pct * 100).toFixed(0)}% of direct`, (_i, d) => Math.max(5, d * pct));
}
