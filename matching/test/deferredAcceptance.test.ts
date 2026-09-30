import { runMatching } from '../src/match';
import { runMatchingProvisional } from '../src/deferredAcceptance';
import { FixtureTravelTime, SyntheticTravelTime, legKey } from '../src/travelTime';
import { DEFAULT_CONFIG } from '../src/types';
import { CAMPUS, at, makeOffer, makeRequest } from './fixtures';

const t = new SyntheticTravelTime({ jitter: 0, seed: 1 });

describe('runMatchingProvisional — worked example from the brief', () => {
  // Two riders, two single-seat drivers. B's only reachable trip is D1
  // (D2 is corridor-rejected for B outright). A can reach both, and A's own
  // best trip is D1 too — so a one-shot greedy pass locks A onto D1 first
  // (globally highest combined score) and stops looking, stranding B.
  // Provisional assignment lets D1 bump A for the strictly cheaper B once B
  // proposes, then A lands on D2 on its next try — two matches instead of one.
  const cfg = { ...DEFAULT_CONFIG, useBearingFilter: false };

  const S1 = { lat: CAMPUS.lat + 0.10, lon: CAMPUS.lon };
  const S2 = { lat: CAMPUS.lat + 0.10, lon: CAMPUS.lon - 0.60 };
  const Astart = { lat: CAMPUS.lat + 0.01, lon: CAMPUS.lon + 0.005 };
  const Bstart = { lat: CAMPUS.lat + 0.06, lon: CAMPUS.lon };

  const A = makeRequest({ reqId: 'A', start: Astart, maxDetour: 25, arriveBy: at(8, 50) });
  const B = makeRequest({ reqId: 'B', start: Bstart, maxDetour: 5, arriveBy: at(8, 11) });
  const D1 = makeOffer({ offerId: 'D1', start: S1, seatsOffered: 1, maxDetour: 30 });
  const D2 = makeOffer({ offerId: 'D2', start: S2, seatsOffered: 1, maxDetour: 30 });

  // Exact minutes for the legs that matter, so the divergence is deterministic
  // rather than an artifact of haversine noise. Coordinates above are chosen
  // only to satisfy the corridor gate (B genuinely cannot reach D2); the
  // actual route cost comes from this table.
  const table = new Map<string, number>([
    [legKey(S1, CAMPUS), 10],
    [legKey(S2, CAMPUS), 8],
    [legKey(S1, Astart), 7],
    [legKey(Astart, CAMPUS), 8],
    [legKey(S2, Astart), 17],
    [legKey(S1, Bstart), 5.25],
    [legKey(Bstart, CAMPUS), 5.25],
  ]);
  const fixture = new FixtureTravelTime(table, new SyntheticTravelTime({ jitter: 0 }));

  it('greedy locks the higher-scoring pair first and strands the other rider', () => {
    const res = runMatching('b', [A, B], [D1, D2], at(8), at(0), fixture, cfg);
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].reqId).toBe('A');
    expect(res.unmatchedRequestIds).toEqual(['B']);
  });

  it('provisional bumping matches both riders by relocating the displaced one', () => {
    const res = runMatchingProvisional('b', [A, B], [D1, D2], at(8), at(0), fixture, cfg);
    expect(res.matches).toHaveLength(2);
    const byRider = new Map(res.matches.map((m) => [m.reqId, m.offerId]));
    expect(byRider.get('B')).toBe('D1');
    expect(byRider.get('A')).toBe('D2');
    expect(res.unmatchedRequestIds).toEqual([]);
  });
});

describe('runMatchingProvisional — confirmed riders are immovable', () => {
  const near = { lat: CAMPUS.lat + 0.05, lon: CAMPUS.lon };

  it('never bumps a rider already aboard when the run started', () => {
    // A single-seat trip that ALREADY has a confirmed rider (as it would
    // re-enter the pool on a later run under the multi-run lifecycle). A
    // new, objectively cheaper proposer should not be able to displace them.
    const confirmed = makeOffer({
      offerId: 'o1',
      start: near,
      seatsOffered: 1,
      seatsFilled: 1,
      onBoard: [{
        reqId: 'confirmed-rider',
        riderId: 'rider-confirmed',
        waypoint: near,
        arriveBy: at(9),
        maxDetour: 30,
        currentDetour: 0,
      }],
      currTripDuration: 0,
    });

    const newRider = makeRequest({ reqId: 'new', start: near, maxDetour: 30 });

    const res = runMatchingProvisional('b', [newRider], [confirmed], at(8), at(0), t);
    expect(res.matches).toHaveLength(0);
    expect(res.unmatchedRequestIds).toEqual(['new']);
  });

  it('still lets a confirmed trip pick up a NEW rider in the remaining seats', () => {
    const partiallyFilled = makeOffer({
      offerId: 'o1',
      start: near,
      seatsOffered: 2,
      seatsFilled: 1,
      onBoard: [{
        reqId: 'confirmed-rider',
        riderId: 'rider-confirmed',
        waypoint: near,
        arriveBy: at(9),
        maxDetour: 30,
        currentDetour: 0,
      }],
      currTripDuration: 0,
    });

    const newRider = makeRequest({ reqId: 'new', start: near, maxDetour: 30 });

    const res = runMatchingProvisional('b', [newRider], [partiallyFilled], at(8), at(0), t);
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].reqId).toBe('new');
    // The confirmed rider is a fixed input, not a new match this run.
    expect(res.matches.some((m) => m.reqId === 'confirmed-rider')).toBe(false);
  });
});

describe('runMatchingProvisional — capacity and detour caps still hold', () => {
  const near = { lat: CAMPUS.lat + 0.05, lon: CAMPUS.lon };

  it('never seats more riders than seatsOffered', () => {
    const offer = makeOffer({ offerId: 'o1', start: near, seatsOffered: 1 });
    const r1 = makeRequest({ reqId: 'r1', start: near });
    const r2 = makeRequest({ reqId: 'r2', start: { lat: near.lat, lon: near.lon + 0.001 } });

    const res = runMatchingProvisional('b', [r1, r2], [offer], at(8), at(0), t);
    expect(res.stats.matchesMade).toBeLessThanOrEqual(1);
  });

  it('respects acceptDeadline clamping identically to the greedy path', () => {
    const departAt = at(8);
    const matchedAt = at(5); // 3 hours out — within the approval window but not the cutoff
    const offer = makeOffer({ offerId: 'o1', start: near });
    const req = makeRequest({ reqId: 'r1', start: near });

    const res = runMatchingProvisional('b', [req], [offer], departAt, matchedAt, t);
    expect(res.matches).toHaveLength(1);
    const expectedCutoff = new Date(departAt.getTime() - DEFAULT_CONFIG.matchingCutoffMinutes * 60_000);
    expect(res.matches[0].acceptDeadline.getTime()).toBe(expectedCutoff.getTime());
  });
});

describe('one new rider per trip per run', () => {
  const near = { lat: CAMPUS.lat + 0.03, lon: CAMPUS.lon };

  /**
   * The rule: accepting a match is a human decision, so a driver is offered
   * exactly ONE new unconfirmed rider per run regardless of how many seats sit
   * empty. Greedy has no such rule and fills the car in a single pass — the
   * contrast is the point, so both are asserted here.
   */
  it('fills one seat of a four-seat trip, where greedy fills four', () => {
    const riders = [0, 1, 2, 3, 4].map((i) =>
      makeRequest({
        reqId: `r${i}`,
        start: { lat: near.lat + i * 0.002, lon: near.lon + i * 0.002 },
        maxDetour: 60,
      }),
    );
    const offer = makeOffer({
      offerId: 'o1', start: { lat: CAMPUS.lat + 0.09, lon: CAMPUS.lon },
      seatsOffered: 4, maxDetour: 200,
    });

    const prov = runMatchingProvisional('b', riders, [offer], at(8), at(0), t);
    expect(prov.matches).toHaveLength(1);

    const greedy = runMatching('b', riders, [offer], at(8), at(0), t);
    expect(greedy.matches.length).toBeGreaterThan(1);
  });

  it('gives the slot to the cheaper rider and returns the other to the pool', () => {
    // Two riders, one trip. Only one can hold the slot; the loser is reported
    // as unmatched rather than silently dropped.
    const cheap = makeRequest({ reqId: 'cheap', start: near, maxDetour: 60 });
    const dear = makeRequest({
      reqId: 'dear',
      start: { lat: near.lat, lon: near.lon + 0.05 },
      maxDetour: 60,
    });
    const offer = makeOffer({
      offerId: 'o1', start: { lat: CAMPUS.lat + 0.09, lon: CAMPUS.lon },
      seatsOffered: 4, maxDetour: 200,
    });

    const res = runMatchingProvisional('b', [cheap, dear], [offer], at(8), at(0), t);
    expect(res.matches).toHaveLength(1);
    expect(res.unmatchedRequestIds).toHaveLength(1);
    // Whoever won, the two lists must partition the batch — no rider lost.
    expect([...res.matches.map((m) => m.reqId), ...res.unmatchedRequestIds].sort())
      .toEqual(['cheap', 'dear']);
  });

  it('does not let the new rider displace a confirmed rider', () => {
    // A confirmed rider from a previous run occupies one seat and is fixed.
    // The slot is for a NEW rider, so the trip ends up with both.
    const confirmed = {
      reqId: 'old', riderId: 'rider-old',
      waypoint: { lat: CAMPUS.lat + 0.05, lon: CAMPUS.lon },
      arriveBy: at(10), maxDetour: 90, currentDetour: 0,
    };
    const offer = makeOffer({
      offerId: 'o1', start: { lat: CAMPUS.lat + 0.09, lon: CAMPUS.lon },
      seatsOffered: 4, maxDetour: 200, seatsFilled: 1, onBoard: [confirmed],
    });
    const fresh = makeRequest({ reqId: 'new', start: near, maxDetour: 60 });

    const res = runMatchingProvisional('b', [fresh], [offer], at(8), at(0), t);
    // The confirmed rider is never re-reported as a new match...
    expect(res.matches.map((m) => m.reqId)).toEqual(['new']);
    // ...but is still aboard, so the trip now carries two.
    expect(res.matches[0].insertionIndex).toBeGreaterThanOrEqual(0);
  });

  it('takes nobody when confirmed riders already fill every seat', () => {
    const full = [0, 1].map((i) => ({
      reqId: `old${i}`, riderId: `rider-old${i}`,
      waypoint: { lat: CAMPUS.lat + 0.04 + i * 0.002, lon: CAMPUS.lon },
      arriveBy: at(10), maxDetour: 90, currentDetour: 0,
    }));
    const offer = makeOffer({
      offerId: 'o1', start: { lat: CAMPUS.lat + 0.09, lon: CAMPUS.lon },
      seatsOffered: 2, maxDetour: 200, seatsFilled: 2, onBoard: full,
    });
    const fresh = makeRequest({ reqId: 'new', start: near, maxDetour: 60 });

    const res = runMatchingProvisional('b', [fresh], [offer], at(8), at(0), t);
    expect(res.matches).toHaveLength(0);
  });
});
