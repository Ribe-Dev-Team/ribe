import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  runTransaction,
  Timestamp,
  updateDoc,
  type DocumentReference,
  type Transaction,
} from 'firebase/firestore';
import { auth, db } from '../../firebaseConfig';
import { Booking, Coord } from './booking.schema';
import { RideRequest, RideOffer } from './firebaseBooking.schema';
import { BOOKING_STATUSES, BookingStatus, isBookingStatus } from './matchStatus';
import { timePattern, toMinutes } from '../../utility/times';
import { MAX_CAR_SEATS } from './user.validation';
import { parseDateAsStr, isFutureDate } from '../../utility/dates';
import { estimateEmissionsSaved } from '../../utility/emissions';

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

/*
The passenger seats in a user's registered car, or null if they have no car
registered - not a driver, or a driver whose car details are missing. Read
from users/{uid}, falling back to drivers/{uid} (driver registration), the
same way the profile does: an older profile save could reset users/{uid}
while drivers/{uid} kept the car.
*/
export async function registeredCarSeats(uid: string): Promise<number | null> {
  const [userSnap, driverSnap] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDoc(doc(db, 'drivers', uid)),
  ]);
  const user = userSnap.exists() ? userSnap.data() : {};
  const driver = driverSnap.exists() ? driverSnap.data() : null;
  if (!user['isDriver'] && !driver) return null;

  const plate = user['licensePlate'] ?? driver?.['licensePlate'];
  const seats = user['seatsAvailable'] ?? driver?.['seatsAvailable'];
  if (!plate || !Number.isInteger(seats) || seats < 1) return null;
  return seats;
}

// Add request to DB
export const addRideRequest = async (booking: Booking): Promise<string> => {
  const collectionRef = collection(db, 'rideRequests');

  if (!booking.userId) {
    throw new Error('A user must be signed in to create a ride request.');
  }

  const coord = validateCoord(booking.coord, 'Ride request');

  const req: Omit<RideRequest, 'requestID'> = {
    userId: booking.userId,
    status: booking.status ?? 'pending',
    toUni: booking.toUni,
    address: booking.address.trim(),
    ...(coord ? { coord } : {}),
    date: parseDateToTimestamp(booking.travelDate),
    departureTime: booking.depTime.trim(),
    arrivalTime: booking.arrTime.trim(),
    createdAt: new Date().toISOString(),
  };

  if (typeof req.userId !== 'string' || !req.userId.trim()) {
    throw new Error('userId must be a non-empty string');
  }

  if (!isBookingStatus(req.status)) {
    throw new Error(`status must be one of ${BOOKING_STATUSES.join(', ')}`);
  }

  if (req.toUni !== undefined && typeof req.toUni !== 'boolean') {
    throw new Error('toUni must be a boolean');
  }

  if (req.address !== undefined && typeof req.address !== 'string') {
    throw new Error('address must be a string');
  }

  if (req.date !== undefined && !(req.date instanceof Timestamp)) {
    throw new Error('date must be a Firestore Timestamp');
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
    throw new Error('arrivalTime must be later than departureTime');
  }

  try {
    const emissions = await estimateEmissionsSaved(req.address, 1, coord, req.toUni);
    if (emissions !== null) {
      req.emissionsSavedKg = emissions;
    }
  } catch (e) {
    console.warn('Failed to estimate emissions:', e);
  }

  const docRef = await addDoc(collectionRef, req);
  await updateDoc(doc(db, 'rideRequests', docRef.id), { requestID: docRef.id });

  return docRef.id;
};

// add offer to DB
export const addRideOffer = async (booking: Booking): Promise<string> => {
  if (booking.detourTime === undefined) {
    throw new Error('Max detour time is required for ride offers');
  } else if (booking.capacity === undefined) {
    throw new Error('Number of available seats needs to be specified for ride offers');
  }

  if (!booking.userId) {
    throw new Error('A user must be signed in to create a ride offer.');
  }

  const collectionRef = collection(db, 'rideOffers');
  const coord = validateCoord(booking.coord, 'Ride offer');

  const offer: Omit<RideOffer, 'offerID'> = {
    userId: booking.userId,
    status: booking.status ?? 'pending',
    toUni: booking.toUni,
    address: booking.address.trim(),
    ...(coord ? { coord } : {}),
    date: parseDateToTimestamp(booking.travelDate),
    departureTime: booking.depTime.trim(),
    arrivalTime: booking.arrTime.trim(),
    maxDetourTime: booking.detourTime,
    seatCapacity: booking.capacity,
    createdAt: new Date().toISOString(),
  };

  if (typeof offer.userId !== 'string' || !offer.userId.trim()) {
    throw new Error('userId must be a non-empty string');
  }

  if (!isBookingStatus(offer.status)) {
    throw new Error(`status must be one of ${BOOKING_STATUSES.join(', ')}`);
  }

  if (offer.toUni !== undefined && typeof offer.toUni !== 'boolean') {
    throw new Error('toUni must be a boolean');
  }

  if (offer.address !== undefined && typeof offer.address !== 'string') {
    throw new Error('address must be a string');
  }

  if (offer.date !== undefined && !(offer.date instanceof Timestamp)) {
    throw new Error('date must be a Firestore Timestamp');
  } else if (Number.isNaN(offer.date)) {
    throw new Error(`couldn't convert '${booking.travelDate}' into a Firestore date format`);
  } else if (!isFutureDate(offer.date.toDate())) {
    throw new Error(`a future date must be provided, not '${booking.travelDate}'`);
  }

  if (offer.maxDetourTime !== undefined && typeof offer.maxDetourTime !== 'number') {
    throw new Error('detour time must be a number');
  }

  if (offer.seatCapacity !== undefined && typeof offer.seatCapacity !== 'number') {
    throw new Error('seat capacity time must be a number');
  }

  if (offer.departureTime !== undefined && !timePattern.test(offer.departureTime)) {
    throw new Error("departureTime must be in 'HH:mm' (24-hour) format");
  } else if (offer.arrivalTime !== undefined && !timePattern.test(offer.arrivalTime)) {
    throw new Error("arrivalTime must be in 'HH:mm' (24-hour) format");
  }

  const depMins = toMinutes(offer.departureTime);
  const arrMins = toMinutes(offer.arrivalTime);
  const timeDiff = arrMins - depMins;

  if (arrMins <= depMins) {
    throw new Error('arrivalTime must be later than departureTime');
  } else if (timeDiff < offer.maxDetourTime) {
    throw new Error(`detour allowance of ${offer.maxDetourTime} (min) exceeds travel window of ${timeDiff} (min)`);
  }

  if (offer.seatCapacity < 1 || offer.seatCapacity > MAX_CAR_SEATS) {
    throw new Error(`Ride offers require 1 to ${MAX_CAR_SEATS} seats (inclusive) be available but ${offer.seatCapacity} were given.`);
  }

  // Only a registered driver can offer a ride, and never more seats than
  // their car has. The booking page already stops both; this is the backstop.
  const carSeats = await registeredCarSeats(offer.userId);
  if (carSeats === null) {
    throw new Error('Register as a driver, with your car, in your profile before offering a ride.');
  }
  if (offer.seatCapacity > carSeats) {
    throw new Error(`Your car has ${carSeats} passenger seat${carSeats === 1 ? '' : 's'}, so offer ${carSeats} or fewer.`);
  }

  try {
    const driverEmission = await estimateEmissionsSaved(offer.address, 1, coord, offer.toUni);
    if (driverEmission !== null) {
      offer.driverEmissionsKg = driverEmission;
      offer.emissionsSavedKg = 0;
    }
  } catch (e) {
    console.warn('Failed to estimate emissions:', e);
  }

  const docRef = await addDoc(collectionRef, offer);
  await updateDoc(doc(db, 'rideOffers', docRef.id), { offerID: docRef.id });

  return docRef.id;
};

/* ---------------------------------------------------------------------------
Match responses.

Matches are WRITTEN by the matching runner (backend/server/matching/runner/), a server-side
process using the Admin SDK - never by the app. What the app does is resolve
them: the rider AND the driver each accept or decline, in either order, and
the match is confirmed once both have accepted. Unanswered matches are expired
by the runner once their acceptDeadline passes.

Each side's answer is stored on the offer's pending slot (`riderAccepted`,
`driverAccepted`). Both phones can write the offer while the match is
pending: the driver owns it, and the rules let the rider in through
`matchedRiderId`. The driver can also write the rider's request while they're
its `matchedDriverId`, which is what lets them confirm it or return it to the
pool.
--------------------------------------------------------------------------- */

/** Where answering left a match: confirmed (both have accepted), or still
 *  waiting for the other side. */
export type MatchAnswer = 'confirmed' | 'waiting';

/** A request's match fields, removed when it goes back to looking. The same
 *  list as the runner's (backend/server/matching/writes.ts → REQUEST_MATCH_FIELDS). */
const REQUEST_MATCH_FIELDS = [
  'matchedOfferId', 'matchedDriverId', 'matchedAt', 'acceptDeadline', 'riderDetourMinutes',
  'routeIndex', 'pickupAt', 'arriveAt',
] as const;

const removeMatchFields = () =>
  Object.fromEntries(REQUEST_MATCH_FIELDS.map((field) => [field, deleteField()]));

/** The deadline is authoritative even before the runner gets round to
 *  expiring the match - otherwise a late accept could confirm a seat the
 *  runner is about to hand to someone else. */
function assertNotExpired(request: RideRequest) {
  if (request.acceptDeadline && request.acceptDeadline.toDate() <= new Date()) {
    throw new Error('This match expired before it was accepted.');
  }
}

/** The offer's pending slot emptied: the rider, the deadline, the proposed
 *  timetable and both answers all go, and the offer is back in the pool if it
 *  has seats left. */
function freedSlot(offer: RideOffer) {
  return {
    pendingRequestId: null,
    matchedRiderId: deleteField(),
    matchedAt: deleteField(),
    acceptDeadline: deleteField(),
    pendingSchedule: deleteField(),
    riderAccepted: deleteField(),
    driverAccepted: deleteField(),
    // Back in the pool - unless the driver locked it with passengers aboard.
    status: settledOfferStatus(offer),
  };
}

/**
 * Both have accepted: the rider's request becomes 'confirmed' and they join the
 * offer's confirmed list AT THEIR PICKUP POSITION. The runner stored that
 * position as `routeIndex`, and `confirmedRequestIds` is kept in pickup order
 * because the next run rebuilds the car's route from it - an append-only list
 * would silently reorder the route and re-check everyone's detour against the
 * wrong one.
 *
 * The offer deliberately returns to 'pending' rather than 'confirmed' while it
 * still has an empty seat. 'pending' is the only status the matcher treats as
 * matchable (MATCHABLE_BOOKING_STATUSES), and a trip must stay matchable across
 * runs for the one-new-rider-per-run rule to ever fill a 4-seat car. It becomes
 * 'confirmed' once full - or once the driver has locked it (settledOfferStatus).
 */
function confirmMatch(
  tx: Transaction,
  requestRef: DocumentReference,
  request: RideRequest,
  offerRef: DocumentReference,
  offer: RideOffer,
) {
  const requestID = requestRef.id;
  const confirmed = (offer.confirmedRequestIds ?? []).filter((id) => id !== requestID);
  // No stored position (a match written before routeIndex existed) -> last.
  const at = Math.min(Math.max(request.routeIndex ?? confirmed.length, 0), confirmed.length);
  const ordered = [...confirmed.slice(0, at), requestID, ...confirmed.slice(at)];
  // The car's CO2 saving with this rider aboard, from the re-planned timetable.
  const emissionsSavedKg = offer.pendingSchedule?.emissionsSavedKg ?? 0;

  tx.update(requestRef, { status: 'confirmed' });
  tx.update(offerRef, {
    confirmedRequestIds: ordered,
    pendingRequestId: null,
    // Removed in the same write, so the rider can't go on editing the
    // driver's offer once the match is settled.
    matchedRiderId: deleteField(),
    riderAccepted: deleteField(),
    driverAccepted: deleteField(),
    // The timetable re-planned with this rider in it. A match from before
    // timetables were stored has none, and the old one no longer fits the
    // car, so it's dropped and the cards fall back to each rider's own times.
    schedule: offer.pendingSchedule ?? deleteField(),
    pendingSchedule: deleteField(),
    status: settledOfferStatus({ ...offer, confirmedRequestIds: ordered }),
    emissionsSavedKg,
  });
}

/**
 * The rider accepts. If the driver already has, the match is confirmed
 * (confirmMatch); otherwise their answer is recorded on the offer and the
 * match waits for the driver's.
 */
export async function acceptMatch(requestID: string): Promise<MatchAnswer> {
  const requestRef = doc(db, 'rideRequests', requestID);

  return runTransaction(db, async (tx) => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists()) throw new Error('No ride request ' + requestID);

    const request = requestSnap.data() as RideRequest;
    if (request.status !== 'awaiting') {
      throw new Error('Ride request ' + requestID + " is '" + request.status + "', not awaiting approval.");
    }
    if (!request.matchedOfferId) throw new Error('Ride request ' + requestID + ' has no matched offer.');
    assertNotExpired(request);

    const offerRef = doc(db, 'rideOffers', request.matchedOfferId);
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists()) throw new Error('No ride offer ' + request.matchedOfferId);

    const offer = offerSnap.data() as RideOffer;
    if (offer.status !== 'awaiting' || offer.pendingRequestId !== requestID) {
      throw new Error('The driver has removed this offer. Your request will be matched again.');
    }
    if (!offer.driverAccepted) {
      // Allowed by the Firestore rules only because the runner set
      // `matchedRiderId` to this rider's uid.
      tx.update(offerRef, { riderAccepted: true });
      return 'waiting';
    }
    confirmMatch(tx, requestRef, request, offerRef, offer);
    return 'confirmed';
  });
}

/**
 * The rider declines: their request is cancelled, and they book again if they
 * still want a ride (a new booking can be matched to anyone, this driver
 * included). Allowed until the match is confirmed, even after accepting.
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

    tx.update(requestRef, { status: 'cancelled', ...removeMatchFields() });

    if (offerId && offerSnap && offerSnap.exists()) {
      const offer = offerSnap.data() as RideOffer;
      if (offer.pendingRequestId === requestID) {
        tx.update(doc(db, 'rideOffers', offerId), freedSlot(offer));
      }
    }
  });
}

/**
 * The rider waiting on this offer and their request, read in `tx` for the
 * driver answering. Throws when no rider is waiting any more - they declined,
 * or the match expired - so the driver's answer isn't applied to a stale card.
 */
async function pendingMatchOf(tx: Transaction, offerID: string) {
  const offerRef = doc(db, 'rideOffers', offerID);
  const offerSnap = await tx.get(offerRef);
  if (!offerSnap.exists()) throw new Error('No ride offer ' + offerID);

  const offer = offerSnap.data() as RideOffer;
  if (offer.status === 'cancelled') throw new Error('This offer has been removed.');
  if (offer.status !== 'awaiting' || !offer.pendingRequestId) {
    throw new Error('No rider is waiting on this drive any more.');
  }

  const requestRef = doc(db, 'rideRequests', offer.pendingRequestId);
  const requestSnap = await tx.get(requestRef);
  const request = requestSnap.exists() ? (requestSnap.data() as RideRequest) : undefined;
  return { offerRef, offer, requestRef, request };
}

/**
 * The driver accepts the rider in their pending slot. If the rider already
 * has, the match is confirmed (confirmMatch); otherwise the driver's answer is
 * recorded and the match waits for the rider's.
 */
export async function driverAcceptMatch(offerID: string): Promise<MatchAnswer> {
  return runTransaction(db, async (tx) => {
    const { offerRef, offer, requestRef, request } = await pendingMatchOf(tx, offerID);
    // The rider declined (or cancelled) while the driver was deciding.
    if (!request || request.status !== 'awaiting' || request.matchedOfferId !== offerID) {
      throw new Error('This rider is no longer waiting on your drive.');
    }
    assertNotExpired(request);

    if (!offer.riderAccepted) {
      tx.update(offerRef, { driverAccepted: true });
      return 'waiting';
    }
    // Allowed by the Firestore rules because the runner set this driver as
    // the request's `matchedDriverId`.
    confirmMatch(tx, requestRef, request, offerRef, offer);
    return 'confirmed';
  });
}

/**
 * The driver declines the rider in their pending slot. Unlike a rider
 * declining, nobody's booking is cancelled: the rider goes back to looking,
 * every match field removed so the next run can match them again, and the
 * driver's slot is freed so the offer is back in the pool if it has seats left.
 */
export async function driverDeclineMatch(offerID: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const { offerRef, offer, requestRef, request } = await pendingMatchOf(tx, offerID);

    // Only if it's still this match - a rider who already declined has
    // cancelled their own request, and that stays cancelled.
    if (request && request.status === 'awaiting' && request.matchedOfferId === offerID) {
      tx.update(requestRef, { status: 'pending', ...removeMatchFields() });
    }
    tx.update(offerRef, freedSlot(offer));
  });
}

/**
 * A confirmed rider cancels their seat, and it comes straight off the driver's
 * offer in the same write: the car is back in matching if a seat is now free
 * (unless the driver locked it with others still aboard), and its timetable
 * loses this rider's stop, so the driver sees the trip without them at once.
 * The riders left keep their planned times until the runner re-plans the
 * route (`needsReplan`) - without this rider's detour the car reaches them a
 * little early, never late.
 *
 * The published Firestore rules let a confirmed rider make exactly this change
 * to the driver's offer: take their own request off it, and nothing else. Two
 * cases leave the offer to the runner's next run instead
 * (backend/server/matching/writes.ts → planSettle), and the request keeps
 * `matchedOfferId` so the runner can find the car:
 *   - another rider is deciding on a match to this car - their proposed route
 *     and pickup position include this rider
 *   - the rules refuse it (rules published before this change): the
 *     cancellation itself must still go through
 *
 * Not a delete: with the request gone, the offer would still list the rider and
 * every later run would skip the car as having a confirmed rider it can't read.
 */
export async function cancelConfirmedRequest(requestID: string): Promise<void> {
  try {
    await runTransaction(db, (tx) => cancelConfirmed(tx, requestID, true));
  } catch (error) {
    if ((error as { code?: string })?.code !== 'permission-denied') throw error;
    await runTransaction(db, (tx) => cancelConfirmed(tx, requestID, false));
  }
}

async function cancelConfirmed(tx: Transaction, requestID: string, freeSeat: boolean): Promise<void> {
  const requestRef = doc(db, 'rideRequests', requestID);
  const requestSnap = await tx.get(requestRef);
  if (!requestSnap.exists()) throw new Error('No ride request ' + requestID);

  const request = requestSnap.data() as RideRequest;
  if (request.status !== 'confirmed') {
    throw new Error('Ride request ' + requestID + " is '" + request.status + "', not confirmed.");
  }

  const offerRef = freeSeat && request.matchedOfferId ? doc(db, 'rideOffers', request.matchedOfferId) : null;
  const offerSnap = offerRef ? await tx.get(offerRef) : null;
  const offer = offerSnap?.exists() ? (offerSnap.data() as RideOffer) : undefined;
  const seated = offer !== undefined && offer.status !== 'cancelled' && !offer.pendingRequestId
    && (offer.confirmedRequestIds ?? []).includes(requestID);

  if (!offerRef || !offer || !seated) {
    tx.update(requestRef, { status: 'cancelled' });
    return;
  }

  const remaining = (offer.confirmedRequestIds ?? []).filter((id) => id !== requestID);
  tx.update(offerRef, {
    confirmedRequestIds: remaining,
    status: settledOfferStatus({ ...offer, confirmedRequestIds: remaining }),
    // Nobody left, nothing to time.
    schedule: offer.schedule && remaining.length > 0
      ? {
        ...offer.schedule,
        stops: offer.schedule.stops.filter((s) => s.requestId !== requestID),
        needsReplan: true,
      }
      : deleteField(),
  });
  // The seat is already off the car, so the runner has nothing left to do here.
  tx.update(requestRef, {
    status: 'cancelled',
    ...removeMatchFields(),
  });
}

/**
 * The driver removes their whole offer - allowed at any time, with a rider
 * awaiting approval or with riders confirmed. The offer becomes 'cancelled' and
 * its pending slot is cleared, so a rider deciding can no longer accept it.
 *
 * The riders' own bookings are NOT touched here: the driver's phone can't write
 * them. The matching runner returns each of them to the pool on its next run
 * (backend/server/matching/writes.ts → planSettle), and until then rideData.ts already
 * shows them as searching again.
 */
export async function cancelOffer(offerID: string): Promise<void> {
  const offerRef = doc(db, 'rideOffers', offerID);

  await runTransaction(db, async (tx) => {
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists()) throw new Error('No ride offer ' + offerID);

    tx.update(offerRef, { ...freedSlot(offerSnap.data() as RideOffer), status: 'cancelled' });
  });
}

/**
 * The status an offer's seats and lock add up to, once nobody holds its pending
 * slot. A car is done ('confirmed') when it's full, or when the driver has
 * locked it with at least one passenger aboard; otherwise it's back in the
 * matcher's pool ('pending'). The runner applies the same rule
 * (backend/server/matching/writes.ts → settledOfferStatus).
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
 * already confirmed plus one deciding on a match, and within the same 1-7 the
 * booking form allows. Fewer seats than before can fill the car (it's done);
 * more can reopen a full one (back in the pool). Not while the drive is
 * locked: unlock it first.
 */
export async function updateOfferSeats(offerID: string, seats: number): Promise<void> {
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_CAR_SEATS) {
    throw new Error(`A drive offer needs 1 to ${MAX_CAR_SEATS} seats.`);
  }
  const offerRef = doc(db, 'rideOffers', offerID);

  await runTransaction(db, async (tx) => {
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists()) throw new Error('No ride offer ' + offerID);

    const offer = offerSnap.data() as RideOffer;
    if (offer.status === 'cancelled') throw new Error('This offer has been removed.');
    // A locked drive takes nobody new, so its seats change nothing - the card
    // hides the control, and this keeps it that way.
    if (offer.acceptingMore === false) throw new Error('Unlock this drive to change its seats.');

    const taken = (offer.confirmedRequestIds ?? []).length + (offer.pendingRequestId ? 1 : 0);
    if (seats < taken) {
      throw new Error(`${taken} seat${taken === 1 ? ' is' : 's are'} already taken, so the car needs at least ${taken}.`);
    }
    // Never more than the car holds. Only checked when adding seats, so a
    // driver can always come down to fit, whatever their profile says.
    if (seats > offer.seatCapacity) {
      const carSeats = await registeredCarSeats(offer.userId);
      if (carSeats !== null && seats > carSeats) {
        throw new Error(`Your car has ${carSeats} passenger seat${carSeats === 1 ? '' : 's'}, so this drive can take ${carSeats} at most.`);
      }
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

export async function deleteRideRequest(requestID: string): Promise<void> {
  if (!requestID || typeof requestID !== 'string') throw new Error('requestID must be provided');
  const docRef = doc(db, 'rideRequests', requestID);
  console.log('deleteRideRequest: attempting to delete', requestID);
  try {
    const before = await getDoc(docRef);
    console.log('deleteRideRequest: exists before delete?', before.exists());
    console.log('deleteRideRequest: before data', before.data());
    try {
      console.log('deleteRideRequest: auth uid', auth.currentUser?.uid);
    } catch (e) {
      console.warn('deleteRideRequest: failed to read auth currentUser', e);
    }
  } catch (err) {
    console.warn('deleteRideRequest: failed to read before-delete state', err);
  }

  try {
    await deleteDoc(docRef);
    console.log('deleteRideRequest: deleteDoc() returned for', requestID);
  } catch (err) {
    console.warn('deleteRideRequest: deleteDoc failed', err);
    throw err;
  }

  try {
    const after = await getDoc(docRef);
    console.log('deleteRideRequest: exists after delete?', after.exists());
  } catch (err) {
    console.warn('deleteRideRequest: failed to read after-delete state', err);
  }
}

export async function deleteRideOffer(offerID: string): Promise<void> {
  if (!offerID || typeof offerID !== 'string') throw new Error('offerID must be provided');
  const docRef = doc(db, 'rideOffers', offerID);
  console.log('deleteRideOffer: attempting to delete', offerID);
  try {
    const before = await getDoc(docRef);
    console.log('deleteRideOffer: exists before delete?', before.exists());
    console.log('deleteRideOffer: before data', before.data());
    try {
      console.log('deleteRideOffer: auth uid', auth.currentUser?.uid);
    } catch (e) {
      console.warn('deleteRideOffer: failed to read auth currentUser', e);
    }
  } catch (err) {
    console.warn('deleteRideOffer: failed to read before-delete state', err);
  }

  try {
    await deleteDoc(docRef);
    console.log('deleteRideOffer: deleteDoc() returned for', offerID);
  } catch (err) {
    console.warn('deleteRideOffer: deleteDoc failed', err);
    throw err;
  }

  try {
    const after = await getDoc(docRef);
    console.log('deleteRideOffer: exists after delete?', after.exists());
  } catch (err) {
    console.warn('deleteRideOffer: failed to read after-delete state', err);
  }
}
