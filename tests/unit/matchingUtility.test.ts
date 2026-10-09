import {
  coordIsUni,
  getEndTime,
  getStartTime,
  isTripToUni,
  isBookingToUni,
  insertAt,
  min,
  sum,
} from "../../backend/server/matching";
import type { MatchOffer, MatchRequest, Trip } from "../../backend/server/matching.schema";
import { MONASH_CLAYTON_LOCATION } from "../../mobile/services/googlePlaces";

describe('Matching utility - coordIsUni()', () => {
  test('uni object matches itself', () => {
    const exp = true;
    const act = coordIsUni({
      ...MONASH_CLAYTON_LOCATION,
      lon: MONASH_CLAYTON_LOCATION.lng,
    });
    expect(act).toBe(exp);
  });

  test('uni object matches other coord object', () => {
    const exp = true;
    const act = coordIsUni({
      lat: MONASH_CLAYTON_LOCATION.lat,
      lon: MONASH_CLAYTON_LOCATION.lng,
    });
    expect(act).toBe(exp);
  });

  test('uni object doesn\'t match different latitudes', () => {
    const exp = false;
    const act = coordIsUni({
      lat: MONASH_CLAYTON_LOCATION.lat + 0.05, // off by ~5.6km
      lon: MONASH_CLAYTON_LOCATION.lng,
    });
    expect(act).toBe(exp);
  });

  test('uni object doesn\'t match different longitudes', () => {
    const exp = false;
    const act = coordIsUni({
      lat: MONASH_CLAYTON_LOCATION.lat,
      lon: MONASH_CLAYTON_LOCATION.lng - 0.05,// off by ~5.6km
    });
    expect(act).toBe(exp);
  });
});

describe('Matching utility - getEndTime()', () => {
  test('correctly retrieves end time value from MatchRequest', () => {
    const req: MatchRequest = {
      reqId: -1,
      start: { lat: 0, lon: 0 },
      end: { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng },
      status: "unassigned",
      window: {
        start: new Date("2026-09-17T07:24:00"),
        end: new Date("2026-09-17T10:00:00"),
      },
    };
    const act = getEndTime(req);
    expect(act).toEqual(req.window.end);
  });

  test('correctly retrieves end time value from MatchOffer', () => {
    const offer: MatchOffer = {
      offerId: -1,
      start: { lat: 0, lon: 0 },
      end: { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng },
      status: "active",
      window: {
        start: new Date("2026-09-17T07:24:00"),
        end: new Date("2026-09-17T10:00:00"),
        maxDetour: 45,
      },
      currTrip: {
        waypoints: [],
        legs: [],
        legDists: [],
        currDist: 10,
        currDur: 30,
      },
      capacity: 2,
      rides: [],
      directTime: 30,
      directDist: 26,
    };
    const act = getEndTime(offer);
    expect(act).toEqual(offer.window.end);
  });
});

describe('Matching utility - getStartTime()', () => {
  test('correctly retrieves start time value from MatchRequest', () => {
    const req: MatchRequest = {
      reqId: -1,
      start: { lat: 0, lon: 0 },
      end: { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng },
      status: "unassigned",
      window: {
        start: new Date("2026-09-17T07:24:00"),
        end: new Date("2026-09-17T10:00:00"),
      },
    };
    const act = getStartTime(req);
    expect(act).toEqual(req.window.start);
  });

  test('correctly retrieves start time value from MatchOffer', () => {
    const offer: MatchOffer = {
      offerId: -1,
      start: { lat: 0, lon: 0 },
      end: { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng },
      status: "active",
      window: {
        start: new Date("2026-09-17T07:24:00"),
        end: new Date("2026-09-17T10:00:00"),
        maxDetour: 45,
      },
      currTrip: {
        waypoints: [],
        legs: [],
        legDists: [],
        currDist: 10,
        currDur: 30,
      },
      capacity: 2,
      rides: [],
      directTime: 30,
      directDist: 28,
    };
    const act = getStartTime(offer);
    expect(act).toEqual(offer.window.start);
  });
});

describe('Matching utility - isTripToUni()', () => {
  const t: Trip = {
    waypoints: [
      {
        loc: { lat: -37.8271566, lon: 145.1184227 },  // Aqualink Box Hill
        earliest: new Date("2026-09-17T07:24:00"),
        latest: new Date("2026-09-17T10:00:00"),
      },
      {
        loc: { lat: -37.8647917, lon: 145.1267146 },  // Hungry Jacks Mt Waverley
        earliest: new Date("2026-09-17T08:00:00"),
        latest: new Date("2026-09-17T10:13:00"),
      },
      {
        loc: { lat: -37.8863832, lon: 145.143038 },  // Waverley Private Hospital
        earliest: new Date("2026-09-17T08:30:00"),
        latest: new Date("2026-09-17T10:17:00"),
      },
      {
        loc: { lat: -37.8961912, lon: 145.1283908 },  // Mt Waverley Badminton Centre
        earliest: new Date("2026-09-17T09:00:00"),
        latest: new Date("2026-09-17T10:23:00"),
      },
      {
        loc: { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng },
        earliest: new Date("2026-09-17T09:30:00"),
        latest: new Date("2026-09-17T10:28:00"),
      },
    ],
    legs: [13, 5, 7, 6],
    legDists: [7.1, 2.8, 2.6, 1.9],
    currDist: 14.4,
    currDur: 28,
  };

  const t2: Trip = {
    waypoints: [
      {
        loc: { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng },
        earliest: new Date("2026-09-17T17:00:00"),
        latest: new Date("2026-09-17T19:00:00"),
      },
      {
        loc: { lat: -37.8961912, lon: 145.1283908 },  // Mt Waverley Badminton Centre
        earliest: new Date("2026-09-17T17:06:00"),
        latest: new Date("2026-09-17T19:36:00"),
      },
      {
        loc: { lat: -37.9022032, lon: 145.2079725 },  // Chesterfield Farm
        earliest: new Date("2026-09-17T17:20:00"),
        latest: new Date("2026-09-17T20:00:00"),
      },
      {
        loc: { lat: -37.9275359, lon: 145.2681855 },  // Lysterfield Aged Care
        earliest: new Date("2026-09-17T17:34:00"),
        latest: new Date("2026-09-17T20:30:00"),
      },
      {
        loc: { lat: -37.9077353, lon: 145.354052 },  // Puffing Billy Railway
        earliest: new Date("2026-09-17T17:48:00"),
        latest: new Date("2026-09-17T21:00:00"),
      },

    ],
    legs: [6, 14, 14, 14],
    legDists: [1.9, 8.4, 9.1, 14.2],
    currDist: 33.6,
    currDur: 48,
  };

  test('correctly determines the trip is to uni', () => {
    const act = isTripToUni(t);
    expect(act).toBe(true);
  });

  test('correctly determines the trip is not to uni', () => {
    const act = isTripToUni(t2);
    expect(act).toBe(false);
  });
});

describe('Matching utility - isBookingToUni()', () => {
  const req1: MatchRequest = {
    reqId: -1,
    start: { lat: 0, lon: 0 },
    end: { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng },
    status: "unassigned",
    window: {
      start: new Date("2026-09-17T07:24:00"),
      end: new Date("2026-09-17T10:00:00"),
    },
  };

  const req2: MatchRequest = {
    reqId: -1,
    start: { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng },
    end: { lat: 0, lon: 0 },
    status: "unassigned",
    window: {
      start: new Date("2026-09-17T07:24:00"),
      end: new Date("2026-09-17T10:00:00"),
    },
  };

  const offer1: MatchOffer = {
    offerId: -1,
    start: { lat: -37.8271566, lon: 145.1184227 }, // Aqualink Box Hill
    end: { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng },
    status: "active",
    window: {
      start: new Date("2026-09-17T07:24:00"),
      end: new Date("2026-09-17T11:00:00"),
      maxDetour: 45,
    },
    currTrip: {
      waypoints: [
        {
          loc: { lat: -37.8271566, lon: 145.1184227 },  // Aqualink Box Hill
          earliest: new Date("2026-09-17T07:24:00"),
          latest: new Date("2026-09-17T10:00:00"),
        },
        {
          loc: { lat: -37.8647917, lon: 145.1267146 },  // Hungry Jacks Mt Waverley
          earliest: new Date("2026-09-17T08:00:00"),
          latest: new Date("2026-09-17T10:13:00"),
        },
        {
          loc: { lat: -37.8863832, lon: 145.143038 },  // Waverley Private Hospital
          earliest: new Date("2026-09-17T08:30:00"),
          latest: new Date("2026-09-17T10:17:00"),
        },
        {
          loc: { lat: -37.8961912, lon: 145.1283908 },  // Mt Waverley Badminton Centre
          earliest: new Date("2026-09-17T09:00:00"),
          latest: new Date("2026-09-17T10:23:00"),
        },
        {
          loc: { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng },
          earliest: new Date("2026-09-17T09:30:00"),
          latest: new Date("2026-09-17T10:28:00"),
        },
      ],
      legs: [13, 5, 7, 6],
      legDists: [7.1, 2.8, 2.6, 1.9],
      currDist: 14.4,
      currDur: 28,
    },
    capacity: 3,
    rides: [
      { rideId: -1, offerId: -1, status: "driver_pending" },
      { rideId: -2, offerId: -1, status: "driver_pending" },
      { rideId: -3, offerId: -1, status: "driver_pending" },
    ],
    directTime: 19,
    directDist: 11.4,
  };

  const offer2: MatchOffer = {
    offerId: -2,
    start: { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng },
    end: { lat: -37.9077353, lon: 145.354052 },
    status: "active",
    window: {
      start: new Date("2026-09-17T16:00:00"),
      end: new Date("2026-09-17T22:00:00"),
      maxDetour: 45,
    },
    currTrip: {
      waypoints: [
        {
          loc: { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng },
          earliest: new Date("2026-09-17T17:00:00"),
          latest: new Date("2026-09-17T19:00:00"),
        },
        {
          loc: { lat: -37.8961912, lon: 145.1283908 },  // Mt Waverley Badminton Centre
          earliest: new Date("2026-09-17T17:06:00"),
          latest: new Date("2026-09-17T19:36:00"),
        },
        {
          loc: { lat: -37.9022032, lon: 145.2079725 },  // Chesterfield Farm
          earliest: new Date("2026-09-17T17:20:00"),
          latest: new Date("2026-09-17T20:00:00"),
        },
        {
          loc: { lat: -37.9275359, lon: 145.2681855 },  // Lysterfield Aged Care
          earliest: new Date("2026-09-17T17:34:00"),
          latest: new Date("2026-09-17T20:30:00"),
        },
        {
          loc: { lat: -37.9077353, lon: 145.354052 },  // Puffing Billy Railway
          earliest: new Date("2026-09-17T17:48:00"),
          latest: new Date("2026-09-17T21:00:00"),
        },

      ],
      legs: [6, 14, 14, 14],
      legDists: [1.9, 8.4, 9.1, 14.2],
      currDist: 33.6,
      currDur: 48,
    },
    capacity: 4,
    rides: [
      { rideId: -4, offerId: -2, status: "driver_pending" },
      { rideId: -5, offerId: -2, status: "driver_pending" },
      { rideId: -6, offerId: -2, status: "driver_pending" },
    ],
    directTime: 31,
    directDist: 23.4,
  };

  test('correctly determines the ride request is not to uni', () => {
    const act = isBookingToUni(req1);
    expect(act).toBe(true);
  });

  test('correctly determines the ride request is to uni', () => {
    const act = isBookingToUni(req2);
    expect(act).toBe(false);
  });

  test('correctly determines the ride offer is not to uni', () => {
    const act = isBookingToUni(offer1);
    expect(act).toBe(true);
  });

  test('correctly determines the ride offer is to uni', () => {
    const act = isBookingToUni(offer2);
    expect(act).toBe(false);
  });
});

describe('Matching utility - insertAt()', () => {
  const l = [1, 2, 3, 5, 8];

  test('insert at index -1', () => {
    const act = insertAt(l, [99], -1);
    const exp = [1, 2, 3, 5, 99, 8];
    expect(act).toEqual(exp);
  });

  test('insert at index 0', () => {
    const act = insertAt(l, [99], 0);
    const exp = [99, ...l];
    expect(act).toEqual(exp);
  });

  test('insert at index 1', () => {
    const act = insertAt(l, [99], 1);
    const exp = [1, 99, 2, 3, 5, 8];
    expect(act).toEqual(exp);
  });

  test('insert at index 4', () => {
    const act = insertAt(l, [99], 4);
    const exp = [1, 2, 3, 5, 99, 8];
    expect(act).toEqual(exp);
  });

  test('insert at index 5', () => {
    const act = insertAt(l, [99], 5);
    const exp = [1, 2, 3, 5, 8, 99];
    expect(act).toEqual(exp);
  });

  test('insert at index 6', () => {
    expect(() => insertAt(l, [99], 6)).toThrow('out of range');
  });

  test('replace -1 items', () => {
    expect(() => insertAt(l, [99], 2, -1)).toThrow('negative number');
  });

  test('replace 0 items', () => {
    const act = insertAt(l, [99], 2, 0);
    const exp = [1, 2, 99, 3, 5, 8];
    expect(act).toEqual(exp);
  });

  test('replace 1 item', () => {
    const act = insertAt(l, [99], 2, 1);
    const exp = [1, 2, 99, 5, 8];
    expect(act).toEqual(exp);
  });

  test('replace all but last 1 item', () => {
    const act = insertAt(l, [98, 99], 1, 3);
    const exp = [1, 98, 99, 8];
    expect(act).toEqual(exp);
  });

  test('replace all items to right', () => {
    const act = insertAt(l, [98, 99], 1, 4);
    const exp = [1, 98, 99];
    expect(act).toEqual(exp);
  });

  test('check for error when trying to replace too many items', () => {
    expect(() => insertAt(l, [98, 99], 1, 5)).toThrow();
  });

  test('empty insert without deletion', () => {
    const act = insertAt(l, [], 1);
    const exp = [1, 2, 3, 5, 8];
    expect(act).toEqual(exp);
  });

  test('empty insert with deletion', () => {
    const act = insertAt(l, [], 2, 2);
    const exp = [1, 2, 8];
    expect(act).toEqual(exp);
  });

  test('insert many', () => {
    const act = insertAt(l, [95, 96, 97, 98, 99], 2);
    const exp = [1, 2, 95, 96, 97, 98, 99, 3, 5, 8];
    expect(act).toEqual(exp);
  });

  test('add nothing to empty list', () => {
    const act: number[] = insertAt([], [], 0);
    const exp: number[] = [];
    expect(act).toEqual(exp);
  });

  test('add to empty list', () => {
    const act = insertAt([], [9], 0);
    const exp = [9];
    expect(act).toEqual(exp);
  });

  test('check no side effects', () => {
    const start = [1, 2, 3];
    const add = [98, 99];
    const act = insertAt(start, add, 1, 1);
    const exp = [1, 98, 99, 3];
    expect(act).toEqual(exp);
    expect(start).toEqual([1, 2, 3]);
    expect(add).toEqual([98, 99]);
  });

  test('check new array returned', () => {
    const start = [1, 2, 3];
    const act = insertAt(start, [], 0);
    const exp = [1, 2, 3];
    expect(act).toEqual(exp);
    expect(act).not.toBe(start);
  });
});

describe('Matching utility - min()', () => {
  test('numeric minimum', () => {
    const l = [9, 27, 0.1, 99, -1];
    const exp = -1;
    const act = min(l);
    expect(act).toBe(exp);
  });

  test('alphabetic minimum', () => {
    const l = ['n', 'e', 'V', 'a', 'r'];
    const exp = 'V';
    const act = min(l);
    expect(act).toBe(exp);
  });

  test('duplicate minimum', () => {
    const l = ['n', 'e', 'v', 'e', 'r'];
    const exp = 'e';
    const act = min(l);
    expect(act).toBe(exp);
  });
});

describe('Matching utility - sum()', () => {
  test('numeric minimum', () => {
    const l = [9, 27, 0.1, 99, -1];
    const exp = 134.1;
    const act = sum(l);
    expect(act).toBe(exp);
  });
});
