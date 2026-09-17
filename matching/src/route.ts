import { Coord, MatchOffer, MatchingConfig, OnBoardRider, TravelTimeMatrix } from './types';

export interface RouteEvaluation {
  /** Total driving time, origin to final destination, in minutes. */
  totalMinutes: number;
  /** Minutes added to the driver's own journey vs going direct. */
  driverAddedMinutes: number;
  /** Detour in minutes per waypoint, in route order. */
  riderDetours: number[];
  /** Clock time each waypoint is reached. */
  waypointArrivals: Date[];
  /** Arrival at the final destination. */
  finalArrival: Date;
}

/**
 * Evaluate a concrete route: origin -> waypoints (in order) -> destination.
 *
 * A rider's detour is measured from THEIR perspective: how much longer their
 * journey takes on the shared route than it would have taken alone. That is
 * what the rider consented to, and what SMART Goal 1 measures.
 *
 * Note the asymmetry this produces: the first waypoint sits through every
 * later pickup and so absorbs the largest detour, while the last absorbs
 * almost none. Pickup order is therefore part of feasibility, not just
 * optimisation.
 */
export function evaluateRoute(
  origin: Coord,
  waypoints: Coord[],
  destination: Coord,
  departAt: Date,
  t: TravelTimeMatrix,
): RouteEvaluation {
  const seq = [origin, ...waypoints, destination];

  const legs: number[] = [];
  for (let i = 0; i < seq.length - 1; i++) {
    legs.push(t.minutes(seq[i], seq[i + 1]));
  }

  const totalMinutes = legs.reduce((a, b) => a + b, 0);
  const directMinutes = t.minutes(origin, destination);

  const waypointArrivals: Date[] = [];
  let cumulative = 0;
  for (let i = 0; i < waypoints.length; i++) {
    cumulative += legs[i];
    waypointArrivals.push(new Date(departAt.getTime() + cumulative * 60_000));
  }

  // A rider's detour has TWO components, and using only the second is a real
  // trap: the final pickup would then always score exactly zero, because the
  // last leg is by definition the direct leg.
  //
  //   waiting  - the car reaches them later than it could have, because it
  //              collected other people first
  //   riding   - once aboard, the remaining route is longer than going direct
  //
  // Reference point is the earliest the driver could have reached them, i.e.
  // straight from the driver's origin. Anything beyond that is time the rider
  // spends because this is a shared trip.
  const riderDetours = waypoints.map((w, idx) => {
    const pickupAt = legs.slice(0, idx + 1).reduce((a, b) => a + b, 0);
    const earliestPickup = t.minutes(origin, w);
    const waiting = pickupAt - earliestPickup;

    const remaining = legs.slice(idx + 1).reduce((a, b) => a + b, 0);
    const riding = remaining - t.minutes(w, destination);

    return waiting + riding;
  });

  return {
    totalMinutes,
    driverAddedMinutes: totalMinutes - directMinutes,
    riderDetours,
    waypointArrivals,
    finalArrival: new Date(departAt.getTime() + totalMinutes * 60_000),
  };
}

export interface InsertionResult {
  feasible: boolean;
  insertionIndex: number;
  evaluation?: RouteEvaluation;
  /** Minutes the new rider would experience as detour. */
  newRiderDetour?: number;
  /** Extra minutes added to the driver's trip by this insertion. */
  marginalDriverMinutes?: number;
  reason?:
    | 'RIDER_DETOUR_CAP'
    | 'DRIVER_DETOUR_CAP'
    | 'ARRIVAL_WINDOW'
    | 'NO_FEASIBLE_INSERTION';
}

/**
 * KEY-138. Try every insertion position for a new rider and return the cheapest
 * one that keeps EVERYONE valid.
 *
 * The critical rule: adding rider N must not break riders already on board.
 * Rider 1 consented to a 10-minute detour on a solo trip; they did not consent
 * to 25 minutes because two more people were added afterwards. Checking only
 * the newcomer is the classic bug here.
 */
export function bestInsertion(
  offer: MatchOffer,
  newWaypoint: Coord,
  newRiderMaxDetour: number,
  newRiderArriveBy: Date,
  departAt: Date,
  t: TravelTimeMatrix,
): InsertionResult {
  const existing = offer.onBoard;
  const baseDirect = t.minutes(offer.start, offer.end);

  let best: InsertionResult = { feasible: false, insertionIndex: -1, reason: 'NO_FEASIBLE_INSERTION' };
  let bestCost = Infinity;
  let sawCapViolation: InsertionResult['reason'] | undefined;

  for (let idx = 0; idx <= existing.length; idx++) {
    const waypoints = [
      ...existing.slice(0, idx).map((r) => r.waypoint),
      newWaypoint,
      ...existing.slice(idx).map((r) => r.waypoint),
    ];

    const ev = evaluateRoute(offer.start, waypoints, offer.end, departAt, t);

    // Driver's own cap, across the whole trip.
    if (ev.driverAddedMinutes > offer.maxDetour) {
      sawCapViolation ??= 'DRIVER_DETOUR_CAP';
      continue;
    }

    // Every rider's detour cap — existing riders included.
    const riders = [
      ...existing.slice(0, idx),
      { maxDetour: newRiderMaxDetour, arriveBy: newRiderArriveBy },
      ...existing.slice(idx),
    ];

    let capOk = true;
    let arrivalOk = true;
    for (let i = 0; i < riders.length; i++) {
      if (ev.riderDetours[i] > riders[i].maxDetour) { capOk = false; break; }
      if (ev.finalArrival > riders[i].arriveBy) { arrivalOk = false; break; }
    }
    if (!capOk)     { sawCapViolation ??= 'RIDER_DETOUR_CAP'; continue; }
    if (!arrivalOk) { sawCapViolation ??= 'ARRIVAL_WINDOW';   continue; }

    // Cheapest feasible insertion wins, measured by marginal driver cost.
    const marginal = ev.totalMinutes - (offer.currTripDuration || baseDirect);
    if (marginal < bestCost) {
      bestCost = marginal;
      best = {
        feasible: true,
        insertionIndex: idx,
        evaluation: ev,
        newRiderDetour: ev.riderDetours[idx],
        marginalDriverMinutes: marginal,
      };
    }
  }

  if (!best.feasible && sawCapViolation) best.reason = sawCapViolation;
  return best;
}

/**
 * Minutes of detour budget left before the tightest-constrained person on
 * board is maxed out. Once this approaches zero the trip should stop searching
 * even with empty seats — capacity is bounded by consent, not seats.
 */
export function minSlackMinutes(offer: MatchOffer): number {
  if (offer.onBoard.length === 0) return Infinity;
  return Math.min(...offer.onBoard.map((r) => r.maxDetour - r.currentDetour));
}

/**
 * A trip stops accepting riders for one of four reasons: it's full, the
 * driver closed it, the tightest rider on board has run out of slack, or —
 * this last one added here — departure is now within the matching cutoff.
 * The cutoff is checked against `departAt`, not `now` alone, so callers must
 * supply both explicitly rather than this function reaching for the wall
 * clock; that keeps a whole matching run reproducible from its inputs.
 */
export function isAcceptingRiders(
  offer: MatchOffer,
  cfg: MatchingConfig,
  departAt: Date,
  now: Date,
): boolean {
  if (offer.status !== 'open') return false;
  if (!offer.acceptingMore) return false;
  if (offer.seatsFilled >= offer.seatsOffered) return false;
  if (minSlackMinutes(offer) <= cfg.insertionFloorMinutes) return false;
  if (minutesToDeparture(departAt, now) <= cfg.matchingCutoffMinutes) return false;
  return true;
}

/** Minutes remaining before departure, as of `now`. Negative once departure
 *  has passed. */
export function minutesToDeparture(departAt: Date, now: Date): number {
  return (departAt.getTime() - now.getTime()) / 60_000;
}
