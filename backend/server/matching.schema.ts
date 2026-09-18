export { Coord, Waypoint, Trip, MatchOffer, MatchRequest, MatchPairing, RideMatch };

interface Coord {
  lat: number,
  lon: number,
};

// a single waypoint of a trip
interface Waypoint {
  loc: Coord,
  earliest: Date,
  latest: Date,
}

// a sequence of driving legs that make up a carpooling journey to/from uni
interface Trip {
  waypoints: Waypoint[],
  legs: number[], // minutes to drive between each pair of waypoints
  currDur: number, // number of minutes
};

// the details for the ride offer
interface MatchOffer {
  offerId: number,
  start: Coord,
  end: Coord,
  directTime: number, // number of minutes for driver without passengers
  capacity: number,
  window: {
    start: Date,
    end: Date,
    maxDetour: number, // number of minutes
  },
  /* status definitions
  active: looking for matches
  locked: trip participants finalised
  cancelled: one user has cancelled the trip
  */
  status: 'active' | 'locked' | 'cancelled',
  currTrip: Trip,
  rides: RideMatch[],
};

// the details for the ride request
interface MatchRequest {
  reqId: number,
  match?: RideMatch,
  start: Coord,
  end: Coord,
  window: {
    start: Date,
    end: Date,
  },
  /* status definitions
    unassigned: no drive matched
    pending: awaiting for driver + passenger approval
    confirmed: both users have confirmed the trip
    cancelled: either driver or passenger cancelled the trip
    expired: either driver or passenger failed to confirm in time
  */
  status: 'unassigned' | 'pending' | 'confirmed' | 'cancelled' | 'expired';
};

// the in-algorithm GS pair
interface MatchPairing {
  offerId: number,
  reqId: number,
  offerScore: number,
  reqScore: number,
};

// the pending status of a match
interface RideMatch {
  rideId: number,
  offerId: number,
  /* status definitions
    unassigned: no drive matched
    driver_pending: waiting for driver approval
    passenger_pending: waiting for passenger approval
    confirmed: both users have confirmed the trip
    driver_cancelled: the driver cancelled the trip
    passenger_cancelled: the passenger cancelled the trip
    driver_expired: the driver failed to confirm in time
    passenger_expired: the passenger failed to confirm in time
  */
  status: 'unassigned' | 'driver_pending' | 'passenger_pending' | 'confirmed' | 'driver_cancelled' | 'passenger_cancelled' | 'driver_expired' | 'passenger_cancelled';
};