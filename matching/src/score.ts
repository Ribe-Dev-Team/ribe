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
 *                as a fraction of the driver's own remaining tolerance.
 *
 *   reqScore   — the RIDER's view. How little detour they absorb against their
 *                own cap, plus how comfortably they make their arrival time.
 *
 * Keeping the two separate matters: if both sides rank on the same quantity the
 * preference lists are mirror images and the two-sided model buys nothing.
 *
 * No soft preferences remain — gender and luggage were removed as hard gates
 * (thin pool, match rate is the binding constraint) and quiet-ride affinity
 * was removed too: it never influenced which rider a trip actually kept
 * (`deferredAcceptance.ts`'s bump decision compares raw marginal minutes, not
 * this score), so it was a cosmetic label, not a lever.
 */

/**
 * Dimensionless multipliers in [0, 1], not raw minutes or km. Each multiplies
 * an already-normalised [0, 1] sub-score (see detourScore/arrivalScore below),
 * so the two on the rider's side are meant to sum to 1 — they redistribute
 * share of a unitless score, they do not carry units themselves.
 */
export interface ScoreWeights {
  riderDetourWeight: number;
  riderArrivalWeight: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  riderDetourWeight: 0.7,
  riderArrivalWeight: 0.3,
};

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
  const riderDetour = insertion.newRiderDetour ?? 0;       // minutes
  const marginal = insertion.marginalDriverMinutes ?? 0;   // minutes

  // --- rider's view -------------------------------------------------------
  // detourScore is dimensionless [0, 1]: riderDetour and req.maxDetour are
  // both minutes, so the ratio cancels units. 1 when the detour is nil,
  // 0 when it exactly consumes their cap.
  const detourScore = clamp01(1 - riderDetour / Math.max(1, req.maxDetour));

  // How much buffer they keep before their arriveBy, in minutes, saturating
  // at 30 min. arrivalScore itself is dimensionless [0, 1].
  const bufferMin = (req.arriveBy.getTime() - ev.finalArrival.getTime()) / 60_000;
  const arrivalScore = clamp01(bufferMin / 30);

  // reqScore is dimensionless [0, 1] — a weighted blend of two [0, 1] scores.
  const reqScore =
    w.riderDetourWeight * detourScore + w.riderArrivalWeight * arrivalScore;

  // --- driver's view ------------------------------------------------------
  // Marginal cost of this rider against the driver's remaining tolerance.
  // `remaining` is minutes; offerScore is the dimensionless [0, 1] complement
  // of marginal (minutes) over remaining (minutes) — 1 when the insertion is
  // free, 0 when it exactly exhausts what's left of the driver's own cap.
  const remaining = Math.max(1, offer.maxDetour - (offer.currTripDuration
    ? ev.driverAddedMinutes - marginal
    : 0));
  const offerScore = clamp01(1 - marginal / remaining);

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

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
