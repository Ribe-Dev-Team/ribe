/**
 * Ribe matching types.
 *
 * Names follow backend/server/matching.schema.ts where they overlap, so this
 * module drops into the team's existing vocabulary rather than competing with it.
 */

export interface Coord {
  lat: number;
  lon: number;
}

export type Direction = 'TO_CAMPUS' | 'FROM_CAMPUS';

/** Where a trip sits in its life. Separated from `acceptingMore` on purpose:
 *  "driver closed it" and "we ran out of detour budget" must be distinguishable. */
export type OfferStatus =
  | 'open'      // still searching for riders
  | 'closed'    // not searching; reversible while there is still time
  | 'locked'    // departure imminent, no further change
  | 'cancelled';

export type RideStatus =
  | 'unassigned'
  | 'driver_pending'
  | 'passenger_pending'
  | 'confirmed'
  | 'driver_cancelled'
  | 'passenger_cancelled'
  | 'driver_expired'
  | 'passenger_expired';

export interface TravelWindow {
  /** Earliest the trip may depart. */
  start: Date;
  /** Latest the trip may depart (riders: derived from arriveBy). */
  end: Date;
}

export interface Preferences {
  quietRide: boolean;
}

export interface MatchRequest {
  reqId: string;
  riderId: string;
  direction: Direction;
  /** Rider's own origin and destination. One end is campus. */
  start: Coord;
  end: Coord;
  travelWindow: TravelWindow;
  /** Hard latest arrival. The whole point of the trip. */
  arriveBy: Date;
  /** Minutes of detour this rider consented to, over their own direct trip. */
  maxDetour: number;
  preferences: Preferences;
  status: 'unassigned' | 'pending' | 'confirmed' | 'cancelled' | 'expired';
}

export interface MatchOffer {
  offerId: string;
  driverId: string;
  direction: Direction;
  start: Coord;
  end: Coord;
  travelWindow: TravelWindow;
  /** Minutes of detour the driver consented to across the whole trip. */
  maxDetour: number;

  /** What the driver said upfront. */
  seatsOffered: number;
  /** Confirmed riders so far. */
  seatsFilled: number;
  /** The driver's live choice — they may stop early at 2 of 4. */
  acceptingMore: boolean;

  status: OfferStatus;
  preferences: Preferences;
  /** Riders already on board, in pickup order. */
  onBoard: OnBoardRider[];
  /** Duration in minutes of the current committed route. */
  currTripDuration: number;
}

export interface OnBoardRider {
  reqId: string;
  riderId: string;
  /** The rider's waypoint — pickup going to campus, drop-off coming from it. */
  waypoint: Coord;
  arriveBy: Date;
  maxDetour: number;
  /** Detour in minutes this rider is currently experiencing. */
  currentDetour: number;
}

/** A viable (offer, request) pair that survived filtering, with both scores.
 *  Mirrors matchPairing in matching.schema.ts. */
export interface MatchPairing {
  offerId: string;
  reqId: string;
  offerScore: number;
  reqScore: number;
  /** Where in the route the rider would be inserted. */
  insertionIndex: number;
  /** What the insertion costs each party, in minutes. */
  riderDetour: number;
  driverAddedMinutes: number;
}

export interface RejectedPairing {
  offerId: string;
  reqId: string;
  reason: RejectReason;
}

export type RejectReason =
  | 'SAME_PERSON'
  | 'OFFER_NOT_OPEN'
  | 'NO_SEATS'
  | 'DRIVER_CLOSED'
  | 'DIRECTION'
  | 'TIME_WINDOW'
  | 'BEARING'
  | 'CORRIDOR'
  | 'NO_FEASIBLE_INSERTION'
  | 'RIDER_DETOUR_CAP'
  | 'DRIVER_DETOUR_CAP'
  | 'ARRIVAL_WINDOW'
  | 'MATCHING_CUTOFF';

/** Travel time between any two points, in minutes.
 *  The single seam between pure matching and the outside world. */
export interface TravelTimeMatrix {
  minutes(a: Coord, b: Coord): number;
}

export interface MatchingConfig {
  /** KEY-136. Set high (~90) to kill only absurd pairs; see notes in README. */
  bearingThresholdDegrees: number;
  /** KEY-135/136 on or off, so its cost can be measured. */
  useBearingFilter: boolean;
  /** Corridor filter slack — straight lines underestimate roads. */
  roadSlackFactor: number;
  /** Stop searching when the tightest slack on board falls below this. */
  insertionFloorMinutes: number;
  /** Cap on pairs sent forward, bounding API spend per batch. */
  maxCandidatePairs: number;
  /** A trip stops accepting new riders once departure is this close, and
   *  locks with whoever is already aboard — independent of seats or slack.
   *  Anchored to departure, not arrival: departure is when someone has to be
   *  standing outside, and it's what `travelWindow.start` already holds. */
  matchingCutoffMinutes: number;
  /** How long a proposed match has to be accepted before it lapses. Mirrors
   *  the mobile app's APPROVAL_WINDOW_MS (RideCard.tsx) — kept here too so
   *  `acceptDeadline` can be clamped against the matching cutoff without a
   *  match ever promising more time than the batch can actually honour. */
  approvalWindowMinutes: number;
}

export const DEFAULT_CONFIG: MatchingConfig = {
  bearingThresholdDegrees: 90,
  useBearingFilter: true,
  roadSlackFactor: 1.5,
  insertionFloorMinutes: 2,
  maxCandidatePairs: 500,
  matchingCutoffMinutes: 120,
  approvalWindowMinutes: 720,
};
