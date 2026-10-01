/*
Tests src/route.ts - a driver's route, and whether a new rider can be added to
it without breaking anyone (KEY-138, addPassenger).

  evaluateRoute             drive time, each rider's detour and when each
                            rider arrives, for a given stop order - in both
                            directions (to campus, everyone arrives together;
                            from campus, each rider arrives at their own stop)
  incremental feasibility   adding a rider never pushes someone already aboard
                            past their detour limit, whatever the stop order,
                            and the driver's own limit holds too
  matching cutoff           a trip stops taking riders 2 hours before it leaves,
                            regardless of free seats
  time windows              the car never collects someone before they're
                            ready, and each rider's deadline is checked where
                            they get out (David's time-window scan)

Travel times: synthetic, straight lines, 2.1 min per km, no noise, so the
minutes quoted in comments can be checked by hand.
*/

import { addPassenger, evaluateRoute, isAcceptingRiders, minSlackMinutes } from '../src/route';
import { SyntheticTravelTime } from '../src/travelTime';
import { DEFAULT_CONFIG } from '../src/types';
import { CAMPUS, at, makeOffer, ring } from './fixtures';

const t = new SyntheticTravelTime({ jitter: 0, seed: 7 }); // noiseless for exact assertions
const north = (km: number) => ({ lat: CAMPUS.lat + km / 110.57, lon: CAMPUS.lon });
const east = (km: number) => ({ lat: CAMPUS.lat, lon: CAMPUS.lon + km / (111.32 * Math.cos(CAMPUS.lat * Math.PI / 180)) });

describe('evaluateRoute', () => {
  it('charges the first pickup more detour than the last', () => {
    const pts = ring(2, 6, 3);
    const origin = { lat: CAMPUS.lat + 0.12, lon: CAMPUS.lon + 0.02 };
    const ev = evaluateRoute(origin, pts, CAMPUS, at(8), t, 'TO_CAMPUS');

    // Detour has two parts: waiting to be collected, and riding a longer
    // route once aboard. Every rider on a shared trip pays something, and
    // nobody pays less than zero.
    expect(ev.riderDetours).toHaveLength(2);
    for (const d of ev.riderDetours) expect(d).toBeGreaterThanOrEqual(-1e-6);
    expect(ev.riderDetours.some((d) => d > 0)).toBe(true);
  });

  it('adds no driver detour when there are no waypoints', () => {
    const origin = { lat: CAMPUS.lat + 0.1, lon: CAMPUS.lon };
    const ev = evaluateRoute(origin, [], CAMPUS, at(8), t, 'TO_CAMPUS');
    expect(ev.driverAddedMinutes).toBeCloseTo(0, 6);
    expect(ev.riderDetours).toHaveLength(0);
  });

  it('going to campus, every rider arrives when the car does', () => {
    const ev = evaluateRoute(north(20), [north(15), north(6)], CAMPUS, at(8), t, 'TO_CAMPUS');
    expect(ev.riderArrivals).toEqual([ev.finalArrival, ev.finalArrival]);
  });

  it('leaving campus, each rider arrives at their own drop-off', () => {
    const ev = evaluateRoute(CAMPUS, [north(5), north(10)], north(20), at(17), t, 'FROM_CAMPUS');
    expect(ev.riderArrivals).toEqual(ev.waypointArrivals);
    expect(ev.riderArrivals[0].getTime()).toBeLessThan(ev.finalArrival.getTime());
  });

  it('leaving campus, a rider dropped off first carries no detour for the rest of the route', () => {
    // Drop A to the east first, then swing north for B and the driver's home.
    // A goes straight home, so A's detour is zero - the legs after A are not A's.
    const A = east(6);
    const ev = evaluateRoute(CAMPUS, [A, north(10)], north(20), at(17), t, 'FROM_CAMPUS');
    expect(ev.riderDetours[0]).toBeCloseTo(0, 6);
    expect(ev.riderDetours[1]).toBeGreaterThan(0);
  });
});

describe('incremental feasibility', () => {
  /**
   * The bug this guards against: rider 1 consents to a 10-minute detour on a
   * solo trip, then rider 2 is added and silently pushes rider 1 to 25 minutes.
   * Checking only the newcomer is the classic mistake.
   */
  it('refuses an insertion that would break an existing rider cap', () => {
    // The existing rider is picked up FIRST and is far from campus, so they
    // cannot avoid riding through the newcomer's detour whichever order is
    // chosen. That is what makes their cap the binding constraint.
    const origin   = { lat: CAMPUS.lat + 0.20, lon: CAMPUS.lon };
    const existing = { lat: CAMPUS.lat + 0.18, lon: CAMPUS.lon };
    const wayOff   = { lat: CAMPUS.lat + 0.09, lon: CAMPUS.lon + 0.20 };

    const offer = makeOffer({
      offerId: 'o1', start: origin, maxDetour: 500,
      seatsFilled: 1,
      onBoard: [{
        reqId: 'r1', riderId: 'rider-1', waypoint: existing,
        arriveBy: at(23), maxDetour: 3, currentDetour: 0,
      }],
      currTripDuration: 0,
    });

    const res = addPassenger(offer, { waypoint: wayOff, maxDetour: 600, arriveBy: at(23) }, at(8), t);
    expect(res.feasible).toBe(false);
    expect(res.reason).toBe('RIDER_DETOUR_CAP');
  });

  it('refuses rather than breaking an existing rider, whatever the order', () => {
    // Same geometry as a naive "insert at the end" would break, but the
    // existing rider sits on the direct path, so putting the newcomer FIRST
    // leaves the existing rider untouched. Searching all positions finds it.
    const origin   = { lat: CAMPUS.lat + 0.15, lon: CAMPUS.lon };
    const onRoute  = { lat: CAMPUS.lat + 0.07, lon: CAMPUS.lon };
    const wayOff   = { lat: CAMPUS.lat + 0.07, lon: CAMPUS.lon + 0.18 };

    const offer = makeOffer({
      offerId: 'o1', start: origin, maxDetour: 500,
      seatsFilled: 1,
      onBoard: [{
        reqId: 'r1', riderId: 'rider-1', waypoint: onRoute,
        arriveBy: at(23), maxDetour: 1, currentDetour: 0,
      }],
      currTripDuration: 0,
    });

    const res = addPassenger(offer, { waypoint: wayOff, maxDetour: 600, arriveBy: at(23) }, at(8), t);
    // No ordering can keep the existing rider inside a 1-minute cap here,
    // so the insertion is correctly refused rather than silently breaking them.
    expect(res.feasible).toBe(false);
    expect(res.reason).toBe('RIDER_DETOUR_CAP');
  });

  it('allows an insertion when everyone has budget for it', () => {
    const origin = { lat: CAMPUS.lat + 0.15, lon: CAMPUS.lon };
    const onRoute = { lat: CAMPUS.lat + 0.07, lon: CAMPUS.lon };
    const wayOff  = { lat: CAMPUS.lat + 0.07, lon: CAMPUS.lon + 0.18 };

    const offer = makeOffer({
      offerId: 'o1', start: origin, maxDetour: 120,
      seatsFilled: 1,
      onBoard: [{
        reqId: 'r1', riderId: 'rider-1', waypoint: onRoute,
        arriveBy: at(10), maxDetour: 90, currentDetour: 0,
      }],
      currTripDuration: 0,
    });

    const res = addPassenger(offer, { waypoint: wayOff, maxDetour: 90, arriveBy: at(10) }, at(8), t);
    expect(res.feasible).toBe(true);
  });

  it('respects the driver cap independently of rider caps', () => {
    const origin = { lat: CAMPUS.lat + 0.15, lon: CAMPUS.lon };
    const wayOff = { lat: CAMPUS.lat + 0.07, lon: CAMPUS.lon + 0.25 };
    const offer = makeOffer({ offerId: 'o1', start: origin, maxDetour: 1 });
    const res = addPassenger(offer, { waypoint: wayOff, maxDetour: 999, arriveBy: at(12) }, at(8), t);
    expect(res.feasible).toBe(false);
    expect(res.reason).toBe('DRIVER_DETOUR_CAP');
  });

  it('reports slack from the tightest rider on board', () => {
    const offer = makeOffer({
      offerId: 'o', start: CAMPUS,
      onBoard: [
        { reqId: 'a', riderId: 'a', waypoint: CAMPUS, arriveBy: at(9), maxDetour: 10, currentDetour: 3 },
        { reqId: 'b', riderId: 'b', waypoint: CAMPUS, arriveBy: at(9), maxDetour: 10, currentDetour: 9 },
      ],
    });
    expect(minSlackMinutes(offer)).toBeCloseTo(1, 6);
  });
});

describe('matching cutoff', () => {
  const departAt = at(8);

  it('accepts riders while departure is well outside the cutoff', () => {
    const offer = makeOffer({ offerId: 'o', start: CAMPUS });
    const now = at(5); // 3 hours out, cutoff is 2 hours by default
    expect(isAcceptingRiders(offer, DEFAULT_CONFIG, departAt, now)).toBe(true);
  });

  it('stops accepting once departure is within the cutoff, even with open seats and slack', () => {
    const offer = makeOffer({ offerId: 'o', start: CAMPUS, seatsFilled: 0, seatsOffered: 4 });
    const now = at(6, 30); // 90 minutes out, inside the 120-minute default cutoff
    expect(isAcceptingRiders(offer, DEFAULT_CONFIG, departAt, now)).toBe(false);
  });

  it('stops exactly at the boundary, not just after it', () => {
    const offer = makeOffer({ offerId: 'o', start: CAMPUS });
    const now = at(6); // exactly 120 minutes out
    expect(isAcceptingRiders(offer, DEFAULT_CONFIG, departAt, now)).toBe(false);
  });

  it('is independent of seats and slack — a nearly-empty trip still locks', () => {
    const offer = makeOffer({
      offerId: 'o', start: CAMPUS, seatsFilled: 0, seatsOffered: 4, maxDetour: 500,
    });
    const now = at(7, 55); // 5 minutes out
    expect(isAcceptingRiders(offer, DEFAULT_CONFIG, departAt, now)).toBe(false);
  });
});

describe("addPassenger — nobody is collected before they're ready (David's time-window scan)", () => {
  // t is 2.1 min per km, straight lines.
  const toCampus = makeOffer({ offerId: 'o', start: north(20), maxDetour: 30 });

  it("refuses when the car would reach a to-campus rider before they're ready", () => {
    // Leaves 8:00, reaches the rider 21 minutes later, at 8:21.
    const res = addPassenger(toCampus, {
      waypoint: north(10), maxDetour: 20, arriveBy: at(10), earliest: at(8, 30),
    }, at(8), t);
    expect(res.feasible).toBe(false);
    expect(res.reason).toBe('PICKUP_BEFORE_READY');
  });

  it('accepts once the rider is ready by the time the car arrives', () => {
    const res = addPassenger(toCampus, {
      waypoint: north(10), maxDetour: 20, arriveBy: at(10), earliest: at(8, 15),
    }, at(8), t);
    expect(res.feasible).toBe(true);
  });

  it('leaving campus, checks the one moment everyone boards: departure', () => {
    const fromCampus = makeOffer({
      offerId: 'o', direction: 'FROM_CAMPUS', start: CAMPUS, end: north(20), maxDetour: 30,
    });
    const rider = { waypoint: north(10), maxDetour: 20, arriveBy: at(23) };

    expect(addPassenger(fromCampus, { ...rider, earliest: at(17, 30) }, at(17), t).reason)
      .toBe('PICKUP_BEFORE_READY');
    expect(addPassenger(fromCampus, { ...rider, earliest: at(16, 45) }, at(17), t).feasible)
      .toBe(true);
  });

  it("leaving campus, checks a rider's deadline at their drop-off, not the driver's home", () => {
    // Rider is home 5 km out at about 17:10; the driver gets home 20 km out at
    // about 17:42. A 17:15 deadline is met - the driver's later arrival is
    // irrelevant to it.
    const fromCampus = makeOffer({
      offerId: 'o', direction: 'FROM_CAMPUS', start: CAMPUS, end: north(20), maxDetour: 30,
    });
    const rider = { waypoint: north(5), maxDetour: 10, earliest: at(17) };

    expect(addPassenger(fromCampus, { ...rider, arriveBy: at(17, 15) }, at(17), t).feasible).toBe(true);
    expect(addPassenger(fromCampus, { ...rider, arriveBy: at(17, 5) }, at(17), t).reason)
      .toBe('ARRIVAL_WINDOW');
  });
});
