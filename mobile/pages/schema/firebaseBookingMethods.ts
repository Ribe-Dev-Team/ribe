import { collection, addDoc, updateDoc, doc, Timestamp, deleteDoc, getDoc } from 'firebase/firestore';
import { auth } from '../../firebaseConfig';
import { db } from '../../firebaseConfig';
import { Booking } from './booking.schema';
import { RideRequest, RideOffer } from './firebaseBooking.schema';
import { timePattern, toMinutes } from '../../utility/times';
import { parseDateAsStr, isFutureDate } from '../../utility/dates';

// convert DD-MM-YYYY string to Firestore Timestamp
const parseDateToTimestamp = (dateStr: string): Timestamp => {
  const asDate = parseDateAsStr(dateStr);
  if (asDate !== undefined) return Timestamp.fromDate(asDate);
  throw new Error(`The date ${dateStr} was not a valid date.`);
};

// Add request to DB
export const addRideRequest = async (booking: Booking): Promise<string> => {
  const collectionRef = collection(db, 'rideRequests');

  if (!booking.userId) {
    throw new Error('A user must be signed in to create a ride request.');
  }

  const req: Omit<RideRequest, 'requestID'> = {
    userId: booking.userId,
    status: booking.status ?? 'pending',
    toUni: booking.toUni,
    address: booking.address.trim(),
    date: parseDateToTimestamp(booking.travelDate),
    departureTime: booking.depTime.trim(),
    arrivalTime: booking.arrTime.trim(),
    createdAt: new Date().toISOString(),
  };

  // existence & type checking
  if (typeof req.userId !== 'string' || !req.userId.trim()) {
    throw new Error('userId must be a non-empty string');
  }

  if (req.status !== 'pending' && req.status !== 'awaiting' && req.status !== 'confirmed') {
    throw new Error('status must be pending, awaiting, or confirmed');
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

  const offer: Omit<RideOffer, 'offerID'> = {
    userId: booking.userId,
    status: booking.status ?? 'pending',
    toUni: booking.toUni,
    address: booking.address.trim(),
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

  if (offer.status !== 'pending' && offer.status !== 'awaiting' && offer.status !== 'confirmed') {
    throw new Error('status must be pending, awaiting, or confirmed');
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