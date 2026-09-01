import { collection, addDoc, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { Booking } from './booking.schema';
import { RideRequest, RideOffer } from './firebaseBooking.schema';

/* Time (24hr):
  - hours: all from 00->19 + 20->23
  - minutes: all from 00->59
*/
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
/* Date:
  - days: all from 01->09 + 10->29 + 30->31
  - months all from 01->09 + 10->12
  - years: all from 2020->2099
*/
const datePattern = /^([0][1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])-(20[2-9]\d)$/;

// convert DD-MM-YYYY string to Firestore Timestamp
const parseDateToTimestamp = (dateStr: string): Timestamp => {
  const [day, month, year] = dateStr.trim().split('-').map(Number);
  return Timestamp.fromDate(new Date(year, month - 1, day, 0, 0, 0, 0));
};

// Add request to DB
export const addRideRequest = async (booking: Booking): Promise<string> => {
  const collectionRef = collection(db, 'rideRequests');

  const req: Omit<RideRequest, 'requestID'> = {
    toUni: booking.toUni,
    address: booking.address.trim(),
    date: parseDateToTimestamp(booking.travelDate),
    departureTime: booking.depTime.trim(),
    arrivalTime: booking.arrTime.trim(),
  };

  // existence & type checking
  if (req.toUni !== undefined && typeof req.toUni !== "boolean") {
    throw new Error("toUni must be a boolean");
  }

  if (req.address !== undefined && typeof req.address !== "string") {
    throw new Error("address must be a string");
  }

  if (req.date !== undefined && !(req.date instanceof Timestamp)) {
    throw new Error("date must be a Firestore Timestamp");
  } else if (!Number.isNaN(req.date)) {
    throw new Error(`the date '${booking.travelDate}' is not valid`);
  } else if (new Date(req.date.toDate()).setHours(0, 0, 0, 0) <= new Date().setHours(0, 0, 0, 0)) {
    // create new date objects to protect against mutation
    // set hours, minutes, seconds and milliseconds to 0 so only date components are compared
    throw new Error(`a future date must be provided, not '${booking.travelDate}'`);
  }

  if (req.departureTime !== undefined && !timePattern.test(req.departureTime)) {
    throw new Error("departureTime must be in 'HH:mm' (24-hour) format");
  }

  if (req.arrivalTime !== undefined && !timePattern.test(req.arrivalTime)) {
    throw new Error("arrivalTime must be in 'HH:mm' (24-hour) format");
  }

  // range checking (time in bounds)
  if (req.departureTime && req.arrivalTime) {
    const [depHrs, depMins] = req.departureTime.split(":").map(Number);
    const [arrHrs, arrMins] = req.arrivalTime.split(":").map(Number);

    const departureMinutes = depHrs * 60 + depMins;
    const arrivalMinutes = arrHrs * 60 + arrMins;

    if (arrivalMinutes <= departureMinutes) {
      throw new Error("arrivalTime must be later than departureTime");
    }
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

  const collectionRef = collection(db, 'rideOffers');

  const offer: Omit<RideOffer, 'offerID'> = {
    toUni: booking.toUni,
    address: booking.address.trim(),
    date: parseDateToTimestamp(booking.travelDate),
    departureTime: booking.depTime.trim(),
    arrivalTime: booking.arrTime.trim(),
    maxDetourTime: booking.detourTime,
    seatCapacity: booking.capacity,
  };

  // existence & type checking
  if (offer.toUni !== undefined && typeof offer.toUni !== "boolean") {
    throw new Error("toUni must be a boolean");
  }

  if (offer.address !== undefined && typeof offer.address !== "string") {
    throw new Error("address must be a string");
  }

  if (offer.date !== undefined && !(offer.date instanceof Timestamp)) {
    throw new Error("date must be a Firestore Timestamp");
  } else if (!Number.isNaN(offer.date)) {
    throw new Error(`the date '${booking.travelDate}' is not valid`);
  } else if (new Date(offer.date.toDate()).setHours(0, 0, 0, 0) <= new Date().setHours(0, 0, 0, 0)) {
    // create new date objects to protect against mutation
    // set hours, minutes, seconds and milliseconds to 0 so only date components are compared
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
  }

  if (offer.arrivalTime !== undefined && !timePattern.test(offer.arrivalTime)) {
    throw new Error("arrivalTime must be in 'HH:mm' (24-hour) format");
  }

  // range checking (time in bounds + seats within reason)
  if (offer.departureTime && offer.arrivalTime) {
    const [depHrs, depMins] = offer.departureTime.split(":").map(Number);
    const [arrHrs, arrMins] = offer.arrivalTime.split(":").map(Number);

    const departureMinutes = depHrs * 60 + depMins;
    const arrivalMinutes = arrHrs * 60 + arrMins;
    const timeDiff = arrivalMinutes - departureMinutes;

    if (arrivalMinutes <= departureMinutes) {
      throw new Error("arrivalTime must be later than departureTime");
    } else if (timeDiff < offer.maxDetourTime) {
      throw new Error(`detour allowance of ${offer.maxDetourTime} (min) exceeds travel window of ${timeDiff} (min)`);
    }
  }

  if (offer.seatCapacity < 1 || offer.seatCapacity > 12) {
    throw new Error(`Ride offers require 1 to 12 seats (inclusive) be available but ${offer.seatCapacity} were given.`);
  }

  const docRef = await addDoc(collectionRef, offer);
  await updateDoc(doc(db, 'rideOffers', docRef.id), { offerID: docRef.id });

  return docRef.id;
};

// export async function updateRideRequest(requestID: string, updates: Partial<RideRequest>): Promise<void> {
//   validateRideRequest(updates);

//   const docRef = doc(db, 'rideRequests', requestID);
//   await docRef.update(updates);
// }

// export async function deleteRideRequest(requestID: string): Promise<void> {
//   const docRef = doc(db, 'rideRequests', requestID);
//   await docRef.delete();
// }