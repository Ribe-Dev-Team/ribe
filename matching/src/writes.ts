import { MatchOffer, ProposedMatch } from './types';

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
}

/** A car's timetable as stored on its offer: the driver's own departure and
 *  arrival, and every rider in pickup order. */
export interface StoredSchedule {
  departAt: Date;
  arriveAt: Date;
  stops: Array<{ requestId: string; pickupAt: Date; arriveAt: Date }>;
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
}

/**
 * Pair each proposed match with its offer's confirmed-rider baseline.
 * `offers` must be the offers passed INTO the run: the run never mutates its
 * inputs, so their `onBoard` is exactly the confirmed riders.
 */
export function toMatchWrites(matches: ProposedMatch[], offers: MatchOffer[]): MatchWrite[] {
  const baselineByOffer = new Map(offers.map((o) => [o.offerId, o.onBoard.map((r) => r.reqId)]));
  return matches.map((m) => ({
    reqId: m.reqId,
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
    schedule: {
      departAt: m.departAt,
      arriveAt: m.finalArrival,
      stops: m.schedule.map((s) => ({ requestId: s.reqId, pickupAt: s.pickupAt, arriveAt: s.arriveAt })),
    },
  }));
}

export type MatchWriteSkip =
  | 'MISSING'             // either document is gone
  | 'REQUEST_NOT_PENDING' // rider cancelled, or an overlapping run matched them
  | 'OFFER_NOT_PENDING'   // driver cancelled, filled up, or is awaiting approval
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

/** An offer's pending-slot fields, removed when the slot is freed. */
export const OFFER_SLOT_FIELDS = ['matchedRiderId', 'matchedAt', 'acceptDeadline', 'pendingSchedule'];

export type Settlement = 'RELEASED' | 'EXPIRED';

/** Request ids settled by one pass, by outcome. */
export interface Settled {
  released: string[];
  expired: string[];
}

/**
 * Bring a matched request (awaiting approval or confirmed) in line with its
 * offer. Only the rider answers a match, and the driver can't write the
 * rider's booking - so when something happens on the driver's side, the
 * rider's request catches up here:
 *
 *   RELEASED  the driver removed their offer (or it's gone, or no longer has
 *             this rider): back to looking, every match field removed, so the
 *             next run can find them someone else
 *   EXPIRED   the rider didn't answer by the deadline: the request expires -
 *             RideCard already tells the rider the trip is cancelled - and the
 *             driver's slot is freed for the next run
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

  if (request.status === 'confirmed') {
    const seated = offerLive && (offer.confirmedRequestIds ?? []).includes(requestId);
    return seated ? null : released;
  }

  if (request.status !== 'awaiting') return null;
  const holding = offerLive && offer.status === 'awaiting' && offer.pendingRequestId === requestId;
  if (!holding) return released;

  if (!request.acceptDeadline || request.acceptDeadline > now) return null;
  return {
    outcome: 'EXPIRED',
    request: { set: { status: 'expired' }, remove: [] },
    offer: { set: { status: 'pending', pendingRequestId: null }, remove: OFFER_SLOT_FIELDS },
  };
}
