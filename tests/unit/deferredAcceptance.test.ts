/*
Tests src/deferredAcceptance.ts - runMatchingProvisional, the matcher the app
actually runs. Each rider asks their best-scoring driver first; a driver's one
open slot goes to whichever rider costs them fewer extra minutes, and the rider
who loses tries their next option.

  worked example          the case bumping exists for: placing riders once
                          and never revisiting strands one, bumping matches
                          both (hand-set travel times)
  confirmed riders        riders accepted in earlier runs are never moved or
                          bumped, don't use up the new-rider slot, and are
                          re-timed in the match's timetable
  capacity and deadlines  seats are never overfilled; the accept deadline is
                          the normal 12-hour window, cut short at the cutoff
                          2 hours before departure
  matching cutoff         within 2 hours of departure a trip takes nobody new,
                          and the run reports why
  one new rider per run   a driver is offered one new rider per run, however
                          many seats are free; the loser is reported, not lost
  own departure time      each driver is routed from their own departure, not
                          one time shared by the whole batch

Travel times: synthetic, no noise, except where a table sets exact minutes.
*/

import { runMatchingProvisional } from '../../matching/src/deferredAcceptance';
import { FixtureTravelTime, SyntheticTravelTime, legKey } from '../travelTime';
import { DEFAULT_CONFIG } from '../../matching/src/types';
import { CAMPUS, at, makeOffer, makeRequest } from '../fixtures';

const t = new SyntheticTravelTime({ jitter: 0, seed: 1 });

describe('runMatchingProvisional — worked example from the brief', () => {
  // Two riders, two single-seat drivers. B's only reachable trip is D1
  // (D2 is corridor-rejected for B outright). A can reach both, and A's own
  // best trip is D1 too — so placing riders once and never revisiting locks A
  // onto D1 first (globally highest combined score) and strands B.
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

  it("records the car's timetable with every rider in it, confirmed ones included", () => {
    const onBoard = {
      reqId: 'confirmed-rider', riderId: 'rider-confirmed', waypoint: near,
      arriveBy: at(9), maxDetour: 30, currentDetour: 0,
    };
    const offer = makeOffer({ offerId: 'o1', start: near, seatsOffered: 2, seatsFilled: 1, onBoard: [onBoard] });
    const res = runMatchingProvisional('b', [makeRequest({ reqId: 'new', start: near, maxDetour: 30 })], [offer], at(8), at(0), t);

    const m = res.matches[0];
    expect(m.departAt).toEqual(at(8));
    expect(m.schedule.map((s) => s.reqId).sort()).toEqual(['confirmed-rider', 'new']);
    expect(m.schedule.findIndex((s) => s.reqId === 'new')).toBe(m.insertionIndex);
    const mine = m.schedule[m.insertionIndex];
    expect({ pickupAt: m.pickupAt, arriveAt: m.arriveAt }).toEqual({ pickupAt: mine.pickupAt, arriveAt: mine.arriveAt });
    // Going to campus: collected after the driver sets off, and everyone
    // arrives with the car.
    for (const stop of m.schedule) {
      expect(stop.pickupAt.getTime()).toBeGreaterThanOrEqual(at(8).getTime());
      expect(stop.arriveAt).toEqual(m.finalArrival);
    }
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

  it('uses the normal approval window when matching happens well ahead of the cutoff', () => {
    // Matched more than (approval window + cutoff) before departure, so the
    // approval window itself is the binding constraint, not the cutoff.
    const departAt = at(8, 0, 16);
    const matchedAt = at(0, 0, 15); // 32 hours before departure
    const window = { start: at(7, 0, 16), end: at(8, 30, 16) };
    const offer = makeOffer({ offerId: 'o1', start: near, travelWindow: window });
    const req = makeRequest({ reqId: 'r1', start: near, travelWindow: window, arriveBy: at(9, 0, 16) });

    const res = runMatchingProvisional('b', [req], [offer], departAt, matchedAt, t);
    expect(res.matches).toHaveLength(1);
    const expected = new Date(matchedAt.getTime() + DEFAULT_CONFIG.approvalWindowMinutes * 60_000);
    expect(res.matches[0].acceptDeadline.getTime()).toBe(expected.getTime());
    expect(res.matches[0].acceptDeadline.getTime()).toBeLessThan(departAt.getTime());
  });

  it('cuts the accept deadline short at the matching cutoff', () => {
    // Matched only 3 hours before departure: the full 12-hour approval window
    // would promise a deadline long after the trip has already left.
    const departAt = at(8);
    const matchedAt = at(5);
    const offer = makeOffer({ offerId: 'o1', start: near });
    const req = makeRequest({ reqId: 'r1', start: near });

    const res = runMatchingProvisional('b', [req], [offer], departAt, matchedAt, t);
    expect(res.matches).toHaveLength(1);
    const expectedCutoff = new Date(departAt.getTime() - DEFAULT_CONFIG.matchingCutoffMinutes * 60_000);
    expect(res.matches[0].acceptDeadline.getTime()).toBe(expectedCutoff.getTime());
  });
});

describe('runMatchingProvisional — matching cutoff', () => {
  it('locks every open trip once departure is within the cutoff, however many seats are free', () => {
    const near = { lat: CAMPUS.lat + 0.05, lon: CAMPUS.lon };
    const departAt = at(8);
    const now = at(7); // 60 minutes out, inside the 120-minute default cutoff

    const res = runMatchingProvisional(
      'b', [makeRequest({ reqId: 'r', start: near })],
      [makeOffer({ offerId: 'o', start: near, seatsOffered: 4, seatsFilled: 0 })],
      departAt, now, t,
    );

    expect(res.matches).toHaveLength(0);
    expect(res.unmatchedRequestIds).toEqual(['r']);
    expect(res.stats.closedByCutoff).toBe(1);
    expect(res.rejected.some((rj) => rj.reason === 'MATCHING_CUTOFF')).toBe(true);
  });
});

describe('one new rider per trip per run', () => {
  const near = { lat: CAMPUS.lat + 0.03, lon: CAMPUS.lon };

  /**
   * The rule: accepting a match is a human decision, so a driver is offered
   * exactly ONE new unconfirmed rider per run regardless of how many seats sit
   * empty. Five riders fit this car; one run still offers only one of them.
   */
  it('fills one seat of a four-seat trip per run', () => {
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

    const res = runMatchingProvisional('b', riders, [offer], at(8), at(0), t);
    expect(res.matches).toHaveLength(1);
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

describe('runMatchingProvisional — each driver routed from their own departure', () => {
  // t is 2.1 min per km. The rider is 21 min out and must be on campus by 8:40.
  const north = (km: number) => ({ lat: CAMPUS.lat + km / 110.57, lon: CAMPUS.lon });
  const rider = makeRequest({
    reqId: 'r', start: north(10), arriveBy: at(8, 40), travelWindow: { start: at(7, 30), end: at(8, 19) },
  });
  // Leaves 8:00 from a little further out: reaches campus about 8:25.
  const early = makeOffer({ offerId: 'early', start: north(12), travelWindow: { start: at(8), end: at(8, 40) } });
  // Nearly at the rider's door, but leaves 8:19: reaches campus about 8:41 - late.
  const late = makeOffer({ offerId: 'late', start: north(10.5), travelWindow: { start: at(8, 19), end: at(8, 50) } });
  const ownDeparture = (o: { travelWindow: { start: Date; }; }) => o.travelWindow.start;

  it("never places a rider with a driver who leaves too late to get them there", () => {
    const res = runMatchingProvisional('b', [rider], [early, late], ownDeparture, at(0), t);
    expect(res.matches.map((m) => m.offerId)).toEqual(['early']);
    // The deadline clamps against THIS driver's departure: 8:00 minus the 2h cutoff.
    expect(res.matches[0].acceptDeadline).toEqual(at(6));
  });

  it('which one shared batch departure time gets wrong', () => {
    // Routed as if everyone left at 8:00, the late driver looks faster and wins.
    const res = runMatchingProvisional('b', [rider], [early, late], at(8), at(0), t);
    expect(res.matches.map((m) => m.offerId)).toEqual(['late']);
  });
});

describe('runMatchingProvisional — explains every rider it leaves out', () => {
  const north = (km: number, eastKm = 0) => ({
    lat: CAMPUS.lat + km / 110.57, lon: CAMPUS.lon + eastKm / 87.8,
  });
  const offer = makeOffer({ offerId: 'o', start: north(20), seatsOffered: 1 });
  // Proposes first and holds the seat, until a rider who costs less arrives.
  const offRoute = makeRequest({ reqId: 'offRoute', start: north(12, 1.5) });
  const onRoute = makeRequest({ reqId: 'onRoute', start: north(10) });
  // South of campus: the driver comes from the north.
  const south = makeRequest({ reqId: 'south', start: north(-15) });

  const res = runMatchingProvisional('b', [offRoute, onRoute, south], [offer], at(8), at(0), t);

  it('matches the cheaper rider', () => {
    expect(res.matches.map((m) => m.reqId)).toEqual(['onRoute']);
  });

  it('gives each unmatched rider a reason per driver', () => {
    expect(res.unmatchedReasons).toEqual([
      { reqId: 'offRoute', byOffer: [{ offerId: 'o', reason: 'LOST_SLOT' }] },
      { reqId: 'south', byOffer: [{ offerId: 'o', reason: 'BEARING' }] },
    ]);
  });
});

describe('runMatchingProvisional — trips to campus are timed from the deadline', () => {
  const north = (km: number) => ({ lat: CAMPUS.lat + km / 110.57, lon: CAMPUS.lon });

  it('times the whole car to reach campus by the tightest deadline', () => {
    // The driver could leave from 8:00 and needs to be in by 9:50; the rider by 9:00.
    const offer = makeOffer({ offerId: 'o', start: north(20), arriveBy: at(9, 50) });
    const rider = makeRequest({ reqId: 'r', start: north(10), arriveBy: at(9) });
    const res = runMatchingProvisional('b', [rider], [offer], at(8), at(0), t);

    const m = res.matches[0];
    // The rider's 9:00 is the tighter deadline, so the car arrives then - not 8:42.
    expect(m.arriveAt.getTime()).toBeCloseTo(at(9).getTime(), -3);
    expect(m.finalArrival.getTime()).toBeCloseTo(at(9).getTime(), -3);
    expect(m.departAt.getTime()).toBeCloseTo(at(9).getTime() - t.minutes(north(20), CAMPUS) * 60_000, -3);
    expect(m.schedule[0].pickupAt.getTime()).toBeCloseTo(m.pickupAt.getTime());
    expect(m.pickupAt.getTime()).toBeGreaterThan(at(8, 30).getTime());
  });
});
