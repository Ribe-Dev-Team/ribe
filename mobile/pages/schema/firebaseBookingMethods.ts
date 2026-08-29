import { Timestamp, Firestore } from "firebase/firestore";
import { RideRequest } from "./firebaseBooking.schema";

const { doc, getDoc, setDoc, updateDoc, collection } = require('firebase/firestore');
const db = require('../database');

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

// define conditions for a valid request
function validateRideRequest(req: Partial<RideRequest>): void {
  // existence & type checking
  if (req.toUni !== undefined && typeof req.toUni !== "boolean") {
    throw new Error("toUni must be a boolean");
  }

  if (req.address !== undefined && typeof req.address !== "string") {
    throw new Error("address must be a string");
  }

  if (req.date !== undefined && !(req.date instanceof Timestamp)) {
    throw new Error("date must be a Firestore Timestamp");
  }

  if (req.departureTime !== undefined && !timePattern.test(req.departureTime)) {
    throw new Error("departureTime must be in 'HH:mm' (24-hour) format");
  }

  if (req.arrivalTime !== undefined && !timePattern.test(req.arrivalTime)) {
    throw new Error("arrivalTime must be in 'HH:mm' (24-hour) format");
  }

  // range checking (time in bounds)
  if (req.departureTime && req.arrivalTime) {
    const [dh, dm] = req.departureTime.split(":").map(Number);
    const [ah, am] = req.arrivalTime.split(":").map(Number);

    const departureMinutes = dh * 60 + dm;
    const arrivalMinutes = ah * 60 + am;

    if (arrivalMinutes <= departureMinutes) {
      throw new Error("arrivalTime must be later than departureTime");
    }
  }
}

// Add request to DB
export async function addRideRequest(req: Partial<RideRequest>): Promise<void> {
  // Generate a new document reference with an auto ID
  const docRef = db.collection("rideRequests").doc();

  // add doc reference to data object
  const rideReq = {
    ...req,
    requestID: docRef.id,
  }

  validateRideRequest(req);

  await docRef.set(req);
}

export async function updateRideRequest(requestID: string, updates: Partial<RideRequest>): Promise<void> {
  validateRideRequest(updates);

  const docRef = db.collection("rideRequests").doc(requestID);
  await docRef.update(updates);
}

export async function deleteRideRequest(requestID: string): Promise<void> {
  const docRef = db.collection("rideRequests").doc(requestID);
  await docRef.delete();
}