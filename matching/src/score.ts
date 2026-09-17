import { MatchOffer, MatchPairing, MatchRequest, TravelTimeMatrix } from './types';
import { bestInsertion } from './route';
import { waypointOf } from './filter';

/**
 * KEY-139. Two-sided scoring, mirroring matchPairing { offerScore, reqScore }.
 *
 * Both scores are in [0, 1], higher is better, so they are comparable across
 * pairs with different detour budgets.
 *
 *   offerScore — the DRIVER's view. How little this rider disrupts the trip,
 *                as a fraction of the driver's own tolerance, nudged up when
 *                soft preferences align.
 *
 *   reqScore   — the RIDER's view. How little detour they absorb against their
 *                own cap, plus how comfortably they make their arrival time.
 *
 * Keeping the two separate matters: if both sides rank on the same quantity the
 * preference lists are mirror images and the two-sided model buys nothing.
 */

export interface ScoreWeights {
  riderDetourWeight: number;
  riderArrivalWeight: number;
  driverDisruptionWeight: number;
  driverPreferenceWeight: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  riderDetourWeight: 0.7,
  riderArrivalWeight: 0.3,
  driverDisruptionWeight: 0.85,
  driverPreferenceWeight: 0.15,
};

/** Soft preference alignment in [0, 1]. Boosts, never blocks — hard constraints
 *  are the filter's job. */
export function preferenceAffinity(req: MatchRequest, offer: MatchOffer): number {
  let matched = 0;
  let total = 0;

  total += 1;
  if (req.preferences.quietRide === offer.preferences.quietRide) matched += 1;

  total += 1;
  if (!req.preferences.luggage || offer.preferences.luggage) matched += 1;

  return total === 0 ? 1 : matched / total;
}

export interface ScoredPairing extends MatchPairing {
  req: MatchRequest;
  offer: MatchOffer;
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
  const insertion = bestInsertion(
    offer, waypointOf(req), req.maxDetour, req.arriveBy, departAt, t,
  );
  if (!insertion.feasible || !insertion.evaluation) return null;

  const ev = insertion.evaluation;
  const riderDetour = insertion.newRiderDetour ?? 0;
  const marginal = insertion.marginalDriverMinutes ?? 0;

  // --- rider's view -------------------------------------------------------
  // 1 when the detour is nil, 0 when it exactly consumes their cap.
  const detourScore = clamp01(1 - riderDetour / Math.max(1, req.maxDetour));

  // How much buffer they keep before their arriveBy, saturating at 30 min.
  const bufferMin = (req.arriveBy.getTime() - ev.finalArrival.getTime()) / 60_000;
  const arrivalScore = clamp01(bufferMin / 30);

  const reqScore =
    w.riderDetourWeight * detourScore + w.riderArrivalWeight * arrivalScore;

  // --- driver's view ------------------------------------------------------
  // Marginal cost of this rider against the driver's remaining tolerance.
  const remaining = Math.max(1, offer.maxDetour - (offer.currTripDuration
    ? ev.driverAddedMinutes - marginal
    : 0));
  const disruptionScore = clamp01(1 - marginal / remaining);
  const affinity = preferenceAffinity(req, offer);

  const offerScore =
    w.driverDisruptionWeight * disruptionScore + w.driverPreferenceWeight * affinity;

  return {
    offerId: offer.offerId,
    reqId: req.reqId,
    offerScore,
    reqScore,
    insertionIndex: insertion.insertionIndex,
    riderDetour,
    driverAddedMinutes: marginal,
    req,
    offer,
  };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
