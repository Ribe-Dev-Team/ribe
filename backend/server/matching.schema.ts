interface coord {
  lat: number,
  lon: number,
};

interface matchOffer {
  offerId: number,
  waypoints: [coord],
  start: coord,
  end: coord,
  capacity: number,
  travelWindow: {
    start: Date,
    end: Date,
    maxDetour: number, // number of minutes
  },
  currTripDuration: number, // number of minutes
  /* status definitions
    active: looking for matches
    locked: trip participants finalised
    cancelled: one user has cancelled the trip
  */
  status: 'active' | 'locked' | 'cancelled',
  rides: [rideMatch],
};

interface rideMatch {
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

interface matchRequest {
  reqId: number,
  match?: rideMatch,
  start: coord,
  end: coord,
  travelWindow: {
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

interface matchPairing {
  offerId: number,
  reqId: number,
  score: number,
};