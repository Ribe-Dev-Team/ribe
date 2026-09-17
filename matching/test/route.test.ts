import { bestInsertion, evaluateRoute, isAcceptingRiders, minSlackMinutes } from '../src/route';
import { SyntheticTravelTime } from '../src/travelTime';
import { DEFAULT_CONFIG } from '../src/types';
import { CAMPUS, at, makeOffer, ring } from './fixtures';

const t = new SyntheticTravelTime({ jitter: 0, seed: 7 }); // noiseless for exact assertions

describe('evaluateRoute', () => {
  it('charges the first pickup more detour than the last', () => {
    const pts = ring(2, 6, 3);
    const origin = { lat: CAMPUS.lat + 0.12, lon: CAMPUS.lon + 0.02 };
    const ev = evaluateRoute(origin, pts, CAMPUS, at(8), t);

    // Detour has two parts: waiting to be collected, and riding a longer
    // route once aboard. Every rider on a shared trip pays something, and
    // nobody pays less than zero.
    expect(ev.riderDetours).toHaveLength(2);
    for (const d of ev.riderDetours) expect(d).toBeGreaterThanOrEqual(-1e-6);
    expect(ev.riderDetours.some((d) => d > 0)).toBe(true);
  });

  it('adds no driver detour when there are no waypoints', () => {
    const origin = { lat: CAMPUS.lat + 0.1, lon: CAMPUS.lon };
    const ev = evaluateRoute(origin, [], CAMPUS, at(8), t);
    expect(ev.driverAddedMinutes).toBeCloseTo(0, 6);
    expect(ev.riderDetours).toHaveLength(0);
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

    const res = bestInsertion(offer, wayOff, 600, at(23), at(8), t);
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

    const res = bestInsertion(offer, wayOff, 600, at(23), at(8), t);
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

    const res = bestInsertion(offer, wayOff, 90, at(10), at(8), t);
    expect(res.feasible).toBe(true);
  });

  it('respects the driver cap independently of rider caps', () => {
    const origin = { lat: CAMPUS.lat + 0.15, lon: CAMPUS.lon };
    const wayOff = { lat: CAMPUS.lat + 0.07, lon: CAMPUS.lon + 0.25 };
    const offer = makeOffer({ offerId: 'o1', start: origin, maxDetour: 1 });
    const res = bestInsertion(offer, wayOff, 999, at(12), at(8), t);
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
