import { Timestamp } from "firebase/firestore";

export interface RideRequest {
  requestID: string;
  toUni: boolean;
  address: string;
  date: Timestamp;
  departureTime: string; // "HH:mm", 24-hr time
  arrivalTime: string;   // "HH:mm", 24-hr time
}

export interface RideOffer {
  offerID: string;
  toUni: boolean;
  address: string;
  date: Timestamp;
  departureTime: string; // "HH:mm", 24-hr time
  arrivalTime: string;   // "HH:mm", 24-hr time
  maxDetourTime: number;    // time in minutes
  seatCapacity: number;  // max number of passengers
}