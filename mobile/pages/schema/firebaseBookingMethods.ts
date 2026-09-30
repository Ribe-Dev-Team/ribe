import {
  collection, addDoc, updateDoc, doc, Timestamp, runTransaction, arrayUnion, deleteField,
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { Booking, Coord } from './booking.schema';
import { RideRequest, RideOffer, MatchWriteInput } from './firebaseBooking.schema';
import { BOOKING_STATUSES, isBookingStatus, isMatchable } from './matchStatus';
import { timePattern, toMinutes } from '../../utility/times';
import { parseDateAsStr, isFutureDate } from '../../utility/dates';

// convert DD-MM-YYYY string to Firestore Timestamp
const parseDateToTimestamp = (dateStr: string): Timestamp => {
  const asDate = parseDateAsStr(dateStr);
  if (asDate !== undefined) return Timestamp.fromDate(asDate);
  throw new Error(`The date ${dateStr} was not a valid date.`);
};

/*
Validate and normalise a booking's resolved coordinates.

Returns undefined when the booking carries none. That is not an error: Places
and Geocoding can both fail, or the API key can be absent, and the booking is
still worth accepting - the document simply isn't matchable until it is
backfilled. Anything PRESENT but malformed is rejected outright, because a
silently wrong coordinate sends a real driver to the wrong suburb.

Rebuilt field by field rather than passed through, so a caller handing us a
ResolvedPlace-shaped object doesn't leak `lng`/`description` into Firestore.
*/
const validateCoord = (coord: Coord | undefined, label: string): Coord | undefined => {
  // `== null` on purpose: a draft restored from AsyncStorage is JSON, so an
  // absent coordinate can come back as null rather than undefined.
  if (coord == null) return undefined;

  const { lat, lon } = coord;

  if (typeof lat !== 'number' || !Number.isFinite(lat)) {
    throw new Error(`${label} latitude must be a finite number`);
  }
  if (typeof lon !== 'number' || !Number.isFinite(lon)) {
    throw new Error(`${label} longitude must be a finite number`);
  }
  if (lat < -90 || lat > 90) {
    throw new Error(`${label} latitude must be between -90 and 90, but was ${lat}`);
  }
  if (lon < -180 || lon > 180) {
    throw new Error(`${label} longitude must be between -180 and 180, but was ${lon}`);
  }

  return { lat, lon };
};

// Add request to DB
export const addRideRequest = async (booking: Booking): Promise<string> => {
  const collectionRef = collection(db, 'rideRequests');

  if (!booking.userId) {
    throw new Error('A user must be signed in to create a ride request.');
  }

  // Validated before anything is built, so a malformed coordinate fails the
  // write rather than reaching Firestore.
  const coord = validateCoord(booking.coord, 'Ride request');

  const req: Omit<RideRequest, 'requestID'> = {
    userId: booking.userId,
    status: booking.status ?? 'pending',
    toUni: booking.toUni,
    address: booking.address.trim(),
    // Firestore rejects an explicit `undefined`, so the key is left out
    // entirely when the address could not be resolved to a point.
    ...(coord ? { coord } : {}),
    date: parseDateToTimestamp(booking.travelDate),
    departureTime: booking.depTime.trim(),
    arrivalTime: booking.arrTime.trim(),
    createdAt: new Date().toISOString(),
  };

  // existence & type checking
  if (typeof req.userId !== 'string' || !req.userId.trim()) {
    throw new Error('userId must be a non-empty string');
  }

  if (!isBookingStatus(req.status)) {
    throw new Error(`status must be one of ${BOOKING_STATUSES.join(', ')}`);
  }

  if (req.toUni !== undefined && typeof req.toUni !== "boolean") {
    throw new Error("toUni must be a boolean");
  }

  if (req.address !== undefined && typeof req.address !== "string") {
    throw new Error("address must be a string");
  }

  if (req.date !== undefined && !(req.date instanceof Timestamp)) {
    throw new Error("date must be a Firestore Timestamp");
  } else if (Number.isNaN(req.date)) {
    throw new Error(`couldn't convert '${booking.travelDate}' into a Firestore date format`);
  } else if (!isFutureDate(req.date.toDate())) {
    throw new Error(`a future date must be provided, not '${booking.travelDate}'`);
  }

  if (req.departureTime !== undefined && !timePattern.test(req.departureTime)) {
    throw new Error("departureTime must be in 'HH:mm' (24-hour) format");
  } else if (req.arrivalTime !== undefined && !timePattern.test(req.arrivalTime)) {
    throw new Error("arrivalTime must be in 'HH:mm' (24-hour) format");
  } else if (toMinutes(req.arrivalTime) <= toMinutes(req.departureTime)) {
    // range checking (time in bounds)
    throw new Error("arrivalTime must be later than departureTime");
  }

  const docRef = await addDoc(collectionRef, req);
  await updateDoc(doc(db, 'rideRequests', docRef.id), { requestID: docRef.id });

  return docRef.id;
};

// add offer to DB
export const addRideOffer = async (booking: Booking): Promise<string> => {
  if (booking.detourTime === undefined) {
    throw new Error("Max detour time is required for ride offers");
  } else if (booking.capacity === undefined) {
    throw new Error("Number of available seats needs to be specified for ride offers");
  }

  if (!booking.userId) {
    throw new Error('A user must be signed in to create a ride offer.');
  }

  const collectionRef = collection(db, 'rideOffers');

  // Validated before anything is built, so a malformed coordinate fails the
  // write rather than reaching Firestore.
  const coord = validateCoord(booking.coord, 'Ride offer');

  const offer: Omit<RideOffer, 'offerID'> = {
    userId: booking.userId,
    status: booking.status ?? 'pending',
    toUni: booking.toUni,
    address: booking.address.trim(),
    // Firestore rejects an explicit `undefined`, so the key is left out
    // entirely when the address could not be resolved to a point.
    ...(coord ? { coord } : {}),
    date: parseDateToTimestamp(booking.travelDate),
    departureTime: booking.depTime.trim(),
    arrivalTime: booking.arrTime.trim(),
    maxDetourTime: booking.detourTime,
    seatCapacity: booking.capacity,
    createdAt: new Date().toISOString(),
  };

  // existence & type checking
  if (typeof offer.userId !== 'string' || !offer.userId.trim()) {
    throw new Error('userId must be a non-empty string');
  }

  if (!isBookingStatus(offer.status)) {
    throw new Error(`status must be one of ${BOOKING_STATUSES.join(', ')}`);
  }

  if (offer.toUni !== undefined && typeof offer.toUni !== "boolean") {
    throw new Error("toUni must be a boolean");
  }

  if (offer.address !== undefined && typeof offer.address !== "string") {
    throw new Error("address must be a string");
  }

  if (offer.date !== undefined && !(offer.date instanceof Timestamp)) {
    throw new Error("date must be a Firestore Timestamp");
  } else if (Number.isNaN(offer.date)) {
    throw new Error(`couldn't convert '${booking.travelDate}' into a Firestore date format`);
  } else if (!isFutureDate(offer.date.toDate())) {
    throw new Error(`a future date must be provided, not '${booking.travelDate}'`);
  }

  if (offer.maxDetourTime !== undefined && typeof offer.maxDetourTime !== "number") {
    throw new Error("detour time must be a number");
  }

  if (offer.seatCapacity !== undefined && typeof offer.seatCapacity !== "number") {
    throw new Error("seat capacity time must be a number");
  }

  if (offer.departureTime !== undefined && !timePattern.test(offer.departureTime)) {
    throw new Error("departureTime must be in 'HH:mm' (24-hour) format");
  } else if (offer.arrivalTime !== undefined && !timePattern.test(offer.arrivalTime)) {
    throw new Error("arrivalTime must be in 'HH:mm' (24-hour) format");
  }

  // range checking (time in bounds + seats within reason)
  const depMins = toMinutes(offer.departureTime);
  const arrMins = toMinutes(offer.arrivalTime);
  const timeDiff = arrMins - depMins;

  if (arrMins <= depMins) {
    throw new Error("arrivalTime must be later than departureTime");
  } else if (timeDiff < offer.maxDetourTime) {
    throw new Error(`detour allowance of ${offer.maxDetourTime} (min) exceeds travel window of ${timeDiff} (min)`);
  }

  if (offer.seatCapacity < 1 || offer.seatCapacity > 12) {
    throw new Error(`Ride offers require 1 to 12 seats (inclusive) be available but ${offer.seatCapacity} were given.`);
  }

  const docRef = await addDoc(collectionRef, offer);
  await updateDoc(doc(db, 'rideOffers', docRef.id), { offerID: docRef.id });

  return docRef.id;
};

// TODO: extract validation checks to separate file to reduce repetition in update and delete methods

// export async function deleteRideRequest(requestID: string): Promise<void> {
//   const docRef = doc(db, 'rideRequests', requestID);
//   await docRef.delete();
// }

/* ---------------------------------------------------------------------------
Match persistence.

These functions are the whole write side of matching: applyMatch records what the
matcher decided, and accept/decline resolve it. Nothing else in the app writes a
booking's status after creation.
--------------------------------------------------------------------------- */

/**
 * Record one match: the rider's request moves to 'awaiting' (the app's word for
 * "matched, waiting on a human"), and the driver's offer holds that rider in its
 * single pending slot.
 *
 * Runs in a transaction, and re-reads the request inside it, because the matcher
 * works from a snapshot: between the batch being read and this write landing, the
 * rider may have cancelled or been matched by an overlapping run. Writing blindly
 * is exactly the double-booking matchStatus.ts's status mapping exists to prevent,
 * and a status check outside a transaction would not prevent it.
 *
 * Returns false when the match was dropped for that reason, so a caller can count
 * how many of a run's matches actually landed rather than assuming all of them did.
 */
export async function applyMatch(match: MatchWriteInput): Promise<boolean> {
  const requestRef = doc(db, 'rideRequests', match.reqId);
  const offerRef = doc(db, 'rideOffers', match.offerId);

  return runTransaction(db, async (tx) => {
    const requestSnap = await tx.get(requestRef);
    const offerSnap = await tx.get(offerRef);
    if (!requestSnap.exists() || !offerSnap.exists()) return false;

    const request = requestSnap.data() as RideRequest;
    const offer = offerSnap.data() as RideOffer;

    // Still looking? 'pending' is the app's word for unmatched (see matchStatus.ts).
    if (!isMatchable(request.status)) return false;
    // The driver's one slot must be free - another run may have filled it.
    if (offer.pendingRequestId) return false;
    // And there must still be a seat to put this rider in.
    if ((offer.confirmedRequestIds?.length ?? 0) >= offer.seatCapacity) return false;

    tx.update(requestRef, {
      status: 'awaiting',
      matchedOfferId: match.offerId,
      matchedDriverId: match.driverId,
      matchedAt: Timestamp.fromDate(match.matchedAt),
      acceptDeadline: Timestamp.fromDate(match.acceptDeadline),
      riderDetourMinutes: match.riderDetourMinutes,
    });

    tx.update(offerRef, {
      status: 'awaiting',
      pendingRequestId: match.reqId,
      matchedAt: Timestamp.fromDate(match.matchedAt),
      acceptDeadline: Timestamp.fromDate(match.acceptDeadline),
    });

    return true;
  });
}

/**
 * Write a whole run's matches. Sequential, not parallel: each one is its own
 * transaction, and two matches from the same run can contend for one offer.
 */
export async function applyMatches(matches: MatchWriteInput[]): Promise<number> {
  let applied = 0;
  for (const match of matches) {
    if (await applyMatch(match)) applied += 1;
  }
  return applied;
}

/**
 * The rider accepts: their request becomes 'confirmed' and they join the offer's
 * confirmed list.
 *
 * The offer deliberately returns to 'pending' rather than 'confirmed' while it
 * still has an empty seat. 'pending' is the only status the matcher treats as
 * matchable (MATCHABLE_BOOKING_STATUSES), and a trip must stay matchable across
 * runs for the one-new-rider-per-run rule to ever fill a 4-seat car. It becomes
 * 'confirmed' only once full.
 */
export async function acceptMatch(requestID: string): Promise<void> {
  const requestRef = doc(db, 'rideRequests', requestID);

  await runTransaction(db, async (tx) => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists()) throw new Error('No ride request ' + requestID);

    const request = requestSnap.data() as RideRequest;
    if (request.status !== 'awaiting') {
      throw new Error('Ride request ' + requestID + " is '" + request.status + "', not awaiting approval.");
    }
    if (!request.matchedOfferId) throw new Error('Ride request ' + requestID + ' has no matched offer.');

    const offerRef = doc(db, 'rideOffers', request.matchedOfferId);
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists()) throw new Error('No ride offer ' + request.matchedOfferId);

    const offer = offerSnap.data() as RideOffer;
    const confirmedCount = (offer.confirmedRequestIds?.length ?? 0) + 1;

    tx.update(requestRef, { status: 'confirmed' });
    tx.update(offerRef, {
      confirmedRequestIds: arrayUnion(requestID),
      pendingRequestId: null,
      status: confirmedCount >= offer.seatCapacity ? 'confirmed' : 'pending',
    });
  });
}

/**
 * The rider (or driver) declines: the request goes back to 'pending' so the next
 * run can rematch it, and every match field is REMOVED rather than set to null.
 * Leaving stale ids behind would make rideData.ts render a driver the rider just
 * rejected, and a stale acceptDeadline would keep counting down on a card that is
 * no longer matched at all.
 */
export async function declineMatch(requestID: string): Promise<void> {
  const requestRef = doc(db, 'rideRequests', requestID);

  await runTransaction(db, async (tx) => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists()) throw new Error('No ride request ' + requestID);

    const request = requestSnap.data() as RideRequest;
    const offerId = request.matchedOfferId;

    const offerSnap = offerId ? await tx.get(doc(db, 'rideOffers', offerId)) : null;

    tx.update(requestRef, {
      status: 'pending',
      matchedOfferId: deleteField(),
      matchedDriverId: deleteField(),
      matchedAt: deleteField(),
      acceptDeadline: deleteField(),
      riderDetourMinutes: deleteField(),
    });

    if (offerId && offerSnap && offerSnap.exists()) {
      const offer = offerSnap.data() as RideOffer;
      // Only release the slot if it is still this rider's - a later run may
      // already have put someone else in it.
      if (offer.pendingRequestId === requestID) {
        tx.update(doc(db, 'rideOffers', offerId), {
          pendingRequestId: null,
          status: 'pending',
          matchedAt: deleteField(),
          acceptDeadline: deleteField(),
        });
      }
    }
  });
}

/**
 * Partial update of a stored request. Kept narrow on purpose: status changes go
 * through applyMatch/acceptMatch/declineMatch so the offer side stays in step.
 */
export async function updateRideRequest(
  requestID: string,
  updates: Partial<Omit<RideRequest, 'requestID' | 'status'>>,
): Promise<void> {
  await updateDoc(doc(db, 'rideRequests', requestID), updates);
}
