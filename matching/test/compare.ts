/**
 * One-shot greedy (src/match.ts) vs provisional assignment with bumping
 * (src/deferredAcceptance.ts), same batches, same seed. This is the harness
 * that produced the numbers quoted in README's algorithm-decision section.
 *
 *   npx ts-node test/compare.ts
 */
import { runMatching } from '../src/match';
import { runMatchingProvisional } from '../src/deferredAcceptance';
import { SyntheticTravelTime } from '../src/travelTime';
import { MatchOffer, MatchRequest } from '../src/types';
import { CAMPUS, at, makeOffer, makeRequest, ring } from './fixtures';

function buildBatch(nRequests: number, nOffers: number, seed: number) {
  const riderPts = ring(nRequests, 18, seed);
  const driverPts = ring(nOffers, 18, seed + 41);

  const requests: MatchRequest[] = riderPts.map((p, i) =>
    makeRequest({
      reqId: `r${i}`,
      start: p,
      maxDetour: 8 + (i % 4) * 4,
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

function detourPct(matches: { reqId: string; riderDetour: number }[], requests: MatchRequest[], t: SyntheticTravelTime) {
  const pct = matches.map((m) => {
    const req = requests.find((r) => r.reqId === m.reqId)!;
    const direct = t.minutes(req.start, req.end);
    return direct > 0 ? m.riderDetour / direct : 0;
  });
  return pct.length ? pct.reduce((a, b) => a + b, 0) / pct.length : 0;
}

function compare(nReq: number, nOff: number, seed: number) {
  const { requests, offers } = buildBatch(nReq, nOff, seed);
  const t = new SyntheticTravelTime({ seed: 20260917, jitter: 0.15 });

  const g = runMatching('cmp', requests, offers, at(8), at(0), t);
  const p = runMatchingProvisional('cmp', requests, offers, at(8), at(0), t);

  return {
    nReq, nOff,
    greedy: {
      matched: g.stats.matchesMade,
      rate: g.stats.matchRate,
      detour: g.stats.avgRiderDetourMinutes,
      detourPct: detourPct(g.matches, requests, t),
    },
    provisional: {
      matched: p.stats.matchesMade,
      rate: p.stats.matchRate,
      detour: p.stats.avgRiderDetourMinutes,
      detourPct: detourPct(p.matches, requests, t),
    },
  };
}

const cases: Array<[number, number]> = [[60, 25], [100, 40], [100, 30], [80, 35], [120, 50]];

console.log(
  'nReq nOff | greedy matched/rate/detour     | provisional matched/rate/detour'.padEnd(90),
);
for (const [nReq, nOff] of cases) {
  const r = compare(nReq, nOff, 11);
  const g = r.greedy;
  const p = r.provisional;
  console.log(
    `${String(nReq).padStart(4)} ${String(nOff).padStart(4)} | ` +
    `${String(g.matched).padStart(3)}   ${(g.rate * 100).toFixed(0).padStart(3)}%   ${g.detour.toFixed(2)}m` +
    `      | ` +
    `${String(p.matched).padStart(3)}   ${(p.rate * 100).toFixed(0).padStart(3)}%   ${p.detour.toFixed(2)}m`,
  );
}

console.log('\nDetour as % of each matched rider’s own direct trip (target < 15%):');
for (const [nReq, nOff] of cases) {
  const r = compare(nReq, nOff, 11);
  console.log(
    `${String(nReq).padStart(4)} ${String(nOff).padStart(4)} | greedy ${(r.greedy.detourPct * 100).toFixed(1)}%` +
    `  | provisional ${(r.provisional.detourPct * 100).toFixed(1)}%`,
  );
}
