import {
  MatchOffer, MatchRequest, MatchingConfig, DEFAULT_CONFIG,
  RejectedPairing, TravelTimeMatrix,
} from './types';
import { hardFilter, waypointOf } from './filter';
import { scorePairing, ScoredPairing, ScoreWeights, DEFAULT_WEIGHTS } from './score';
import { bestInsertion, isAcceptingRiders, minSlackMinutes, minutesToDeparture } from './route';

export interface ProposedMatch {
  offerId: string;
  reqId: string;
  riderId: string;
  driverId: string;
  insertionIndex: number;
  riderDetour: number;
  driverAddedMinutes: number;
  offerScore: number;
  reqScore: number;
  finalArrival: Date;
  totalTripMinutes: number;
  /** When this batch produced the match — every match in one run shares it. */
  matchedAt: Date;
  /** By when the pair must accept, or the match lapses. Clamped to whichever
   *  comes first: the normal approval window, or the matching cutoff — a
   *  match proposed late must never promise more time to accept than the
   *  batch can actually give it before the trip locks. */
  acceptDeadline: Date;
}

/** Shared by every algorithm in this module: never promise a match more time
 *  to accept than the batch can actually honour before the trip locks. */
export function computeAcceptDeadline(now: Date, departAt: Date, cfg: MatchingConfig): Date {
  return new Date(Math.min(
    now.getTime() + cfg.approvalWindowMinutes * 60_000,
    departAt.getTime() - cfg.matchingCutoffMinutes * 60_000,
  ));
}

export interface MatchRunResult {
  batchKey: string;
  matches: ProposedMatch[];
  rejected: RejectedPairing[];
  unmatchedRequestIds: string[];
  stats: {
    requestsIn: number;
    offersIn: number;
    matchesMade: number;
    matchRate: number;
    avgRiderDetourMinutes: number;
    avgDriverAddedMinutes: number;
    seatsLeftOnClosedTrips: number;
    closedByDriverChoice: number;
    closedBySlack: number;
    closedByCutoff: number;
  };
}

/**
 * Sequential greedy assignment with incremental feasibility.
 *
 * One rider is placed at a time. After each placement the affected trip is
 * re-evaluated, because adding a rider changes the detour experienced by
 * everyone already aboard — preferences here are route-dependent, which is
 * precisely the assumption deferred acceptance (Gale-Shapley) makes and which
 * ridesharing violates. We therefore do NOT claim stability; we claim
 * feasibility, and we handle rejection natively, which a stable matching
 * cannot (its guarantee assumes every party accepts).
 *
 * Note this is greedy: locking an early pair can block a better global
 * arrangement. That cost is measurable — run the same batch with different
 * orderings and compare matchRate.
 */
export function runMatching(
  batchKey: string,
  requests: MatchRequest[],
  offers: MatchOffer[],
  departAt: Date,
  now: Date,
  t: TravelTimeMatrix,
  cfg: MatchingConfig = DEFAULT_CONFIG,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): MatchRunResult {
  // Work on copies: a matching run must not mutate its inputs.
  const liveOffers: MatchOffer[] = offers.map((o) => ({
    ...o,
    onBoard: o.onBoard.map((r) => ({ ...r })),
  }));
  const offerById = new Map(liveOffers.map((o) => [o.offerId, o]));

  const acceptDeadline = computeAcceptDeadline(now, departAt, cfg);

  const { rejected } = hardFilter(requests, liveOffers, cfg, departAt, now);
  const matches: ProposedMatch[] = [];
  const unmatched = new Set(
    requests.filter((r) => r.status === 'unassigned').map((r) => r.reqId),
  );
  const requestById = new Map(requests.map((r) => [r.reqId, r]));

  // Each pass places at most one rider per trip, so a driver's route only
  // changes between passes, never during scoring.
  let progress = true;
  while (progress) {
    progress = false;

    const scored: ScoredPairing[] = [];
    const { candidates } = hardFilter(
      [...unmatched].map((id) => requestById.get(id)!),
      liveOffers,
      cfg,
      departAt,
      now,
    );

    for (const { req, offer } of candidates.slice(0, cfg.maxCandidatePairs)) {
      const s = scorePairing(req, offer, departAt, t, weights);
      if (s) scored.push(s);
    }
    if (scored.length === 0) break;

    // Rank by combined desirability. Both sides count; neither dominates.
    scored.sort(
      (a, b) =>
        (b.offerScore + b.reqScore) - (a.offerScore + a.reqScore),
    );

    const usedOffers = new Set<string>();

    for (const pairing of scored) {
      if (!unmatched.has(pairing.reqId)) continue;
      if (usedOffers.has(pairing.offerId)) continue;

      const offer = offerById.get(pairing.offerId)!;
      if (!isAcceptingRiders(offer, cfg, departAt, now)) continue;

      const req = pairing.req;

      // Re-check against the CURRENT route. The score was computed against the
      // route as it stood at the start of this pass; nothing has changed it
      // yet, but re-checking keeps this correct if that ever stops holding.
      const insertion = bestInsertion(
        offer, waypointOf(req), req.maxDetour, req.arriveBy, departAt, t,
      );
      if (!insertion.feasible || !insertion.evaluation) continue;

      const ev = insertion.evaluation;

      offer.onBoard.splice(insertion.insertionIndex, 0, {
        reqId: req.reqId,
        riderId: req.riderId,
        waypoint: waypointOf(req),
        arriveBy: req.arriveBy,
        maxDetour: req.maxDetour,
        currentDetour: ev.riderDetours[insertion.insertionIndex],
      });
      // Everyone's detour shifts when the route changes.
      offer.onBoard.forEach((r, i) => { r.currentDetour = ev.riderDetours[i]; });
      offer.seatsFilled += 1;
      offer.currTripDuration = ev.totalMinutes;

      matches.push({
        offerId: offer.offerId,
        reqId: req.reqId,
        riderId: req.riderId,
        driverId: offer.driverId,
        insertionIndex: insertion.insertionIndex,
        riderDetour: ev.riderDetours[insertion.insertionIndex],
        driverAddedMinutes: insertion.marginalDriverMinutes ?? 0,
        offerScore: pairing.offerScore,
        reqScore: pairing.reqScore,
        finalArrival: ev.finalArrival,
        totalTripMinutes: ev.totalMinutes,
        matchedAt: now,
        acceptDeadline,
      });

      unmatched.delete(req.reqId);
      usedOffers.add(offer.offerId);
      progress = true;

      if (offer.seatsFilled >= offer.seatsOffered) offer.status = 'closed';
    }
  }

  // --- reporting ----------------------------------------------------------
  const requestsIn = requests.filter((r) => r.status === 'unassigned').length;
  const matchesMade = matches.length;

  let seatsLeftOnClosedTrips = 0;
  let closedByDriverChoice = 0;
  let closedBySlack = 0;
  let closedByCutoff = 0;
  for (const o of liveOffers) {
    const spare = o.seatsOffered - o.seatsFilled;
    if (spare <= 0) continue;
    if (!o.acceptingMore) { closedByDriverChoice++; seatsLeftOnClosedTrips += spare; }
    else if (minutesToDeparture(departAt, now) <= cfg.matchingCutoffMinutes) {
      closedByCutoff++; seatsLeftOnClosedTrips += spare;
    } else if (minSlackMinutes(o) <= cfg.insertionFloorMinutes) {
      closedBySlack++; seatsLeftOnClosedTrips += spare;
    }
  }

  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

  return {
    batchKey,
    matches,
    rejected,
    unmatchedRequestIds: [...unmatched],
    stats: {
      requestsIn,
      offersIn: offers.length,
      matchesMade,
      matchRate: requestsIn ? matchesMade / requestsIn : 0,
      avgRiderDetourMinutes: mean(matches.map((m) => m.riderDetour)),
      avgDriverAddedMinutes: mean(matches.map((m) => m.driverAddedMinutes)),
      seatsLeftOnClosedTrips,
      closedByDriverChoice,
      closedBySlack,
      closedByCutoff,
    },
  };
}
