import { collection, addDoc, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { Booking, Coord } from './booking.schema';
import { RideRequest, RideOffer } from './firebaseBooking.schema';
import { BOOKING_STATUSES, isBookingStatus } from './matchStatus';
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

// export async function updateRideRequest(requestID: string, updates: Partial<RideRequest>): Promise<void> {
//   validateRideRequest(updates);
// }

// export async function deleteRideRequest(requestID: string): Promise<void> {
//   const docRef = doc(db, 'rideRequests', requestID);
//   await docRef.delete();
// }