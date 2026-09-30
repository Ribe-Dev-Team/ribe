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

  /*
  Match result, written by the matcher (see applyMatch in
  firebaseBookingMethods.ts) and read back by rideData.ts to render the card.
  All absent until this request is matched; all cleared again if the rider or
  driver declines, so their presence is what distinguishes "matched" from
  "still searching" independently of `status`.
  */
  matchedOfferId?: string;   // rideOffers doc id this rider was placed on
  matchedDriverId?: string;  // driver's uid -> drivers/{uid} for name, vehicle, plate
  matchedAt?: Timestamp;     // when the matcher produced the match, NOT when it was read
  acceptDeadline?: Timestamp; // matcher's own clamped deadline; drives the approval countdown
  riderDetourMinutes?: number; // this rider's own detour on the shared route
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

  /*
  Occupancy, written by the matcher and the accept/decline handlers.

  `pendingRequestId` is at most ONE id because the matcher offers a driver a
  single new rider per run (see matching/src/deferredAcceptance.ts) — accepting
  is a human decision, so a driver is never asked to judge two strangers at
  once. `confirmedRequestIds` accumulates across runs as riders accept, and is
  what makes a partly-full trip still matchable on the next run.
  */
  pendingRequestId?: string | null;
  confirmedRequestIds?: string[];
  matchedAt?: Timestamp;
  acceptDeadline?: Timestamp;
}

/**
 * One match, as the matching module produces it, reduced to just the fields
 * Firestore needs. Declared structurally rather than imported from
 * matching/src so mobile does not bundle the matching package — the same
 * reason matchStatus.ts duplicates its status union.
 */
export interface MatchWriteInput {
  reqId: string;
  offerId: string;
  riderId: string;
  driverId: string;
  matchedAt: Date;
  acceptDeadline: Date;
  riderDetourMinutes: number;
}