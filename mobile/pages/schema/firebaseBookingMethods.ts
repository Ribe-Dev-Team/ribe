import {
  collection, addDoc, updateDoc, doc, Timestamp, runTransaction, deleteField,
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { Booking, Coord } from './booking.schema';
import { RideRequest, RideOffer } from './firebaseBooking.schema';
import { BOOKING_STATUSES, BookingStatus, isBookingStatus } from './matchStatus';
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
Match responses.

Matches are WRITTEN by the matching runner (matching/runner/), a server-side
process using the Admin SDK - never by the app. What the app does is resolve
them: the rider accepts or declines here. Unanswered matches are expired by the
runner once their acceptDeadline passes.
--------------------------------------------------------------------------- */

/**
 * The rider accepts: their request becomes 'confirmed' and they join the offer's
 * confirmed list AT THEIR PICKUP POSITION. The runner stored that position as
 * `routeIndex`, and `confirmedRequestIds` is kept in pickup order because the next
 * run rebuilds the car's route from it - an append-only list would silently
 * reorder the route and re-check everyone's detour against the wrong one.
 *
 * The offer deliberately returns to 'pending' rather than 'confirmed' while it
 * still has an empty seat. 'pending' is the only status the matcher treats as
 * matchable (MATCHABLE_BOOKING_STATUSES), and a trip must stay matchable across
 * runs for the one-new-rider-per-run rule to ever fill a 4-seat car. It becomes
 * 'confirmed' once full - or once the driver has locked it (settledOfferStatus).
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
    // The deadline is authoritative even before the runner gets round to
    // expiring the match - otherwise a late accept could confirm a seat the
    // runner is about to hand to someone else.
    if (request.acceptDeadline && request.acceptDeadline.toDate() <= new Date()) {
      throw new Error('This match expired before it was accepted.');
    }

    const offerRef = doc(db, 'rideOffers', request.matchedOfferId);
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists()) throw new Error('No ride offer ' + request.matchedOfferId);

    const offer = offerSnap.data() as RideOffer;
    // The driver may have removed the offer while the rider was deciding.
    if (offer.status !== 'awaiting' || offer.pendingRequestId !== requestID) {
      throw new Error('The driver has removed this offer. Your request will be matched again.');
    }
    const confirmed = (offer.confirmedRequestIds ?? []).filter((id) => id !== requestID);
    // No stored position (a match written before routeIndex existed) -> last.
    const at = Math.min(Math.max(request.routeIndex ?? confirmed.length, 0), confirmed.length);
    const ordered = [...confirmed.slice(0, at), requestID, ...confirmed.slice(at)];

    tx.update(requestRef, { status: 'confirmed' });
    // Allowed by the Firestore rules only because the runner set
    // `matchedRiderId` to this rider's uid. Removed in the same write, so the
    // rider can't go on editing the driver's offer once they've answered.
    tx.update(offerRef, {
      confirmedRequestIds: ordered,
      pendingRequestId: null,
      matchedRiderId: deleteField(),
      // The timetable re-planned with this rider in it. A match from before
      // timetables were stored has none, and the old one no longer fits the
      // car, so it's dropped and the cards fall back to each rider's own times.
      schedule: offer.pendingSchedule ?? deleteField(),
      pendingSchedule: deleteField(),
      status: settledOfferStatus({ ...offer, confirmedRequestIds: ordered }),
    });
  });
}

/**
 * The rider declines: their request is cancelled, and they book again if they
 * still want a ride (a new booking can be matched to anyone, this driver
 * included). Only the rider answers a match - drivers can't turn riders away,
 * only remove their whole offer (cancelOffer).
 *
 * Every match field is REMOVED rather than set to null, and the driver's slot is
 * freed so the offer goes straight back into the pool if it has seats left.
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
      status: 'cancelled',
      matchedOfferId: deleteField(),
      matchedDriverId: deleteField(),
      matchedAt: deleteField(),
      acceptDeadline: deleteField(),
      riderDetourMinutes: deleteField(),
      routeIndex: deleteField(),
      pickupAt: deleteField(),
      arriveAt: deleteField(),
    });

    if (offerId && offerSnap && offerSnap.exists()) {
      const offer = offerSnap.data() as RideOffer;
      // Only release the slot if it is still this rider's - a later run may
      // already have put someone else in it.
      if (offer.pendingRequestId === requestID) {
        tx.update(doc(db, 'rideOffers', offerId), {
          pendingRequestId: null,
          matchedRiderId: deleteField(),
          // Back in the pool - unless the driver locked it with passengers aboard.
          status: settledOfferStatus(offer),
          matchedAt: deleteField(),
          acceptDeadline: deleteField(),
          pendingSchedule: deleteField(),
        });
      }
    }
  });
}

/**
 * The driver removes their whole offer - allowed at any time, with a rider
 * awaiting approval or with riders confirmed. The offer becomes 'cancelled' and
 * its pending slot is cleared, so a rider deciding can no longer accept it.
 *
 * The riders' own bookings are NOT touched here: the driver's phone can't write
 * them. The matching runner returns each of them to the pool on its next run
 * (matching/src/writes.ts → planSettle), and until then rideData.ts already
 * shows them as searching again.
 */
export async function cancelOffer(offerID: string): Promise<void> {
  const offerRef = doc(db, 'rideOffers', offerID);

  await runTransaction(db, async (tx) => {
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists()) throw new Error('No ride offer ' + offerID);

    tx.update(offerRef, {
      status: 'cancelled',
      pendingRequestId: null,
      matchedRiderId: deleteField(),
      matchedAt: deleteField(),
      acceptDeadline: deleteField(),
      pendingSchedule: deleteField(),
    });
  });
}

/**
 * The status an offer's seats and lock add up to, once nobody holds its pending
 * slot. A car is done ('confirmed') when it's full, or when the driver has
 * locked it with at least one passenger aboard; otherwise it's back in the
 * matcher's pool ('pending'). The runner applies the same rule
 * (matching/src/writes.ts → settledOfferStatus).
 */
function settledOfferStatus(offer: Pick<RideOffer, 'seatCapacity' | 'confirmedRequestIds' | 'acceptingMore'>): BookingStatus {
  const filled = (offer.confirmedRequestIds ?? []).length;
  if (filled >= offer.seatCapacity) return 'confirmed';
  if (offer.acceptingMore === false && filled > 0) return 'confirmed';
  return 'pending';
}

/** What an offer's status should be after its seats or lock change: a rider
 *  still deciding keeps it 'awaiting'; otherwise as settledOfferStatus. */
function offerStatusAfterChange(offer: RideOffer): BookingStatus {
  return offer.pendingRequestId ? 'awaiting' : settledOfferStatus(offer);
}

/**
 * The driver stops taking passengers (`locked`), or starts again. A locked car
 * with someone aboard is done and leaves the matcher's pool; unlocking puts it
 * back if it has a seat free. A rider already deciding on a match keeps their
 * seat either way - locking only stops NEW riders being offered.
 */
export async function setOfferLocked(offerID: string, locked: boolean): Promise<void> {
  const offerRef = doc(db, 'rideOffers', offerID);

  await runTransaction(db, async (tx) => {
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists()) throw new Error('No ride offer ' + offerID);

    const offer = offerSnap.data() as RideOffer;
    if (offer.status === 'cancelled') throw new Error('This offer has been removed.');

    const next = { ...offer, acceptingMore: !locked };
    tx.update(offerRef, { acceptingMore: !locked, status: offerStatusAfterChange(next) });
  });
}

/**
 * The driver changes how many passengers they'll take. Never below the riders
 * already confirmed plus one deciding on a match, and within the same 1-12 the
 * booking form allows. Fewer seats than before can fill the car (it's done);
 * more can reopen a full one (back in the pool), unless it's locked.
 */
export async function updateOfferSeats(offerID: string, seats: number): Promise<void> {
  if (!Number.isInteger(seats) || seats < 1 || seats > 12) {
    throw new Error('A drive offer needs 1 to 12 seats.');
  }
  const offerRef = doc(db, 'rideOffers', offerID);

  await runTransaction(db, async (tx) => {
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists()) throw new Error('No ride offer ' + offerID);

    const offer = offerSnap.data() as RideOffer;
    if (offer.status === 'cancelled') throw new Error('This offer has been removed.');

    const taken = (offer.confirmedRequestIds ?? []).length + (offer.pendingRequestId ? 1 : 0);
    if (seats < taken) {
      throw new Error(`${taken} seat${taken === 1 ? ' is' : 's are'} already taken, so the car needs at least ${taken}.`);
    }

    const next = { ...offer, seatCapacity: seats };
    tx.update(offerRef, { seatCapacity: seats, status: offerStatusAfterChange(next) });
  });
}

/**
 * Partial update of a stored request. Kept narrow on purpose: status changes go
 * through the matching runner or acceptMatch/declineMatch so the offer side
 * stays in step.
 */
export async function updateRideRequest(
  requestID: string,
  updates: Partial<Omit<RideRequest, 'requestID' | 'status'>>,
): Promise<void> {
  await updateDoc(doc(db, 'rideRequests', requestID), updates);
}
