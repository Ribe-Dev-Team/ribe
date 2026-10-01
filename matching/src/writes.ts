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

/** One match, reduced to what Firestore needs. */
export interface MatchWrite {
  reqId: string;
  offerId: string;
  driverId: string;
  matchedAt: Date;
  acceptDeadline: Date;
  riderDetourMinutes: number;
  /** Where the new rider sits among the offer's confirmed riders, in pickup
   *  order. Stored on the request so acceptMatch can keep the order. */
  routeIndex: number;
  /** The confirmed riders, in order, this route was computed against. */
  baseline: string[];
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
    driverId: m.driverId,
    matchedAt: m.matchedAt,
    acceptDeadline: m.acceptDeadline,
    riderDetourMinutes: m.riderDetour,
    // Confirmed riders keep their relative order and the new rider is the only
    // one added, so its index in the final route is its index among them.
    routeIndex: m.insertionIndex,
    baseline: baselineByOffer.get(m.offerId) ?? [],
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
      },
      remove: [],
    },
    offer: {
      set: {
        status: 'awaiting',
        pendingRequestId: m.reqId,
        matchedAt: m.matchedAt,
        acceptDeadline: m.acceptDeadline,
      },
      remove: [],
    },
  };
}

/**
 * A match nobody accepted in time. The request becomes 'expired' - RideCard
 * already tells the rider the trip is cancelled once the countdown ends - and
 * the driver's slot is released so the next run can offer them someone else.
 *
 * Returns null when there is nothing to do: not awaiting, no deadline, or the
 * deadline hasn't passed.
 */
export function planExpiry(
  requestId: string,
  request: StoredRequest,
  offer: StoredOffer | undefined,
  now: Date,
): { request: FieldUpdate; offer?: FieldUpdate } | null {
  if (request.status !== 'awaiting' || !request.acceptDeadline) return null;
  if (request.acceptDeadline > now) return null;

  // Only release the slot if it is still this rider's.
  const releaseOffer = offer && offer.status === 'awaiting' && offer.pendingRequestId === requestId;

  return {
    request: { set: { status: 'expired' }, remove: [] },
    ...(releaseOffer
      ? { offer: { set: { status: 'pending', pendingRequestId: null }, remove: ['matchedAt', 'acceptDeadline'] } }
      : {}),
  };
}
