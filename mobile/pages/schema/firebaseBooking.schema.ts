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
  Match result, written by the matching runner (matching/runner/firestore.ts)
  and read back by rideData.ts to render the card. All absent until this request
  is matched; all cleared again if the rider declines (which cancels the
  request) or the driver removes their offer (the runner then returns the
  request to 'pending'), so their
  presence is what distinguishes "matched" from "still searching" independently
  of `status`.
  */
  matchedOfferId?: string;   // rideOffers doc id this rider was placed on
  matchedDriverId?: string;  // driver's uid -> drivers/{uid} for name, vehicle, plate
  matchedAt?: Timestamp;     // when the matcher produced the match, NOT when it was read
  acceptDeadline?: Timestamp; // matcher's own clamped deadline; drives the approval countdown
  riderDetourMinutes?: number; // this rider's own detour on the shared route
  routeIndex?: number;       // pickup position among the offer's confirmed riders; used by acceptMatch
  /*
  This rider's estimated pickup and arrival AS OF THE MATCH. The offer's
  `schedule` is the live version (it is re-timed when later riders join); these
  are only the card's fallback if the offer can't be read.
  */
  pickupAt?: Timestamp;
  arriveAt?: Timestamp;
}

/** One rider's place in a car's timetable. */
export interface TripStop {
  requestId: string;
  pickupAt: Timestamp; // at their door going to campus; the driver's departure leaving it
  arriveAt: Timestamp; // at their own destination
}

/** A car's timetable, computed by the matcher from real drive times. */
export interface TripSchedule {
  departAt: Timestamp; // the driver sets off
  arriveAt: Timestamp; // the driver reaches their own destination
  stops: TripStop[];   // every rider, in pickup order
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
  what makes a partly-full trip still matchable on the next run. It is kept in
  PICKUP ORDER (acceptMatch inserts at the rider's routeIndex), because the next
  run rebuilds the car's route from it.
  */
  pendingRequestId?: string | null;
  /*
  The uid of the rider in that pending slot. The published Firestore rules let
  a user update someone else's offer only when this matches them, and the
  rider's Accept/Decline updates the driver's offer - so it's required, not
  informational. Cleared again once the rider answers.
  */
  matchedRiderId?: string;
  confirmedRequestIds?: string[];
  /*
  False once the driver locks the trip: no more passengers are offered to it
  (setOfferLocked). Absent means true - offers start out taking riders.
  */
  acceptingMore?: boolean;
  matchedAt?: Timestamp;
  acceptDeadline?: Timestamp;
  /*
  `schedule` is the timetable for the confirmed riders. `pendingSchedule` is the
  matcher's proposal with the pending rider added - adding a rider can shift
  everyone else's pickup - and acceptMatch moves it into `schedule`. Kept on the
  offer, not on each request, because one rider can't update another's booking.
  */
  schedule?: TripSchedule;
  pendingSchedule?: TripSchedule;
}