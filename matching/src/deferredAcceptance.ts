import {
  MatchOffer, MatchRequest, MatchingConfig, DEFAULT_CONFIG, MatchRunResult,
  OnBoardRider, ProposedMatch, RejectReason, TravelTimeMatrix, TripStop,
} from './types';
import { hardFilter, passengerOf, waypointOf } from './filter';
import {
  driverLatestArrival, routeSlackMinutes, scoreFromMetrics, scorePairing, ScoreWeights, DEFAULT_WEIGHTS,
} from './score';
import { addPassenger, departureOf, DepartureTime, evaluateRoute, RouteEvaluation } from './route';
/** Never promise a match more time to accept than the batch can actually
 *  honour before the trip locks. */
export function computeAcceptDeadline(now: Date, departAt: Date, cfg: MatchingConfig): Date {
  return new Date(Math.min(
    now.getTime() + cfg.approvalWindowMinutes * 60_000,
    departAt.getTime() - cfg.matchingCutoffMinutes * 60_000,
  ));
}

/**
 * Provisional assignment with bumping (KEY-41) — see README "Why not
 * Gale-Shapley".
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
 * ONE NEW RIDER PER TRIP PER RUN. Accepting a match is a human decision, so a
 * driver is only ever offered a single new, unconfirmed rider per run however
 * many seats are still empty. Riders already confirmed in an earlier run
 * (present in offer.onBoard when this run started) are FIXED: they always
 * stay, are never bumped, and do not consume the slot. A 4-seat car fills one
 * passenger at a time, across as many runs as it takes.
 *
 * That rule is what makes a candidate's cost stable. Since no two unconfirmed
 * riders ever share a route within a run, every candidate is measured against
 * the trip's FIXED baseline and nothing else — so a placement can be computed
 * once per (rider, trip) pair and can never be invalidated by what happens to
 * some other rider later in the run. The previous model, where several new
 * riders could share one route, had no such property: a rider's cost depended
 * on who else happened to be aboard, which is precisely why it needed a subset
 * search over combinations and pickup orderings.
 *
 * Mechanism, one proposal at a time:
 *   1. An unassigned rider proposes to whichever untried, structurally
 *      compatible trip currently scores best for THEM (reqScore).
 *   2. The proposer is placed on that trip's fixed baseline (addPassenger,
 *      KEY-138 — which still re-checks every confirmed rider's own detour cap,
 *      arrival time and pickup window). Infeasible there, and the rider moves on.
 *   3. The trip's single slot goes to whichever of (current holder, new
 *      proposer) costs the driver fewer marginal minutes. A tie keeps the
 *      holder. This is a BINARY COMPARISON, not a subset search.
 *   4. The loser — the bumped holder, or the proposer rejected outright —
 *      returns to the pool and tries its next untried trip.
 *   5. Repeat until no rider has an untried trip left.
 *
 * Terminates because each (rider, trip) pair is inspected at most once: a
 * trip found not currently accepting, or not currently feasible for a
 * rider, is crossed off for that rider for the rest of THIS run, even
 * though it could in principle loosen up later if the trip bumps someone
 * else first. That is a real, accepted imprecision — this is a heuristic,
 * not an exhaustive search — and it is what keeps the algorithm bounded and
 * simple to reason about.
 *
 * One run says little about match rate on its own: it matches at most one
 * rider per driver. `test/simulate.ts` measures it the way the app uses it,
 * over repeated runs with each run's matches accepted in between.
 *
 * `departAt` is either one time for the whole batch or a per-offer lookup (see
 * `DepartureTime` in route.ts). Real batches pass the lookup, since drivers in
 * one day's batch leave at different times.
 */
export function runMatchingProvisional(
  batchKey: string,
  requests: MatchRequest[],
  offers: MatchOffer[],
  departAt: DepartureTime,
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
  // run. This is what every candidate is scored AND placed against — never the
  // live, currently-mutating `offer`, whose onBoard may already hold another
  // rider provisionally. `addPassenger` has no seat-capacity check of its own
  // (capacity is the caller's `slotsByOffer` check), so placing against a trip
  // that already looks occupied would evaluate the nonsensical "insert on top of
  // the current holder" route instead of "how would I fare against the confirmed
  // baseline" — silently reporting an occupied trip as infeasible for a rider who
  // could perfectly well bump their way in.
  const rankingOfferByOffer = new Map<string, MatchOffer>();
  for (const o of liveOffers) {
    const fixed = fixedByOffer.get(o.offerId)!;
    let currTripDuration = 0;
    if (fixed.length > 0) {
      const ev = evaluateRoute(
        o.start, fixed.map((r) => r.waypoint), o.end, departureOf(departAt, o), t, o.direction,
      );
      currTripDuration = ev.totalMinutes;
    }
    rankingOfferByOffer.set(o.offerId, { ...o, onBoard: fixed, seatsFilled: fixed.length, currTripDuration });
  }

  const { candidates, rejected } = hardFilter(requests, liveOffers, cfg, departAt, now);
  const remaining = new Map<string, Set<string>>();
  for (const { req, offer } of candidates) {
    if (!remaining.has(req.reqId)) remaining.set(req.reqId, new Set());
    remaining.get(req.reqId)!.add(offer.offerId);
  }

  // The single unconfirmed rider each offer currently holds, together with the
  // placement and cost it was accepted on. null = slot still empty.
  const held = new Map<string, HeldCandidate | null>();
  for (const o of liveOffers) held.set(o.offerId, null);

  // Seats free over and above the confirmed riders, constant for the whole run.
  // A trip fills at most ONE of them here, but a trip whose confirmed riders
  // already occupy every seat can take nobody at all.
  const slotsByOffer = new Map(
    liveOffers.map((o) => [o.offerId, o.seatsOffered - fixedByOffer.get(o.offerId)!.length]),
  );

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

    // Scan untried trips, cross off any no longer reachable at all, and
    // propose to whichever remaining one scores best for THIS rider.
    // Deliberately NOT `isAcceptingRiders` here: that gates on seats, and a
    // trip whose slot is already taken is exactly the case bumping needs to
    // keep considering. What IS permanent is a trip with no free seat over its
    // confirmed riders — it can never hold anyone this run, so cross it off.
    let bestOfferId: string | null = null;
    let bestReqScore = -Infinity;
    for (const offerId of [...remOffers]) {
      const offer = offerById.get(offerId)!;
      const offerDepartAt = departureOf(departAt, offer);
      if (!stillTryable(offer, cfg, offerDepartAt, now) || (slotsByOffer.get(offerId) ?? 0) < 1) {
        remOffers.delete(offerId); continue;
      }
      const s = scorePairing(req, rankingOfferByOffer.get(offerId)!, offerDepartAt, t, weights);
      if (!s) continue; // infeasible even against the confirmed baseline; leave untried in case that changes
      if (s.reqScore > bestReqScore) { bestReqScore = s.reqScore; bestOfferId = offerId; }
    }
    if (bestOfferId === null) continue; // nothing currently feasible; may be revisited if requeued later

    remOffers.delete(bestOfferId); // propose once, whatever the outcome

    const offer = offerById.get(bestOfferId)!;

    // Place the proposer on the trip's FIXED baseline — never on top of
    // whoever currently holds the slot. Measuring against the holder would
    // make a candidate's cost depend on the order proposals happened to
    // arrive in, which is the property the one-new-rider rule exists to kill.
    const challenger = placeOnBaseline(
      rankingOfferByOffer.get(bestOfferId)!, req, departureOf(departAt, offer), t, weights,
    );
    if (!challenger) continue; // infeasible against the confirmed baseline

    const holder = held.get(bestOfferId) ?? null;

    // The slot holds exactly one unconfirmed rider, so this is a two-way
    // comparison on marginal driver minutes. Both are measured against the same
    // fixed baseline, so they are directly comparable. A tie keeps the holder —
    // no churn for no gain, and it keeps the run deterministic.
    //
    // Deliberately NOT offerScore, even though that now includes slack. Slack
    // penalises a rider with a tight deadline, and those are the hardest riders
    // to place: in the worked example (test/deferredAcceptance.test.ts) B costs
    // D1 half a minute but must be on campus 30 s after the car arrives, so a
    // slack-aware D1 keeps A instead and B - who can reach no other trip - is
    // stranded. Two matches become one. Match rate is the binding constraint, so
    // slack ranks drivers for riders (reqScore), not riders for drivers.
    const challengerWins = holder === null || challenger.cost < holder.cost;

    if (challengerWins) {
      held.set(bestOfferId, challenger);
      offer.onBoard = challenger.onBoard;
      offer.seatsFilled = challenger.onBoard.length;
      offer.currTripDuration = challenger.ev.totalMinutes;
      // Status stays 'open' even once the slot is taken — closing here would
      // stop this trip being proposed to again, and bumping is the whole
      // point. Finalized once, after the run converges.
    }

    // The loser — the bumped holder, or the proposer rejected outright — goes
    // back to the pool if it still has an untried trip left.
    const displaced = challengerWins ? holder?.req.reqId : req.reqId;
    if (displaced && (remaining.get(displaced)?.size ?? 0) > 0) free.push(displaced);
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

    const offerDepartAt = departureOf(departAt, offer);
    const acceptDeadline = computeAcceptDeadline(now, offerDepartAt, cfg);
    const waypoints = finalOrder.map((r) => r.waypoint);
    const fullEv = evaluateRoute(offer.start, waypoints, offer.end, offerDepartAt, t, offer.direction);
    const driverDeadline = driverLatestArrival(offer, offerDepartAt, t);

    // The car's timetable with this run's rider in it. Leaving campus, everyone
    // boards at the driver's departure.
    const schedule: TripStop[] = finalOrder.map((r, j) => ({
      reqId: r.reqId,
      pickupAt: offer.direction === 'TO_CAMPUS' ? fullEv.waypointArrivals[j] : offerDepartAt,
      arriveAt: fullEv.riderArrivals[j],
    }));

    for (let i = 0; i < finalOrder.length; i++) {
      const rider = finalOrder[i];
      if (fixedIds.has(rider.reqId)) continue; // already matched in a prior run

      const req = requestById.get(rider.reqId)!;
      const riderDetour = fullEv.riderDetours[i];

      // Marginal cost attributable to THIS rider: what the driver's total
      // added minutes would be without them, holding everyone else's order.
      const withoutWaypoints = [...waypoints.slice(0, i), ...waypoints.slice(i + 1)];
      const withoutEv = evaluateRoute(
        offer.start, withoutWaypoints, offer.end, offerDepartAt, t, offer.direction,
      );
      const marginal = fullEv.totalMinutes - withoutEv.totalMinutes;

      // Everyone else, in route order, so slack can be compared with and without them.
      const others = finalOrder.filter((_, j) => j !== i);
      const { offerScore, reqScore } = scoreFromMetrics({
        riderDetour,
        riderMaxDetour: req.maxDetour,
        riderBuffer: (req.arriveBy.getTime() - fullEv.riderArrivals[i].getTime()) / 60_000,
        marginalDriverMinutes: marginal,
        driverRemainingDetour: offer.maxDetour - (fullEv.driverAddedMinutes - marginal),
        slackBefore: routeSlackMinutes(driverDeadline, others, withoutEv),
        slackAfter: routeSlackMinutes(driverDeadline, finalOrder, fullEv),
      }, weights);

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
        departAt: offerDepartAt,
        finalArrival: fullEv.finalArrival,
        totalTripMinutes: fullEv.totalMinutes,
        pickupAt: schedule[i].pickupAt,
        arriveAt: schedule[i].arriveAt,
        schedule,
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

  // Why each unmatched rider was left out, driver by driver. Worked out after
  // the run, against the same frozen baselines the run used, so it explains the
  // result without influencing it. A pair the filter didn't reject and that
  // still fits the trip can only have lost: that driver's one slot went to a
  // rider costing fewer minutes.
  const filterReason = new Map(rejected.map((r) => [`${r.reqId}|${r.offerId}`, r.reason]));
  const unmatchedReasons = unmatchedRequestIds.map((reqId) => {
    const req = requestById.get(reqId)!;
    const byOffer = liveOffers.map((o) => {
      const filtered = filterReason.get(`${reqId}|${o.offerId}`);
      if (filtered) return { offerId: o.offerId, reason: filtered };
      const fit = addPassenger(rankingOfferByOffer.get(o.offerId)!, passengerOf(req), departureOf(departAt, o), t);
      const reason: RejectReason = fit.feasible ? 'LOST_SLOT' : fit.reason ?? 'NO_FEASIBLE_INSERTION';
      return { offerId: o.offerId, reason };
    });
    return { reqId, byOffer };
  });

  let seatsLeftOnClosedTrips = 0;
  let closedByDriverChoice = 0;
  let closedBySlack = 0;
  let closedByCutoff = 0;
  for (const o of liveOffers) {
    const spare = o.seatsOffered - o.seatsFilled;
    if (spare <= 0) continue;
    if (!o.acceptingMore) { closedByDriverChoice++; seatsLeftOnClosedTrips += spare; }
    else if ((departureOf(departAt, o).getTime() - now.getTime()) / 60_000 <= cfg.matchingCutoffMinutes) {
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
    unmatchedReasons,
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
 * slack: a trip whose slot is already taken must remain reachable so a
 * cheaper proposer can still bump the holder. The one permanent seat
 * exclusion — no free seat at all over the confirmed riders — is applied by
 * the caller via `slotsByOffer`; detour caps and arrival times are enforced
 * per proposal by `placeOnBaseline`.
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

interface HeldCandidate {
  /** The unconfirmed rider holding the trip's single new-rider slot. */
  req: MatchRequest;
  /** Marginal driver minutes this rider costs over the trip's FIXED baseline. */
  cost: number;
  /** Confirmed riders plus this one, in final pickup order. */
  onBoard: OnBoardRider[];
  ev: RouteEvaluation;
}

/**
 * Place ONE new rider on a trip's fixed, confirmed baseline and report what it
 * costs the driver, or null if there is no feasible position.
 *
 * This replaces the old subset search. Under the one-new-rider-per-run rule a
 * trip never carries two unconfirmed riders at once, so there is no
 * combination of riders to search over — only where this single rider slots in
 * among the confirmed ones, which is exactly `addPassenger`'s job (KEY-138).
 * It still re-checks every confirmed rider's own detour cap, arrival time and
 * pickup window at every candidate position, so adding this rider cannot
 * degrade someone a human already accepted.
 *
 * `baseline` MUST be the frozen fixed-riders-only view of the offer, never the
 * live one: measuring against whoever currently holds the slot would make a
 * candidate's cost depend on the arrival order of proposals, and the whole
 * point of the rule is that it does not.
 */
function placeOnBaseline(
  baseline: MatchOffer,
  req: MatchRequest,
  departAt: Date,
  t: TravelTimeMatrix,
  weights: ScoreWeights,
): HeldCandidate | null {
  const scored = scorePairing(req, baseline, departAt, t, weights);
  if (!scored) return null;

  const ev = scored.evaluation;
  const idx = scored.insertionIndex;

  const onBoard: OnBoardRider[] = [
    ...baseline.onBoard.slice(0, idx).map((r) => ({ ...r })),
    {
      reqId: req.reqId,
      riderId: req.riderId,
      waypoint: waypointOf(req),
      arriveBy: req.arriveBy,
      maxDetour: req.maxDetour,
      currentDetour: ev.riderDetours[idx],
      earliest: req.travelWindow.start,
    },
    ...baseline.onBoard.slice(idx).map((r) => ({ ...r })),
  ];
  // Detours shift for everyone once the route changes, so restate them all
  // from the evaluation rather than leaving stale values on the copies.
  onBoard.forEach((r, i) => { r.currentDetour = ev.riderDetours[i]; });

  return { req, cost: scored.driverAddedMinutes, onBoard, ev };
}
