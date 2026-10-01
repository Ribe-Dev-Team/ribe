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
  /** Earliest the rider can be collected - their stated departure time. Named
   *  after `Waypoint.earliest` in backend/server/matching.schema.ts. Optional so
   *  older inputs without it simply skip the check (see `addPassenger`). */
  earliest?: Date;
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
  | 'OUT_OF_SLACK'          // someone aboard has no detour left to give
  | 'DIRECTION'
  | 'TIME_WINDOW'
  | 'BEARING'
  | 'CORRIDOR'
  | 'NO_FEASIBLE_INSERTION'
  | 'RIDER_DETOUR_CAP'      // the new rider's own detour would be too long
  | 'ONBOARD_DETOUR_CAP'    // someone already aboard would exceed theirs
  | 'DRIVER_DETOUR_CAP'
  | 'ARRIVAL_WINDOW'
  | 'PICKUP_BEFORE_READY'
  | 'MATCHING_CUTOFF'
  | 'LOST_SLOT';            // feasible, but the one slot went to a cheaper rider

/** One rider's place in a car's timetable. */
export interface TripStop {
  reqId: string;
  /** When the car collects them: at their door going to campus, at campus
   *  departure coming from it. */
  pickupAt: Date;
  /** When they reach their own destination. */
  arriveAt: Date;
}

/** One rider offered to one driver by a matching run. */
export interface ProposedMatch {
  offerId: string;
  reqId: string;
  riderId: string;
  driverId: string;
  insertionIndex: number;
  riderDetour: number;
  driverAddedMinutes: number;
  offerScore: number;
  reqScore: number;
  /** When the driver sets off - the start of the car's timetable. */
  departAt: Date;
  finalArrival: Date;
  totalTripMinutes: number;
  /** This rider's own estimated pickup and arrival. */
  pickupAt: Date;
  arriveAt: Date;
  /** The whole car's timetable if this match is accepted: every rider on the
   *  route, confirmed ones included, in pickup order. Adding a rider can move
   *  the others' times, so the car's timetable is stored, not just this rider's. */
  schedule: TripStop[];
  /** When this batch produced the match — every match in one run shares it. */
  matchedAt: Date;
  /** By when the pair must accept, or the match lapses. Clamped to whichever
   *  comes first: the normal approval window, or the matching cutoff — a
   *  match proposed late must never promise more time to accept than the
   *  batch can actually give it before the trip locks. */
  acceptDeadline: Date;
}

export interface MatchRunResult {
  batchKey: string;
  matches: ProposedMatch[];
  rejected: RejectedPairing[];
  unmatchedRequestIds: string[];
  /** For each unmatched rider, why each driver in the batch didn't take them. */
  unmatchedReasons: Array<{ reqId: string; byOffer: Array<{ offerId: string; reason: RejectReason }> }>;
  stats: {
    requestsIn: number;
    offersIn: number;
    matchesMade: number;
    matchRate: number;
    avgRiderDetourMinutes: number;
    avgDriverAddedMinutes: number;
    seatsLeftOnClosedTrips: number;
    closedByDriverChoice: number;
    closedBySlack: number;
    closedByCutoff: number;
  };
}

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
  /** Share of a rider's own direct trip they are assumed to tolerate as
   *  detour. Riders are NOT asked for this — see `riderPolicy.ts` for the
   *  measurements behind 0.40. */
  riderDetourPercent: number;
  /** Lower bound on that derived cap, so short trips stay matchable. */
  riderDetourFloorMinutes: number;
  /** Plan every rider's arrival this many minutes before the time they gave.
   *  Drive times don't include traffic, and arriving late is the one outcome a
   *  rider can't recover from, so the matcher aims early rather than exactly.
   *  Applied by the adapter, which turns "on campus by 9:00" into a 8:50
   *  `arriveBy`; the algorithm itself is unchanged. */
  arrivalMarginMinutes: number;
}

export const DEFAULT_CONFIG: MatchingConfig = {
  bearingThresholdDegrees: 90,
  useBearingFilter: true,
  roadSlackFactor: 1.5,
  insertionFloorMinutes: 2,
  maxCandidatePairs: 500,
  matchingCutoffMinutes: 120,
  approvalWindowMinutes: 720,
  riderDetourPercent: 0.40,
  riderDetourFloorMinutes: 5,
  arrivalMarginMinutes: 10,
};
