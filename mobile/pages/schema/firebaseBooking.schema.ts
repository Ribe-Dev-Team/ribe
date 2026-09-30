import { Timestamp } from "firebase/firestore";
import { Coord } from "./booking.schema";
import { BookingStatus } from "./matchStatus";

export type { Coord, BookingStatus };

export interface RideRequest {
  requestID: string;
  userId: string;
  status: BookingStatus;
  toUni: boolean;
  address: string;
  coord?: Coord;         // resolved lat/lon; absent when geocoding was unavailable
  date: Timestamp;
  departureTime: string; // "HH:mm", 24-hr time
  arrivalTime: string;   // "HH:mm", 24-hr time
  /*
  NOTE: there is deliberately no rider detour field. The matcher still needs
  MatchRequest.maxDetour, but it is DERIVED from the rider's own direct trip at
  match time (matching/src/riderPolicy.ts - 40% of direct, floor 5 min) rather
  than asked for. Storing a derived absolute value here would go stale the
  moment that policy changed, and computing it needs the travel-time matrix,
  which the app does not have.
  */
  createdAt?: string;
}

export interface RideOffer {
  offerID: string;
  userId: string;
  status: BookingStatus;
  toUni: boolean;
  address: string;
  coord?: Coord;         // resolved lat/lon; absent when geocoding was unavailable
  date: Timestamp;
  departureTime: string; // "HH:mm", 24-hr time
  arrivalTime: string;   // "HH:mm", 24-hr time
  maxDetourTime: number;    // time in minutes
  seatCapacity: number;  // max number of passengers
  createdAt?: string;
}