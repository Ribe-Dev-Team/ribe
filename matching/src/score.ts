import { MatchOffer, MatchPairing, MatchRequest, TravelTimeMatrix } from './types';
import { addPassenger, evaluateRoute, RouteEvaluation } from './route';
import { waypointOf } from './filter';

/**
 * KEY-139. Two-sided scoring, mirroring matchPairing { offerScore, reqScore }.
 * Structured and named after David's scoring (backend/server/scoring.ts):
 * `calcDriverScore` and `calcPassengerScore`, each a weighted blend of [0, 1]
 * sub-scores, with his factor names on `ScoreWeights`.
 *
 *   offerScore = calcDriverScore
 *              = drivingTimeFactor    x how little of the driver's remaining
 *                                        detour this rider uses up
 *              + driverSlackFactor    x how much arrival slack the car keeps
 *
 *   reqScore   = calcPassengerScore
 *              = detourFactor         x how little of their own detour cap
 *                                        the rider uses up
 *              + punctualityFactor    x how comfortably they make their own
 *                                        arrival time
 *              + passengerSlackFactor x how much arrival slack the car keeps
 *
 * The driving-time score was already this module's offerScore before - David's
 * formula for it is the same quantity. Slack is the part taken from him: minutes
 * to spare before the TIGHTEST deadline anyone in the car has, after adding this
 * rider, as a share of what it was before. Two riders can cost the same minutes
 * while one of them has to be at campus much earlier - slack is what tells them
 * apart. (Not to be confused with `minSlackMinutes` in route.ts, which is detour
 * room left, not time.)
 *
 * The detour term on the rider's side is NOT in David's version. It stays
 * because SMART Goal 1 is measured in detour, so the rider's ranking should
 * still prefer less of it.
 *
 * Both scores are in [0, 1], higher is better. `reqScore` decides which driver
 * each rider asks first. `offerScore` is reported with every match, but the
 * run's keep-or-bump choice compares raw marginal minutes instead: slack penalises
 * riders with tight deadlines, who are the hardest to place, and letting it
 * decide bumps strands them (see deferredAcceptance.ts).
 *
 * No other preferences remain: gender and luggage were removed as hard gates
 * (thin pool, match rate is the binding constraint), and quiet-ride affinity
 * was removed because it never influenced which rider a trip kept.
 */

/**
 * Dimensionless multipliers, each on an already-normalised [0, 1] sub-score.
 * Each side's factors sum to 1. Names follow David's constants
 * (DRIVING_TIME_FACTOR, DR_SLACK_TIME_FACTOR, PUNCTUALITY_FACTOR,
 * P_SLACK_TIME_FACTOR); `detourFactor` is ours.
 */
export interface ScoreWeights {
  drivingTimeFactor: number;
  driverSlackFactor: number;
  detourFactor: number;
  punctualityFactor: number;
  passengerSlackFactor: number;
}

/**
 * Driver side: David's values exactly (0.8 / 0.2). Rider side: a judgement
 * call - detour keeps the largest share because Goal 1 is measured in it, and
 * the rest is split evenly between the rider's own arrival buffer and the whole
 * car's slack. Sweepable; the sensitivity sweep is still outstanding.
 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  drivingTimeFactor: 0.8,
  driverSlackFactor: 0.2,
  detourFactor: 0.6,
  punctualityFactor: 0.2,
  passengerSlackFactor: 0.2,
};

export interface ScoredPairing extends MatchPairing {
  req: MatchRequest;
  offer: MatchOffer;
  /** The route with this rider added, at `insertionIndex`. */
  evaluation: RouteEvaluation;
}

// --- sub-scores, each in [0, 1] ---------------------------------------------

/** 1 when the insertion adds no driving, 0 when it uses all the detour the
 *  driver has left. The driver's `newRemDetour / currRemDetour` in David's. */
export function calcDrivingTimeScore(marginalMinutes: number, remainingDetourMinutes: number): number {
  return clamp01(1 - marginalMinutes / Math.max(1, remainingDetourMinutes));
}

/** 1 when the rider is carried with no detour, 0 when it uses their whole cap. */
export function calcDetourScore(riderDetourMinutes: number, maxDetourMinutes: number): number {
  return clamp01(1 - riderDetourMinutes / Math.max(1, maxDetourMinutes));
}

/** Spare minutes before the rider's own arrival time, full marks at 30+. */
export function calcOnTimeScore(bufferMinutes: number): number {
  return clamp01(bufferMinutes / 30);
}

/** Share of the car's arrival slack left after adding the rider. */
export function calcSlackScore(slackBeforeMinutes: number, slackAfterMinutes: number): number {
  return clamp01(slackAfterMinutes / Math.max(1, slackBeforeMinutes));
}

export function calcDriverScore(drivingTime: number, slack: number, w: ScoreWeights): number {
  return w.drivingTimeFactor * drivingTime + w.driverSlackFactor * slack;
}

export function calcPassengerScore(detour: number, onTime: number, slack: number, w: ScoreWeights): number {
  return w.detourFactor * detour + w.punctualityFactor * onTime + w.passengerSlackFactor * slack;
}

// --- slack ------------------------------------------------------------------

/** The latest the driver can arrive: direct drive plus their whole detour. */
export function driverLatestArrival(offer: MatchOffer, departAt: Date, t: TravelTimeMatrix): Date {
  return new Date(departAt.getTime() + (t.minutes(offer.start, offer.end) + offer.maxDetour) * 60_000);
}

/**
 * Minutes to spare before the tightest deadline in the car. Each person is
 * measured at their own stop - the driver at the final one, each rider where
 * `addPassenger` checks their deadline (`RouteEvaluation.riderArrivals`).
 */
export function arrivalSlackMinutes(stops: Array<{ deadline: Date; arrival: Date }>): number {
  return Math.min(...stops.map((s) => (s.deadline.getTime() - s.arrival.getTime()) / 60_000));
}

/** `arrivalSlackMinutes` for an evaluated route. `riders` in route order. */
export function routeSlackMinutes(
  driverDeadline: Date,
  riders: Array<{ arriveBy: Date }>,
  ev: RouteEvaluation,
): number {
  return arrivalSlackMinutes([
    { deadline: driverDeadline, arrival: ev.finalArrival },
    ...riders.map((r, i) => ({ deadline: r.arriveBy, arrival: ev.riderArrivals[i] })),
  ]);
}

// --- putting it together ------------------------------------------------------

/** What both scores are computed from. Minutes unless noted. */
export interface PairingMetrics {
  riderDetour: number;
  riderMaxDetour: number;
  /** Minutes between this rider reaching their destination and their arriveBy. */
  riderBuffer: number;
  marginalDriverMinutes: number;
  /** Driver's detour budget left before this rider was added. */
  driverRemainingDetour: number;
  slackBefore: number;
  slackAfter: number;
}

/** The one definition of both scores, shared by `scorePairing` and the run's
 *  final accounting in deferredAcceptance.ts. */
export function scoreFromMetrics(m: PairingMetrics, w: ScoreWeights): { offerScore: number; reqScore: number } {
  const slack = calcSlackScore(m.slackBefore, m.slackAfter);
  return {
    offerScore: calcDriverScore(calcDrivingTimeScore(m.marginalDriverMinutes, m.driverRemainingDetour), slack, w),
    reqScore: calcPassengerScore(
      calcDetourScore(m.riderDetour, m.riderMaxDetour), calcOnTimeScore(m.riderBuffer), slack, w,
    ),
  };
}

/**
 * Score one pair, or return null if no insertion position works.
 * Scoring implies feasibility — an unusable pair has no meaningful score.
 */
export function scorePairing(
  req: MatchRequest,
  offer: MatchOffer,
  departAt: Date,
  t: TravelTimeMatrix,
  w: ScoreWeights = DEFAULT_WEIGHTS,
): ScoredPairing | null {
  const insertion = addPassenger(offer, {
    waypoint: waypointOf(req),
    maxDetour: req.maxDetour,
    arriveBy: req.arriveBy,
    earliest: req.travelWindow.start,
  }, departAt, t);
  if (!insertion.feasible || !insertion.evaluation) return null;

  const ev = insertion.evaluation;
  const riderDetour = insertion.newRiderDetour ?? 0;
  const marginal = insertion.marginalDriverMinutes ?? 0;

  const idx = insertion.insertionIndex;

  // The car before this rider: its current route and everyone's deadlines.
  const driverDeadline = driverLatestArrival(offer, departAt, t);
  const before = evaluateRoute(
    offer.start, offer.onBoard.map((r) => r.waypoint), offer.end, departAt, t, offer.direction,
  );
  const ridersAfter = [...offer.onBoard.slice(0, idx), req, ...offer.onBoard.slice(idx)];

  const { offerScore, reqScore } = scoreFromMetrics({
    riderDetour,
    riderMaxDetour: req.maxDetour,
    riderBuffer: (req.arriveBy.getTime() - ev.riderArrivals[idx].getTime()) / 60_000,
    marginalDriverMinutes: marginal,
    driverRemainingDetour: offer.maxDetour - (offer.currTripDuration ? ev.driverAddedMinutes - marginal : 0),
    slackBefore: routeSlackMinutes(driverDeadline, offer.onBoard, before),
    slackAfter: routeSlackMinutes(driverDeadline, ridersAfter, ev),
  }, w);

  return {
    offerId: offer.offerId,
    reqId: req.reqId,
    offerScore,
    reqScore,
    insertionIndex: idx,
    riderDetour,
    driverAddedMinutes: marginal,
    req,
    offer,
    evaluation: ev,
  };
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
