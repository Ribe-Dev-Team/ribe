import { emissionsForDistanceKm, emissionsForRiders } from '../emissions';
import { MatchOffer, MatchRequest, ProposedMatch, RoadDistanceMatrix, TripStop } from './types';
import type { StoredRiderCost, StoredTripCosts } from '../costSplitting/tripCosts';

/**
 * What a matching run writes back, as plain decisions with no Firebase SDK in
 * them. runner/firestore.ts re-reads both documents inside a transaction, asks
 * these functions what to do, and applies the answer - so the rules that stop a
 * double booking are unit-tested here rather than only in a live database.
 */

/** Fields to merge (`set`) and fields to delete (`remove`) on one document. */
export interface FieldUpdate {
  set: Record<string, unknown>;
  remove: string[];
}

/** The parts of a stored request these rules read. */
export interface StoredRequest {
  status: string;
  matchedOfferId?: string;
  acceptDeadline?: Date;
}

/** The parts of a stored offer these rules read. */
export interface StoredOffer {
  status: string;
  seatCapacity: number;
  pendingRequestId?: string | null;
  confirmedRequestIds?: string[];
  /** False once the driver locks the trip: no more passengers. Absent = true. */
  acceptingMore?: boolean;
  /** The rider in the pending slot has accepted, and the driver hasn't yet. */
  riderAccepted?: boolean;
}

/**
 * The status an offer's seats and lock add up to, once nobody holds its
 * pending slot. A car is done ('confirmed') when it's full, or when the driver
 * has locked it with at least one passenger aboard; otherwise it's back in the
 * matcher's pool ('pending'). mobile/pages/schema/firebaseBookingMethods.ts
 * applies the same rule on the app's side.
 */
export function settledOfferStatus(offer: StoredOffer): 'confirmed' | 'pending' {
  const filled = (offer.confirmedRequestIds ?? []).length;
  if (filled >= offer.seatCapacity) return 'confirmed';
  if (offer.acceptingMore === false && filled > 0) return 'confirmed';
  return 'pending';
}

/** A car's timetable as stored on its offer: the driver's own departure and
 *  arrival, and every rider in pickup order - with the car's cost split
 *  (costSplitting/tripCosts.ts) once the runner has priced it. */
export interface StoredSchedule {
  departAt: Date;
  arriveAt: Date;
  stops: Array<{ requestId: string; pickupAt: Date; arriveAt: Date; cost?: StoredRiderCost }>;
  costs?: StoredTripCosts;
  /** Sum of every listed rider's solo-trip emissions; excludes the driver. */
  emissionsSavedKg?: number;
}

/** A timetable (route.ts → timetableFor) in the shape the offer stores. */
export function toStoredSchedule(
  t: { departAt: Date; arriveAt: Date; stops: TripStop[] },
  emissionsSavedKg?: number,
): StoredSchedule {
  return {
    departAt: t.departAt,
    arriveAt: t.arriveAt,
    stops: t.stops.map((s) => ({ requestId: s.reqId, pickupAt: s.pickupAt, arriveAt: s.arriveAt })),
    ...(emissionsSavedKg === undefined ? {} : { emissionsSavedKg }),
  };
}

/** One match, reduced to what Firestore needs. */
export interface MatchWrite {
  reqId: string;
  offerId: string;
  /** The rider's user id - stored on the offer as `matchedRiderId`. */
  riderId: string;
  driverId: string;
  matchedAt: Date;
  acceptDeadline: Date;
  riderDetourMinutes: number;
  /** Where the new rider sits among the offer's confirmed riders, in pickup
   *  order. Stored on the request so acceptMatch can keep the order. */
  routeIndex: number;
  /** The confirmed riders, in order, this route was computed against. */
  baseline: string[];
  /** This rider's own estimated pickup and arrival. */
  pickupAt: Date;
  arriveAt: Date;
  /** The car's timetable if this rider accepts - confirmed riders' times
   *  included, since picking up the new rider can shift them. */
  schedule: StoredSchedule;
  riderEmissionsKg: number;
  driverEmissionsKg: number;
}

/**
 * Pair each proposed match with its offer's confirmed-rider baseline.
 * `offers` must be the offers passed INTO the run: the run never mutates its
 * inputs, so their `onBoard` is exactly the confirmed riders.
 */
export function toMatchWrites(
  matches: ProposedMatch[],
  offers: MatchOffer[],
  requests: MatchRequest[],
  distances: RoadDistanceMatrix,
): MatchWrite[] {
  const baselineByOffer = new Map(offers.map((o) => [o.offerId, o.onBoard.map((r) => r.reqId)]));
  const offersById = new Map(offers.map((offer) => [offer.offerId, offer]));
  const requestsById = new Map(requests.map((request) => [request.reqId, request]));
  return matches.map((m) => {
    const offer = offersById.get(m.offerId)!;
    const request = requestsById.get(m.rideId)!;
    const campus = offer.direction === 'TO_CAMPUS' ? offer.end : offer.start;
    const riderHomes = [
      ...offer.onBoard.map((rider) => rider.waypoint),
      request.direction === 'TO_CAMPUS' ? request.start : request.end,
    ];
    const emissionsSavedKg = emissionsForRiders(
      riderHomes,
      campus,
      offer.direction === 'TO_CAMPUS',
      distances,
    );

    return ({
    reqId: m.rideId,
    offerId: m.offerId,
    riderId: m.riderId,
    driverId: m.driverId,
    matchedAt: m.matchedAt,
    acceptDeadline: m.acceptDeadline,
    riderDetourMinutes: m.riderDetour,
    // Confirmed riders keep their relative order and the new rider is the only
    // one added, so its index in the final route is its index among them.
    routeIndex: m.insertionIndex,
    baseline: baselineByOffer.get(m.offerId) ?? [],
    pickupAt: m.pickupAt,
    arriveAt: m.arriveAt,
    schedule: toStoredSchedule(
      { departAt: m.departAt, arriveAt: m.finalArrival, stops: m.schedule },
      emissionsSavedKg,
    ),
    riderEmissionsKg: emissionsForDistanceKm(distances.km(
      request.start,
      request.end,
    )),
    driverEmissionsKg: emissionsForDistanceKm(distances.km(
      offer.start,
      offer.end,
    )),
    });
  });
}

export type MatchWriteSkip =
  | 'MISSING'             // either document is gone
  | 'REQUEST_NOT_PENDING' // rider cancelled, or an overlapping run matched them
  | 'OFFER_NOT_PENDING'   // driver cancelled, filled up, or is awaiting approval
  | 'LOCKED'              // the driver stopped taking passengers
  | 'SLOT_TAKEN'          // the driver's one pending slot is already used
  | 'BASELINE_CHANGED'    // confirmed riders changed, so the route is stale
  | 'FULL';

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Whether a match computed from a snapshot may still be written, and what to
 * write. The run works from a snapshot, so between reading and writing the rider
 * may have cancelled, or the trip may have changed under the route that was
 * computed for it.
 */
export function planMatchWrite(
  request: StoredRequest | undefined,
  offer: StoredOffer | undefined,
  m: MatchWrite,
): { ok: true; request: FieldUpdate; offer: FieldUpdate } | { ok: false; reason: MatchWriteSkip } {
  if (!request || !offer) return { ok: false, reason: 'MISSING' };
  if (request.status !== 'pending') return { ok: false, reason: 'REQUEST_NOT_PENDING' };
  if (offer.status !== 'pending') return { ok: false, reason: 'OFFER_NOT_PENDING' };
  if (offer.acceptingMore === false) return { ok: false, reason: 'LOCKED' };
  if (offer.pendingRequestId) return { ok: false, reason: 'SLOT_TAKEN' };

  const confirmed = offer.confirmedRequestIds ?? [];
  if (!sameList(confirmed, m.baseline)) return { ok: false, reason: 'BASELINE_CHANGED' };
  if (confirmed.length >= offer.seatCapacity) return { ok: false, reason: 'FULL' };

  return {
    ok: true,
    request: {
      set: {
        status: 'awaiting',
        matchedOfferId: m.offerId,
        matchedDriverId: m.driverId,
        matchedAt: m.matchedAt,
        acceptDeadline: m.acceptDeadline,
        riderDetourMinutes: m.riderDetourMinutes,
        routeIndex: m.routeIndex,
        // The rider's own times as of this match. The offer's schedule stays
        // current as later riders join; these are what the card falls back to
        // if it can't read the offer.
        pickupAt: m.pickupAt,
        arriveAt: m.arriveAt,
        emissionsSavedKg: m.riderEmissionsKg,
      },
      remove: [],
    },
    offer: {
      set: {
        status: 'awaiting',
        pendingRequestId: m.reqId,
        // The published Firestore rules let a user update someone else's offer
        // only when `matchedRiderId` is their uid - and accepting or declining
        // runs on the rider's phone and updates the driver's offer. Without
        // this, Accept fails with "Missing or insufficient permissions".
        matchedRiderId: m.riderId,
        matchedAt: m.matchedAt,
        acceptDeadline: m.acceptDeadline,
        // Not `schedule` yet: that is the confirmed riders' timetable until this
        // rider accepts, and acceptMatch moves this into its place.
        pendingSchedule: m.schedule,
        driverEmissionsKg: m.driverEmissionsKg,
      },
      remove: [],
    },
  };
}

/** A request's match fields, removed when it goes back to looking. */
export const REQUEST_MATCH_FIELDS = [
  'matchedOfferId', 'matchedDriverId', 'matchedAt', 'acceptDeadline', 'riderDetourMinutes',
  'routeIndex', 'pickupAt', 'arriveAt',
];

/** An offer's pending-slot fields, removed when the slot is freed. The two
 *  answers go with it, so neither carries over to the next rider matched. */
export const OFFER_SLOT_FIELDS = [
  'matchedRiderId', 'matchedAt', 'acceptDeadline', 'pendingSchedule', 'riderAccepted', 'driverAccepted',
];

export type Settlement = 'RELEASED' | 'EXPIRED' | 'VACATED';

/** Request ids settled by one pass, by outcome. */
export interface Settled {
  released: string[];
  expired: string[];
  vacated: string[];
}

/**
 * Bring a matched request (awaiting approval or confirmed) in line with its
 * offer. A match needs both the rider and the driver to accept, but the
 * driver's phone can only write the rider's booking while they're matched -
 * so when the driver removes their whole offer, the rider's request catches
 * up here:
 *
 *   RELEASED  the driver removed their offer (or it's gone, or no longer has
 *             this rider): back to looking, every match field removed, so the
 *             next run can find them someone else. Also when the deadline
 *             passes with the rider having accepted and only the driver not
 *             answering - the rider did nothing wrong, so they aren't expired
 *   EXPIRED   the rider didn't answer by the deadline: the request expires -
 *             RideCard already tells the rider the trip is cancelled - and the
 *             driver's slot is freed for the next run
 *   VACATED   a confirmed rider cancelled (cancelConfirmedRequest) and their
 *             seat is still on the driver's offer. The app takes it off at once
 *             when it can; it's left here only when another rider was deciding
 *             on the car, or the Firestore rules refused the app's write.
 *             Waits while another rider is deciding on that car - their proposed
 *             route and pickup position include the departed rider - and goes
 *             ahead once they answer or their match expires.
 *
 * Returns null when there is nothing to do.
 */
export function planSettle(
  requestId: string,
  request: StoredRequest,
  offer: StoredOffer | undefined,
  now: Date,
): { outcome: Settlement; request: FieldUpdate; offer?: FieldUpdate } | null {
  const released = { outcome: 'RELEASED' as const, request: { set: { status: 'pending' }, remove: REQUEST_MATCH_FIELDS } };
  const offerLive = offer !== undefined && offer.status !== 'cancelled';

  if (request.status === 'cancelled') {
    // Only a confirmed rider's cancellation keeps its offer id; a declined
    // match has every match field removed already.
    if (!request.matchedOfferId) return null;
    const vacated = { outcome: 'VACATED' as const, request: { set: {}, remove: REQUEST_MATCH_FIELDS } };
    const confirmed = offer?.confirmedRequestIds ?? [];
    if (!offer || !offerLive || !confirmed.includes(requestId)) return vacated;
    if (offer.pendingRequestId) return null;

    const remaining = confirmed.filter((id) => id !== requestId);
    return {
      ...vacated,
      offer: {
        // Back in the pool if a seat is now free, unless it's locked with
        // passengers still aboard. The timetable routes the car past the
        // departed rider, so it goes; the runner re-plans it for a car in the
        // pool, and the cards fall back to each rider's own times meanwhile.
        set: {
          confirmedRequestIds: remaining,
          status: settledOfferStatus({ ...offer, confirmedRequestIds: remaining }),
        },
        remove: ['schedule'],
      },
    };
  }

  if (request.status === 'confirmed') {
    const seated = offerLive && (offer.confirmedRequestIds ?? []).includes(requestId);
    return seated ? null : released;
  }

  if (request.status !== 'awaiting') return null;
  const holding = offerLive && offer.status === 'awaiting' && offer.pendingRequestId === requestId;
  if (!holding) return released;

  if (!request.acceptDeadline || request.acceptDeadline > now) return null;
  // Back in the pool - unless the driver locked the trip meanwhile and has
  // passengers, in which case it's done.
  const freedSlot = { set: { status: settledOfferStatus(offer!), pendingRequestId: null }, remove: OFFER_SLOT_FIELDS };
  if (offer!.riderAccepted) return { ...released, offer: freedSlot };
  return {
    outcome: 'EXPIRED',
    request: { set: { status: 'expired' }, remove: [] },
    offer: freedSlot,
  };
}

/**
 * A confirmed car's timetable, to fill in where the stored one is missing or no
 * longer lists the car's riders - a match written before timetables were
 * stored, say. Ride cards read riders' pickup and arrival times from it, and
 * without one a confirmed rider is left looking at their booking window.
 */
export interface ScheduleWrite {
  offerId: string;
  /** The confirmed riders, in pickup order, the timetable was worked out for. */
  baseline: string[];
  schedule: StoredSchedule;
}

/**
 * Whether a car's confirmed timetable may still be written: only if its
 * confirmed riders are still exactly the ones it was worked out for. Leaves the
 * pending slot and its proposed timetable alone - `schedule` is only ever the
 * confirmed riders' timetable.
 */
export function planScheduleWrite(offer: StoredOffer | undefined, w: ScheduleWrite): FieldUpdate | null {
  if (!offer || offer.status === 'cancelled') return null;
  if (!sameList(offer.confirmedRequestIds ?? [], w.baseline)) return null;
  return {
    set: {
      schedule: w.schedule,
      emissionsSavedKg: w.schedule.emissionsSavedKg ?? 0,
    },
    remove: [],
  };
}
