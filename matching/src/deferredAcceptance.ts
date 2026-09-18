import {
  MatchOffer, MatchRequest, MatchingConfig, DEFAULT_CONFIG,
  OnBoardRider, TravelTimeMatrix,
} from './types';
import { hardFilter, waypointOf } from './filter';
import { scorePairing, clamp01, ScoreWeights, DEFAULT_WEIGHTS } from './score';
import { bestInsertion, evaluateRoute, RouteEvaluation } from './route';
import { MatchRunResult, ProposedMatch, computeAcceptDeadline } from './match';

/**
 * Provisional assignment with bumping (KEY-41, superseding one-shot greedy
 * as the default path — see README "Why not Gale-Shapley").
 *
 * NOT Gale-Shapley. Drivers do not rank riders — they are allocated riders
 * and may only veto or close. With one-sided preferences no blocking pair
 * can exist (a blocking pair needs BOTH parties to strictly prefer each
 * other), so every feasible assignment is trivially stable and the
 * stability guarantee is vacuous. What survives from deferred acceptance is
 * the MECHANISM — provisional holds and bumping — used as a search
 * heuristic, not preference resolution. Do not call this Gale-Shapley in
 * code, comments, or the report.
 *
 * Mechanism, one proposal at a time:
 *   1. An unassigned rider proposes to whichever untried, structurally
 *      compatible trip currently scores best for THEM (reqScore).
 *   2. That trip recomputes its best feasible subset from (whoever it is
 *      currently holding) + (this new proposer), size <= seats, feasible
 *      meaning every rider's detour cap AND arrival time still hold — tried
 *      across pickup orderings. Confirmed riders (present in offer.onBoard
 *      before this run started) are FIXED: always part of the subset, never
 *      bumped, because a human already accepted that trip.
 *   3. Anyone the trip drops (including possibly the rider who just
 *      proposed) returns to the pool and tries its next untried trip.
 *   4. Repeat until no rider has an untried trip left.
 *
 * Terminates because each (rider, trip) pair is inspected at most once: a
 * trip found not currently accepting, or not currently feasible for a
 * rider, is crossed off for that rider for the rest of THIS run, even
 * though it could in principle loosen up later if the trip bumps someone
 * else first. That is a real, accepted imprecision — this is a heuristic,
 * not an exhaustive search — and it is what keeps the algorithm bounded and
 * simple to reason about.
 *
 * Measured against one-shot greedy on identical batches (see
 * `test/compare.ts`): bumping wins match rate in every case (+1 to +8
 * points) at the cost of ~10x higher average rider detour. Both stay well
 * under the SMART Goal 1 ceiling. Not a free win — report both numbers.
 */
export function runMatchingProvisional(
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
  const requestById = new Map(requests.map((r) => [r.reqId, r]));

  // Riders already aboard when the run started are CONFIRMED — a human
  // accepted that trip in a previous run. They are fixed inputs: they
  // always survive into the final route, in their original relative order,
  // and they are never part of this run's `matches` output. Captured once,
  // before anything below mutates `liveOffers`.
  const fixedByOffer = new Map(
    liveOffers.map((o) => [o.offerId, o.onBoard.map((r) => ({ ...r }))]),
  );

  // A view of each offer holding ONLY its fixed riders, frozen for the whole
  // run. Used to score a rider's OWN ranking of untried trips — never the
  // live, currently-mutating `offer`, whose onBoard may already hold other
  // provisional riders. `bestInsertion` has no seat-capacity check of its
  // own (bestFeasibleSubset is where capacity and bumping are decided), so
  // scoring against a trip that already looks full-with-provisionals would
  // evaluate the nonsensical "insert on top of everyone currently held"
  // route instead of "how would I fare against the confirmed baseline" —
  // silently reporting an occupied trip as infeasible for a rider who could
  // perfectly well bump their way in.
  const rankingOfferByOffer = new Map<string, MatchOffer>();
  for (const o of liveOffers) {
    const fixed = fixedByOffer.get(o.offerId)!;
    let currTripDuration = 0;
    if (fixed.length > 0) {
      const ev = evaluateRoute(o.start, fixed.map((r) => r.waypoint), o.end, departAt, t);
      currTripDuration = ev.totalMinutes;
    }
    rankingOfferByOffer.set(o.offerId, { ...o, onBoard: fixed, seatsFilled: fixed.length, currTripDuration });
  }

  const acceptDeadline = computeAcceptDeadline(now, departAt, cfg);

  const { candidates, rejected } = hardFilter(requests, liveOffers, cfg, departAt, now);
  const remaining = new Map<string, Set<string>>();
  for (const { req, offer } of candidates) {
    if (!remaining.has(req.reqId)) remaining.set(req.reqId, new Set());
    remaining.get(req.reqId)!.add(offer.offerId);
  }

  // Provisional (non-fixed) riders currently held per offer, in acceptance
  // order — NOT necessarily their final pickup order, which bestFeasibleSubset
  // re-derives every time the held set changes.
  const held = new Map<string, MatchRequest[]>();
  for (const o of liveOffers) held.set(o.offerId, []);

  // Riders with at least one structurally compatible trip, in input order —
  // deterministic given deterministic inputs.
  const free: string[] = requests
    .filter((r) => r.status === 'unassigned' && remaining.has(r.reqId))
    .map((r) => r.reqId);

  let cursor = 0;
  while (cursor < free.length) {
    const reqId = free[cursor++];
    const remOffers = remaining.get(reqId);
    if (!remOffers || remOffers.size === 0) continue; // exhausted every trip

    const req = requestById.get(reqId)!;

    // Scan untried trips, cross off any no longer structurally reachable at
    // all, and propose to whichever remaining one scores best for THIS
    // rider. Deliberately NOT `isAcceptingRiders` here: that gates on seats
    // remaining, and a FULL trip is exactly the case bumping needs to keep
    // considering — capacity is enforced inside bestFeasibleSubset instead.
    let bestOfferId: string | null = null;
    let bestReqScore = -Infinity;
    for (const offerId of [...remOffers]) {
      const offer = offerById.get(offerId)!;
      if (!stillTryable(offer, cfg, departAt, now)) { remOffers.delete(offerId); continue; }
      const s = scorePairing(req, rankingOfferByOffer.get(offerId)!, departAt, t, weights);
      if (!s) continue; // infeasible even against the confirmed baseline; leave untried in case that changes
      if (s.reqScore > bestReqScore) { bestReqScore = s.reqScore; bestOfferId = offerId; }
    }
    if (bestOfferId === null) continue; // nothing currently feasible; may be revisited if requeued later

    remOffers.delete(bestOfferId); // propose once, whatever the outcome

    const offer = offerById.get(bestOfferId)!;
    const fixedRiders = fixedByOffer.get(bestOfferId)!;
    const pool = [...held.get(bestOfferId)!, req];

    const subset = bestFeasibleSubset(offer, fixedRiders, pool, departAt, t);
    const keptIds = new Set(subset.kept.map((r) => r.reqId));

    held.set(bestOfferId, subset.kept);
    offer.onBoard = subset.onBoard;
    offer.seatsFilled = subset.onBoard.length;
    offer.currTripDuration = subset.ev.totalMinutes;
    // Status stays 'open' here even at full capacity — closing early would
    // stop this same trip from being proposed to again, and bumping a full
    // trip is the whole point. Finalized once, after the run converges.

    // Everyone in the pool not in the winning subset is bumped (or, for the
    // rider who just proposed, rejected outright) and goes back to the pool,
    // provided they still have an untried trip to try next.
    for (const candidate of pool) {
      if (keptIds.has(candidate.reqId)) continue;
      if ((remaining.get(candidate.reqId)?.size ?? 0) > 0) free.push(candidate.reqId);
    }
  }

  // Finalize status now that the run has converged — a trip that reached
  // capacity along the way stayed 'open' throughout so it could still be
  // proposed to (and bump a held rider) right up to the last round.
  for (const offer of liveOffers) {
    if (offer.seatsFilled >= offer.seatsOffered) offer.status = 'closed';
  }

  // --- build match records --------------------------------------------------
  const matches: ProposedMatch[] = [];
  for (const offer of liveOffers) {
    const fixedIds = new Set(fixedByOffer.get(offer.offerId)!.map((r) => r.reqId));
    const finalOrder = offer.onBoard;
    if (finalOrder.length === 0) continue;

    const waypoints = finalOrder.map((r) => r.waypoint);
    const fullEv = evaluateRoute(offer.start, waypoints, offer.end, departAt, t);

    for (let i = 0; i < finalOrder.length; i++) {
      const rider = finalOrder[i];
      if (fixedIds.has(rider.reqId)) continue; // already matched in a prior run

      const req = requestById.get(rider.reqId)!;
      const riderDetour = fullEv.riderDetours[i];

      // Marginal cost attributable to THIS rider: what the driver's total
      // added minutes would be without them, holding everyone else's order.
      const withoutWaypoints = [...waypoints.slice(0, i), ...waypoints.slice(i + 1)];
      const withoutEv = evaluateRoute(offer.start, withoutWaypoints, offer.end, departAt, t);
      const marginal = fullEv.totalMinutes - withoutEv.totalMinutes;

      const { offerScore, reqScore } = scoreFromMetrics(
        req, offer, riderDetour, marginal, fullEv.driverAddedMinutes, fullEv.finalArrival, weights,
      );

      matches.push({
        offerId: offer.offerId,
        reqId: req.reqId,
        riderId: req.riderId,
        driverId: offer.driverId,
        insertionIndex: i,
        riderDetour,
        driverAddedMinutes: marginal,
        offerScore,
        reqScore,
        finalArrival: fullEv.finalArrival,
        totalTripMinutes: fullEv.totalMinutes,
        matchedAt: now,
        acceptDeadline,
      });
    }
  }

  // --- reporting ------------------------------------------------------------
  const requestsIn = requests.filter((r) => r.status === 'unassigned').length;
  const matchesMade = matches.length;
  const matchedIds = new Set(matches.map((m) => m.reqId));
  const unmatchedRequestIds = requests
    .filter((r) => r.status === 'unassigned' && !matchedIds.has(r.reqId))
    .map((r) => r.reqId);

  let seatsLeftOnClosedTrips = 0;
  let closedByDriverChoice = 0;
  let closedBySlack = 0;
  let closedByCutoff = 0;
  for (const o of liveOffers) {
    const spare = o.seatsOffered - o.seatsFilled;
    if (spare <= 0) continue;
    if (!o.acceptingMore) { closedByDriverChoice++; seatsLeftOnClosedTrips += spare; }
    else if ((departAt.getTime() - now.getTime()) / 60_000 <= cfg.matchingCutoffMinutes) {
      closedByCutoff++; seatsLeftOnClosedTrips += spare;
    } else if (minSlackOf(o) <= cfg.insertionFloorMinutes) {
      closedBySlack++; seatsLeftOnClosedTrips += spare;
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  return {
    batchKey,
    matches,
    rejected,
    unmatchedRequestIds,
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

/**
 * Whether a trip is still worth proposing to DURING a run — permanent
 * exclusions only (closed/locked/cancelled, driver locked it, past cutoff).
 * Unlike `isAcceptingRiders` (route.ts), this does NOT gate on seats or
 * slack: a full trip must remain reachable so a cheaper proposer can still
 * bump a held rider. Capacity and slack are enforced by bestFeasibleSubset,
 * per proposal, not by excluding the trip outright.
 */
function stillTryable(offer: MatchOffer, cfg: MatchingConfig, departAt: Date, now: Date): boolean {
  if (offer.status !== 'open') return false;
  if (!offer.acceptingMore) return false;
  if ((departAt.getTime() - now.getTime()) / 60_000 <= cfg.matchingCutoffMinutes) return false;
  return true;
}

function minSlackOf(offer: MatchOffer): number {
  if (offer.onBoard.length === 0) return Infinity;
  return Math.min(...offer.onBoard.map((r) => r.maxDetour - r.currentDetour));
}

/**
 * offerScore/reqScore for a rider given final route metrics — the same
 * formulas as `scorePairing` (score.ts), factored out so both the
 * single-insertion path (match.ts, via scorePairing) and this module's
 * post-convergence, whole-route accounting agree on one definition.
 */
function scoreFromMetrics(
  req: MatchRequest,
  offer: MatchOffer,
  riderDetour: number,
  marginalDriverMinutes: number,
  totalDriverAddedMinutes: number,
  finalArrival: Date,
  w: ScoreWeights,
): { offerScore: number; reqScore: number } {
  const detourScore = clamp01(1 - riderDetour / Math.max(1, req.maxDetour));
  const bufferMin = (req.arriveBy.getTime() - finalArrival.getTime()) / 60_000;
  const arrivalScore = clamp01(bufferMin / 30);
  const reqScore = w.riderDetourWeight * detourScore + w.riderArrivalWeight * arrivalScore;

  const remaining = Math.max(1, offer.maxDetour - (totalDriverAddedMinutes - marginalDriverMinutes));
  const offerScore = clamp01(1 - marginalDriverMinutes / remaining);

  return { offerScore, reqScore };
}

interface SubsetResult {
  /** Newly accepted (non-fixed) riders in this offer's winning subset. */
  kept: MatchRequest[];
  onBoard: OnBoardRider[];
  ev: RouteEvaluation;
}

/**
 * The best feasible subset of `pool` (currently-held provisional riders plus
 * one new proposer) a trip can add on top of its fixed, confirmed riders —
 * size <= seats, feasible meaning every rider's detour cap and arrival time
 * still hold. Tries the LARGEST feasible count first (raising match rate is
 * the point of bumping), tie-broken by lowest total driver-added minutes
 * (cheap insertions preserve capacity for later riders).
 *
 * `pool` is always small — bounded by seats offered plus one, since only a
 * single new proposer is ever added at a time — so brute-forcing every
 * subset and every pickup permutation (<= 4 seats => <= 24 orderings) is
 * cheap. Fixed riders keep their relative order; only where new riders slot
 * in among them varies, via repeated `bestInsertion` (KEY-138) rather than
 * permuting fixed riders too, which would reopen a route a human already
 * accepted for no correctness benefit.
 */
function bestFeasibleSubset(
  offer: MatchOffer,
  fixedRiders: OnBoardRider[],
  pool: MatchRequest[],
  departAt: Date,
  t: TravelTimeMatrix,
): SubsetResult {
  const available = Math.max(0, offer.seatsOffered - fixedRiders.length);
  const maxK = Math.min(available, pool.length);

  for (let k = maxK; k >= 0; k--) {
    let best: SubsetResult | null = null;
    for (const combo of combinations(pool, k)) {
      for (const perm of permutations(combo)) {
        const result = evaluateOrder(offer, fixedRiders, perm, departAt, t);
        if (!result) continue;
        if (!best || result.ev.driverAddedMinutes < best.ev.driverAddedMinutes) {
          best = { kept: combo, onBoard: result.onBoard, ev: result.ev };
        }
      }
    }
    if (best) return best;
  }

  // Fixed riders alone are always feasible: they were feasible entering this
  // run, and nothing above makes their own route any harder.
  const fallbackEv = evaluateRoute(
    offer.start, fixedRiders.map((r) => r.waypoint), offer.end, departAt, t,
  );
  return { kept: [], onBoard: fixedRiders.map((r) => ({ ...r })), ev: fallbackEv };
}

/**
 * Insert `order` one rider at a time (via `bestInsertion`) on top of
 * `fixedRiders`, which keep their original relative order throughout. Fails
 * as soon as any insertion has no feasible position — `bestInsertion`
 * already re-checks every rider seated so far, fixed or not, at each step.
 */
function evaluateOrder(
  offer: MatchOffer,
  fixedRiders: OnBoardRider[],
  order: MatchRequest[],
  departAt: Date,
  t: TravelTimeMatrix,
): { onBoard: OnBoardRider[]; ev: RouteEvaluation } | null {
  let onBoard: OnBoardRider[] = fixedRiders.map((r) => ({ ...r }));
  let tripDuration = 0;
  if (onBoard.length > 0) {
    const baseEv = evaluateRoute(offer.start, onBoard.map((r) => r.waypoint), offer.end, departAt, t);
    tripDuration = baseEv.totalMinutes;
    onBoard.forEach((r, i) => { r.currentDetour = baseEv.riderDetours[i]; });
  }

  for (const req of order) {
    const tempOffer: MatchOffer = { ...offer, onBoard, currTripDuration: tripDuration, seatsFilled: onBoard.length };
    const insertion = bestInsertion(tempOffer, waypointOf(req), req.maxDetour, req.arriveBy, departAt, t);
    if (!insertion.feasible || !insertion.evaluation) return null;

    const ev = insertion.evaluation;
    onBoard = [
      ...onBoard.slice(0, insertion.insertionIndex),
      {
        reqId: req.reqId,
        riderId: req.riderId,
        waypoint: waypointOf(req),
        arriveBy: req.arriveBy,
        maxDetour: req.maxDetour,
        currentDetour: ev.riderDetours[insertion.insertionIndex],
      },
      ...onBoard.slice(insertion.insertionIndex),
    ];
    onBoard.forEach((r, i) => { r.currentDetour = ev.riderDetours[i]; });
    tripDuration = ev.totalMinutes;
  }

  const finalEv = evaluateRoute(offer.start, onBoard.map((r) => r.waypoint), offer.end, departAt, t);
  return { onBoard, ev: finalEv };
}

function* combinations<T>(items: T[], k: number): Generator<T[]> {
  if (k === 0) { yield []; return; }
  if (k > items.length) return;
  for (let i = 0; i <= items.length - k; i++) {
    for (const rest of combinations(items.slice(i + 1), k - 1)) {
      yield [items[i], ...rest];
    }
  }
}

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length === 0) { yield []; return; }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i], ...p];
  }
}
