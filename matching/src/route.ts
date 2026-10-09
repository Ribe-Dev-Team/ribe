import { Coord, Direction, MatchOffer, MatchingConfig, OnBoardRider, TravelTimeMatrix, TripStop } from './types';

export interface RouteEvaluation {
  /** Total driving time, origin to final destination, in minutes. */
  totalMinutes: number;
  /** Minutes added to the driver's own journey vs going direct. */
  driverAddedMinutes: number;
  /** Detour in minutes per waypoint, in route order. */
  riderDetours: number[];
  /** Clock time each waypoint is reached. */
  waypointArrivals: Date[];
  /** When each rider reaches their own destination, in route order: campus
   *  (the final stop) going to campus, their own waypoint coming from it. */
  riderArrivals: Date[];
  /** Arrival at the final destination - the driver's own arrival. */
  finalArrival: Date;
}

/**
 * Evaluate a concrete route: origin -> waypoints (in order) -> destination.
 *
 * A rider's detour is measured from THEIR perspective: how much longer their
 * journey takes on the shared route than it would have taken alone. That is
 * what the rider consented to, and what SMART Goal 1 measures.
 *
 * Direction decides where a rider's journey ends. Going to campus, the
 * waypoint is a pickup and they ride to the final stop. Coming from campus,
 * everyone boards at the origin and the waypoint is where they get out - the
 * rest of the route is the driver's business, not theirs.
 */
export function evaluateRoute(
  origin: Coord,
  waypoints: Coord[],
  destination: Coord,
  departAt: Date,
  t: TravelTimeMatrix,
  direction: Direction,
): RouteEvaluation {
  const seq = [origin, ...waypoints, destination];

  const legs: number[] = [];
  for (let i = 0; i < seq.length - 1; i++) {
    legs.push(t.minutes(seq[i], seq[i + 1]));
  }

  const totalMinutes = legs.reduce((a, b) => a + b, 0);
  const directMinutes = t.minutes(origin, destination);
  const finalArrival = new Date(departAt.getTime() + totalMinutes * 60_000);

  const waypointArrivals: Date[] = [];
  let cumulative = 0;
  for (let i = 0; i < waypoints.length; i++) {
    cumulative += legs[i];
    waypointArrivals.push(new Date(departAt.getTime() + cumulative * 60_000));
  }

  // The car reaches a waypoint later than it could have, because it stopped
  // for other people first. Reference point is the earliest the driver could
  // have got there, i.e. straight from the origin.
  //
  // Coming from campus that delay IS the rider's detour: they boarded at the
  // origin and the waypoint is where they get out.
  //
  // Going to campus it is only half of it - the rider also sits through every
  // later pickup on the way in. Leaving that half out is a real trap: the final
  // pickup would always score zero, because the last leg is the direct leg.
  // This is also why pickup order is part of feasibility, not just
  // optimisation: the first pickup absorbs the largest detour.
  const riderDetours = waypoints.map((w, idx) => {
    const reachedAt = legs.slice(0, idx + 1).reduce((a, b) => a + b, 0);
    const delay = reachedAt - t.minutes(origin, w);
    if (direction === 'FROM_CAMPUS') return delay;

    const remaining = legs.slice(idx + 1).reduce((a, b) => a + b, 0);
    return delay + remaining - t.minutes(w, destination);
  });

  return {
    totalMinutes,
    driverAddedMinutes: totalMinutes - directMinutes,
    riderDetours,
    waypointArrivals,
    riderArrivals: direction === 'FROM_CAMPUS' ? waypointArrivals : waypoints.map(() => finalArrival),
    finalArrival,
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
  /** When the car actually leaves: `departAt` slid later by `slideMinutes`.
   *  `evaluation` stays timed from `departAt`, the earliest it could leave. */
  departAt?: Date;
  reason?:
    | 'RIDER_DETOUR_CAP'
    | 'ONBOARD_DETOUR_CAP'
    | 'DRIVER_DETOUR_CAP'
    | 'ARRIVAL_WINDOW'
    | 'PICKUP_BEFORE_READY'
    | 'NO_FEASIBLE_INSERTION';
}

/** The rider being added, as `addPassenger` needs them. */
export interface NewPassenger {
  /** Pickup going to campus, drop-off coming from it (`waypointOf(req)`). */
  waypoint: Coord;
  maxDetour: number;
  arriveBy: Date;
  /** Earliest they can be collected (`req.travelWindow.start`). Omit to skip
   *  the time-window check for this rider. */
  earliest?: Date;
}

/**
 * KEY-138. Try every position for a new passenger and return the cheapest one
 * that keeps EVERYONE valid. Named after David's `addPassenger`
 * (backend/server/tripAdditions.ts), which it replaces.
 *
 * The critical rule: adding rider N must not break riders already on board.
 * Rider 1 consented to a 10-minute detour on a solo trip; they did not consent
 * to 25 minutes because two more people were added afterwards. Checking only
 * the newcomer is the classic bug here.
 */
export function addPassenger(
  offer: MatchOffer,
  passenger: NewPassenger,
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
      passenger.waypoint,
      ...existing.slice(idx).map((r) => r.waypoint),
    ];

    const ev = evaluateRoute(offer.start, waypoints, offer.end, departAt, t, offer.direction);

    // Driver's own cap, across the whole trip.
    if (ev.driverAddedMinutes > offer.maxDetour) {
      sawCapViolation ??= 'DRIVER_DETOUR_CAP';
      continue;
    }

    // Every rider's detour cap — existing riders included.
    const riders = [...existing.slice(0, idx), passenger, ...existing.slice(idx)];

    // Which rider breaks is kept apart - the newcomer's own cap, or someone
    // already aboard - because "this rider's detour is too long" and "this rider
    // would push someone else over" call for different explanations.
    let breach: InsertionResult['reason'] | undefined;
    for (let i = 0; i < riders.length; i++) {
      if (ev.riderDetours[i] > riders[i].maxDetour) {
        breach = i === idx ? 'RIDER_DETOUR_CAP' : 'ONBOARD_DETOUR_CAP'; break;
      }
      if (ev.riderArrivals[i] > riders[i].arriveBy) { breach = 'ARRIVAL_WINDOW'; break; }
    }
    if (breach) { sawCapViolation ??= breach; continue; }
    // Everyone makes it leaving at the earliest; now leave as late as that
    // allows, and check nobody is collected before they're ready THEN.
    const slide = slideMinutes(offer, riders, ev);
    if (!withinTimeWindows(offer, riders, ev, departAt, slide)) {
      sawCapViolation ??= 'PICKUP_BEFORE_READY'; continue;
    }

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
        departAt: new Date(departAt.getTime() + slide * 60_000),
      };
    }
  }

  if (!best.feasible && sawCapViolation) best.reason = sawCapViolation;
  return best;
}

/**
 * The car never collects anyone before they're ready. This is the forward half
 * of David's time-window scan (scanTripToUni / scanTripFromUni in
 * backend/server/tripAdditions.ts); the backward half - arriving too late - is
 * the arrival check `addPassenger` already makes.
 *
 * His scan also has to work out when the car can leave, because his model lets
 * departure move. Here every driver leaves at their stated time, so each stop's
 * time is already known and the check is direct: heading to campus a rider is
 * collected when the car reaches their door; leaving campus, everyone boards at
 * departure.
 *
 * The car is NOT modelled as waiting at a door for someone who isn't ready.
 * Waiting would delay everyone already aboard, which the detour maths doesn't
 * count, so an early arrival is treated as infeasible rather than quietly
 * under-reporting the detour.
 */
function withinTimeWindows(
  offer: MatchOffer,
  riders: Array<{ earliest?: Date }>,
  ev: RouteEvaluation,
  departAt: Date,
  slide: number,
): boolean {
  return riders.every((r, i) => {
    if (!r.earliest) return true;
    const collectedAt = offer.direction === 'TO_CAMPUS'
      ? ev.waypointArrivals[i].getTime() + slide * 60_000
      : departAt.getTime() + slide * 60_000;
    return collectedAt >= r.earliest.getTime();
  });
}

/**
 * How many minutes later than its earliest departure a trip to campus can
 * leave and still get everyone there by their deadline - so it arrives as close
 * to the deadline as it safely can, instead of at the start of everyone's
 * window. Deadlines already include `arrivalMarginMinutes`, so "on campus by
 * 9:00" lands at 8:50. Sliding is a pure time shift: detours, pickup order and
 * the arrival checks made at the earliest departure are all unchanged.
 *
 * Trips FROM campus don't slide: "leave from 5pm" means take me home when class
 * ends, so the earliest departure is the time that matters. Nor does a trip
 * whose driver has no deadline (`offer.arriveBy`), and a deadline already
 * passed at the earliest departure means 0 - leave as early as possible, never
 * later than that.
 *
 * `ev` must be timed from the earliest departure; `riders` are in route order.
 */
export function slideMinutes(
  offer: MatchOffer,
  riders: Array<{ arriveBy: Date }>,
  ev: RouteEvaluation,
): number {
  if (offer.direction !== 'TO_CAMPUS' || !offer.arriveBy) return 0;
  const spare = Math.min(
    offer.arriveBy.getTime() - ev.finalArrival.getTime(),
    ...riders.map((r, i) => r.arriveBy.getTime() - ev.riderArrivals[i].getTime()),
  ) / 60_000;
  return Math.max(0, spare);
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

/**
 * When a trip leaves: one time shared by the whole batch, or a per-offer lookup.
 *
 * A single time is fine for tests and simulations, where every driver leaves
 * together. Real batches (a day's trips in one direction) mix drivers leaving at
 * 7:30 and 8:15, and routing everyone from one shared time would check a late
 * driver's arrivals as if they had left early — reporting infeasible trips as
 * feasible. Every use of departure is already per offer, so a lookup slots in
 * without changing the algorithm.
 */
export type DepartureTime = Date | ((offer: MatchOffer) => Date);

export function departureOf(departAt: DepartureTime, offer: MatchOffer): Date {
  return departAt instanceof Date ? departAt : departAt(offer);
}

/** When everything on a route happens: the driver's departure and arrival, and
 *  each rider's pickup and arrival, in pickup order. */
export interface Timetable {
  departAt: Date;
  arriveAt: Date;
  stops: TripStop[];
}

/**
 * A route's timetable as it will really run: a trip to campus leaves as late as
 * still gets everyone there in time (`slideMinutes`), one leaving campus at the
 * driver's earliest - and leaving campus, everyone boards at that departure.
 * `ev` must be timed from `departAt`, the earliest departure; `riders` are in
 * route order. Used for a new match's proposed timetable and to fill in the
 * confirmed one for a car that lacks it.
 */
export function timetableFor(
  offer: MatchOffer,
  riders: Array<{ reqId: string; arriveBy: Date }>,
  ev: RouteEvaluation,
  departAt: Date,
): Timetable {
  const slideMs = slideMinutes(offer, riders, ev) * 60_000;
  const later = (d: Date) => new Date(d.getTime() + slideMs);
  const leavesAt = later(departAt);
  return {
    departAt: leavesAt,
    arriveAt: later(ev.finalArrival),
    stops: riders.map((r, j) => ({
      reqId: r.reqId,
      pickupAt: offer.direction === 'TO_CAMPUS' ? later(ev.waypointArrivals[j]) : leavesAt,
      arriveAt: later(ev.riderArrivals[j]),
    })),
  };
}
