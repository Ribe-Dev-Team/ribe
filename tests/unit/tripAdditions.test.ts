import type { MatchOffer, MatchRequest, Waypoint, Trip, Coord } from "../../backend/server/matching.schema";
import { MONASH_CLAYTON_LOCATION } from "../../mobile/services/googlePlaces";
import { scanTripToUni, scanTripFromUni, addPassenger } from "../../backend/server/tripAdditions";

import { calcDist } from "../../mobile/utility/distances";
import { isBookingToUni } from "../../backend/server/matching";
import { computeRoute } from "../../mobile/services/googleRoutes";
import { mockConfig, leg, routesResponse, emptyRoutesResponse, resetGoogleApiMock } from "../../__mocks__/googleRouteAPI";

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

describe('scanTripToUni testing', () => {
  // ------------------------- Helpers -------------------------
  // Fixed UTC dates so tests are timezone-independent. Minutes may overflow (hour(8, 60) = 9:00).
  const tOfDay = (h: number, m = 0) => new Date(Date.UTC(2030, 0, 1, h, m));
  const hm = (d: Date) => d.toISOString().slice(11, 16);

  // Default 'latest' is deliberately loose so it never interferes with the computed value.
  const mkWp = (x: number, earliest: Date, latest: Date = tOfDay(23)): Waypoint => ({
    loc: { lat: x, lon: x },
    earliest,
    latest,
  });

  const mkReq = (end: Date): MatchRequest => ({
    reqId: -10,
    start: { lat: 0, lon: 0 },
    end: { lat: 0, lon: 0 },
    window: { start: tOfDay(7), end },
    status: 'unassigned',
  });

  // Readable summary: [[earliest, latest], ...] as "HH:MM", or null
  const timeWindows = (ws: Waypoint[] | null) =>
    ws && ws.map(w => [hm(w.earliest), hm(w.latest)]);

  const r = mkReq(tOfDay(9));
  const stops = (n: number) => Array.from({ length: n }, (_, i) => mkWp(i, tOfDay(8)));
  const legsOf = (n: number, v = 10) => Array<number>(n).map((_, ind) => ind + v);

  // Test input validation
  it('Input validation - 1 waypoint throws', () => {
    expect(() => scanTripToUni(r, stops(1), [])).toThrow(/less than 2 waypoints/);
  });
  it('Input validation - 2 waypoints (on boundary) is accepted', () => {
    expect(() => scanTripToUni(r, stops(2), legsOf(1))).not.toThrow();
  });
  it('Input validation - 3 waypoints is accepted', () => {
    expect(() => scanTripToUni(r, stops(3), legsOf(2))).not.toThrow();
  });

  it('Input validation - 1 leg too few throws', () => {
    expect(() => scanTripToUni(r, stops(3), legsOf(1))).toThrow(/didn't match/);
  });
  it('Input validation - correct # legs is accepted', () => {
    expect(() => scanTripToUni(r, stops(3), legsOf(2))).not.toThrow();
  });
  it('Input validation - 1 leg too many throws', () => {
    expect(() => scanTripToUni(r, stops(3), legsOf(3))).toThrow(/didn't match/);
  });

  it('Input validation - leg = -1 (just below) throws', () => {
    expect(() => scanTripToUni(r, stops(2), [-1, 10, 11])).toThrow(/negative travel time/);
  });
  it('Input validation - leg = 0 (on boundary) is accepted', () => {
    expect(() => scanTripToUni(r, stops(2), [1, 0, 1])).not.toThrow();
  });
  it('Input validation - a negative leg is caught in the middle of the list', () => {
    expect(() => scanTripToUni(r, stops(4), [0, -1, 10])).toThrow(/negative travel time/);
  });
  it('Input validation - a negative leg is caught at the end of the list', () => {
    expect(() => scanTripToUni(r, stops(4), [0, 10, -1])).toThrow(/negative travel time/);
  });

  // Test arrival time selection
  const runWithEnd = (end: Date) =>
    scanTripToUni(mkReq(end), [mkWp(0, tOfDay(8), tOfDay(9)), mkWp(1, tOfDay(8), tOfDay(9))], [10]);

  it.each([
    ['Arrival Time - new request ends 1 min earlier (new passenger is stricter)', tOfDay(8, 59), [['08:00', '08:49'], ['08:10', '08:59']]],
    ['Arrival Time - new request ends at the same time', tOfDay(9), [['08:00', '08:50'], ['08:10', '09:00']]],
    ['Arrival Time - new request ends 1 min later (existing arrival unchanged)', tOfDay(9, 1), [['08:00', '08:50'], ['08:10', '09:00']]],
  ])('%s', (_name, end, expected) => {
    expect(timeWindows(runWithEnd(end))).toEqual(expected);
  });

  // Test backwards pass
  it('Backward Pass - 3 legs with distinct values', () => {
    const wps = [mkWp(0, tOfDay(8)), mkWp(1, tOfDay(8)), mkWp(2, tOfDay(8)), mkWp(3, tOfDay(8))];
    expect(timeWindows(scanTripToUni(mkReq(tOfDay(10)), wps, [10, 20, 30]))).toEqual([
      ['08:00', '09:00'],
      ['08:10', '09:10'],
      ['08:30', '09:30'],
      ['09:00', '10:00'],
    ]);
  });

  it('Backward Pass - 4 legs with distinct values', () => {
    const wps = [mkWp(0, tOfDay(8)), mkWp(1, tOfDay(8)), mkWp(2, tOfDay(8)), mkWp(3, tOfDay(8)), mkWp(4, tOfDay(8))];
    expect(timeWindows(scanTripToUni(mkReq(tOfDay(10)), wps, [5, 10, 15, 20]))).toEqual([
      ['08:00', '09:10'],
      ['08:05', '09:15'],
      ['08:15', '09:25'],
      ['08:30', '09:40'],
      ['08:50', '10:00'],
    ]);
  });

  it('Backward Pass - zero-length legs: every waypoint shares the arrival time', () => {
    const wps = [mkWp(0, tOfDay(8)), mkWp(1, tOfDay(8)), mkWp(2, tOfDay(8))];
    expect(timeWindows(scanTripToUni(mkReq(tOfDay(9)), wps, [0, 0]))).toEqual([
      ['08:00', '09:00'],
      ['08:00', '09:00'],
      ['08:00', '09:00'],
    ]);
  });

  // Test forwards pass
  const runWithStart = (passEarliest: Date) =>
    scanTripToUni(mkReq(tOfDay(12)), [mkWp(0, tOfDay(8)), mkWp(1, passEarliest)], [10]);

  it.each([
    ['Forward Pass - passArr 1 min before driverArr: driverArr wins', tOfDay(8, 9), '08:10'],
    ['Forward Pass - passArr equals driverArr (no change)', tOfDay(8, 10), '08:10'],
    ['Forward Pass - passArr 1 min after driverArr: passArr wins', tOfDay(8, 11), '08:11'],
  ])('%s', (_name, passEarliest, expectedEarliest) => {
    expect(timeWindows(runWithStart(passEarliest))).toEqual([['08:00', '11:50'], [expectedEarliest, '12:00']]);
  });

  it('Forward Pass - a late passenger pickup in the middle delays every later waypoint', () => {
    const wps = [mkWp(0, tOfDay(8)), mkWp(1, tOfDay(8, 30)), mkWp(2, tOfDay(8)), mkWp(3, tOfDay(8))];
    expect(timeWindows(scanTripToUni(mkReq(tOfDay(10)), wps, [10, 10, 10]))).toEqual([
      ['08:00', '09:30'],
      ['08:30', '09:40'],
      ['08:40', '09:50'],
      ['08:50', '10:00'],
    ]);
  });

  // Test driver departure
  it('Driver Departure - earliest is unchanged but latest is tightened by the backward pass', () => {
    const result = scanTripToUni(mkReq(tOfDay(12)), [mkWp(0, tOfDay(8, 30)), mkWp(1, tOfDay(7))], [10]);
    expect(timeWindows(result)).toEqual([['08:30', '11:50'], ['08:40', '12:00']]);
  });

  // Test final feasability test
  it('Feasability - end 08:09 (1 min too early): null', () => {
    expect(runWithEnd(tOfDay(8, 9))).toBeNull();
  });
  it('Feasability - end 08:10 (exactly feasible): zero-length windows', () => {
    expect(timeWindows(runWithEnd(tOfDay(8, 10)))).toEqual([['08:00', '08:00'], ['08:10', '08:10']]);
  });
  it('Feasability - end 08:11 (1 min of slack)', () => {
    expect(timeWindows(runWithEnd(tOfDay(8, 11)))).toEqual([['08:00', '08:01'], ['08:10', '08:11']]);
  });

  const run3WithStart = (wp1Earliest: Date) =>
    scanTripToUni(mkReq(tOfDay(9)), [mkWp(0, tOfDay(8)), mkWp(1, wp1Earliest), mkWp(2, tOfDay(8))], [10, 10]);

  it.each([
    ['Feasability - intermediary earliest 1 min before its latest', tOfDay(8, 49), [['08:00', '08:40'], ['08:49', '08:50'], ['08:59', '09:00']]],
    ['Feasability - intermediary earliest equals its latest', tOfDay(8, 50), [['08:00', '08:40'], ['08:50', '08:50'], ['09:00', '09:00']]],
    ['Feasability - intermediary earliest 1 min after its latest', tOfDay(8, 51), null],
  ])('%s', (_name, wp1Earliest, expected) => {
    expect(timeWindows(run3WithStart(wp1Earliest))).toEqual(expected);
  });

  const wps4 = () => [mkWp(0, tOfDay(8)), mkWp(1, tOfDay(8)), mkWp(2, tOfDay(8)), mkWp(3, tOfDay(8))];

  it('Feasability - end 08:29 (1 min too short) - null', () => {
    expect(scanTripToUni(mkReq(tOfDay(8, 29)), wps4(), [10, 10, 10])).toBeNull();
  });
  it('Feasability - end 08:30 (exact fit)', () => {
    expect(timeWindows(scanTripToUni(mkReq(tOfDay(8, 30)), wps4(), [10, 10, 10]))).toEqual([
      ['08:00', '08:00'],
      ['08:10', '08:10'],
      ['08:20', '08:20'],
      ['08:30', '08:30'],
    ]);
  });
  it('Feasability - end 08:31 (1 min of slack)', () => {
    expect(timeWindows(scanTripToUni(mkReq(tOfDay(8, 31)), wps4(), [10, 10, 10]))).toEqual([
      ['08:00', '08:01'],
      ['08:10', '08:11'],
      ['08:20', '08:21'],
      ['08:30', '08:31'],
    ]);
  });
  it('infeasible input returns null rather than throwing', () => {
    expect(() => scanTripToUni(mkReq(tOfDay(8)), [mkWp(0, tOfDay(8)), mkWp(1, tOfDay(8))], [30])).not.toThrow();
  });

  // Test immutability
  const flattenWp = (ws: Waypoint[]) =>
    ws.map(w => [w.loc.lat, w.loc.lon, w.earliest.getTime(), w.latest.getTime()]);

  it('Immutability - does not mutate wps, legs or req', () => {
    const wps = [mkWp(0, tOfDay(8)), mkWp(1, tOfDay(8), tOfDay(9, 30)), mkWp(2, tOfDay(8), tOfDay(9, 30))];
    const legs = [10, 10];
    const r = mkReq(tOfDay(9));
    const wpsBefore = flattenWp(wps);
    const endBefore = r.window.end.getTime();

    wps.forEach(w => Object.freeze(w));
    Object.freeze(wps);
    Object.freeze(legs);

    expect(() => scanTripToUni(r, wps, legs)).not.toThrow();
    expect(flattenWp(wps)).toEqual(wpsBefore);
    expect(legs).toEqual([10, 10]);
    expect(r.window.end.getTime()).toBe(endBefore);
  });
  it('Immutability - returns a new array of new objects, in the original order, with locations preserved', () => {
    const wps = [mkWp(0, tOfDay(8)), mkWp(1, tOfDay(8)), mkWp(2, tOfDay(8))];
    const result = scanTripToUni(mkReq(tOfDay(12)), wps, [10, 10])!;

    expect(result).not.toBe(wps);
    expect(result).toHaveLength(3);
    result.forEach((w, i) => {
      expect(w).not.toBe(wps[i]);
      expect(w.loc).toEqual(wps[i].loc);
    });
  });
  it('Immutability - returns the same result when called twice with the same inputs', () => {
    const wps = [mkWp(0, tOfDay(8)), mkWp(1, tOfDay(8)), mkWp(2, tOfDay(8))];
    const first = timeWindows(scanTripToUni(mkReq(tOfDay(12)), wps, [10, 10]));
    const second = timeWindows(scanTripToUni(mkReq(tOfDay(12)), wps, [10, 10]));
    expect(second).toEqual(first);
  });
});

describe('scanTripFromUni testing', () => {
  // ------------------------- Helpers -------------------------
  // Fixed UTC dates so tests are timezone-independent. Minutes may overflow (hour(8, 60) = 9:00).
  const tOfDay = (h: number, m = 0) => new Date(Date.UTC(2030, 0, 1, h, m));
  const hm = (d: Date) => d.toISOString().slice(11, 16);

  // Default 'earliest' is deliberately loose so it never interferes with the computed value.
  const mkWp = (x: number, latest: Date, earliest: Date = tOfDay(1)): Waypoint => ({
    loc: { lat: x, lon: x },
    earliest,
    latest,
  });

  const mkReq = (start: Date): MatchRequest => ({
    reqId: -10,
    start: { lat: 0, lon: 0 },
    end: { lat: 0, lon: 0 },
    window: { start: start, end: tOfDay(21) },
    status: 'unassigned',
  });

  // Readable summary: [[earliest, latest], ...] as "HH:MM", or null
  const timeWindows = (ws: Waypoint[] | null) =>
    ws && ws.map(w => [hm(w.earliest), hm(w.latest)]);

  const r = mkReq(tOfDay(9));
  const stops = (n: number) => Array.from({ length: n }, (_, i) => mkWp(i, tOfDay(8)));
  const legsOf = (n: number, v = 10) => Array<number>(n).map((_, ind) => ind + v);

  // Test input validation
  it('Input validation - 1 waypoint throws', () => {
    expect(() => scanTripFromUni(r, stops(1), [])).toThrow(/less than 2 waypoints/);
  });
  it('Input validation - 2 waypoints (on boundary) is accepted', () => {
    expect(() => scanTripFromUni(r, stops(2), legsOf(1))).not.toThrow();
  });
  it('Input validation - 3 waypoints is accepted', () => {
    expect(() => scanTripFromUni(r, stops(3), legsOf(2))).not.toThrow();
  });

  it('Input validation - 1 leg too few throws', () => {
    expect(() => scanTripFromUni(r, stops(3), legsOf(1))).toThrow(/didn't match/);
  });
  it('Input validation - correct # legs is accepted', () => {
    expect(() => scanTripFromUni(r, stops(3), legsOf(2))).not.toThrow();
  });
  it('Input validation - 1 leg too many throws', () => {
    expect(() => scanTripFromUni(r, stops(3), legsOf(3))).toThrow(/didn't match/);
  });

  it('Input validation - leg = -1 (just below) throws', () => {
    expect(() => scanTripFromUni(r, stops(2), [-1, 10, 11])).toThrow(/negative travel time/);
  });
  it('Input validation - leg = 0 (on boundary) is accepted', () => {
    expect(() => scanTripFromUni(r, stops(2), [1, 0, 1])).not.toThrow();
  });
  it('Input validation - a negative leg is caught in the middle of the list', () => {
    expect(() => scanTripFromUni(r, stops(4), [0, -1, 10])).toThrow(/negative travel time/);
  });
  it('Input validation - a negative leg is caught at the end of the list', () => {
    expect(() => scanTripFromUni(r, stops(4), [0, 10, -1])).toThrow(/negative travel time/);
  });

  // Test departure time selection
  const runWithStart = (end: Date) =>
    scanTripFromUni(mkReq(end), [mkWp(0, tOfDay(9), tOfDay(8)), mkWp(1, tOfDay(9), tOfDay(8))], [10]);

  it.each([
    ['Depart Time - new request starts 1 min earlier (new passenger is stricter)', tOfDay(8, 1), [['08:01', '08:50'], ['08:11', '09:00']]],
    ['Depart Time - new request starts at the same time', tOfDay(8), [['08:00', '08:50'], ['08:10', '09:00']]],
    ['Depart Time - new request starts 1 min later (existing arrival unchanged)', tOfDay(7, 59), [['08:00', '08:50'], ['08:10', '09:00']]],
  ])('%s', (_name, end, expected) => {
    expect(timeWindows(runWithStart(end))).toEqual(expected);
  });

  // Test forward pass
  it('Forward Pass - 3 legs with distinct values', () => {
    const wps = [mkWp(0, tOfDay(17)), mkWp(1, tOfDay(17)), mkWp(2, tOfDay(17)), mkWp(3, tOfDay(17))];
    expect(timeWindows(scanTripFromUni(mkReq(tOfDay(15)), wps, [10, 20, 30]))).toEqual([
      ['15:00', '16:00'],
      ['15:10', '16:10'],
      ['15:30', '16:30'],
      ['16:00', '17:00'],
    ]);
  });

  it('Forward Pass - 4 legs with distinct values', () => {
    const wps = [mkWp(0, tOfDay(17)), mkWp(1, tOfDay(17)), mkWp(2, tOfDay(17)), mkWp(3, tOfDay(17)), mkWp(4, tOfDay(17))];
    expect(timeWindows(scanTripFromUni(mkReq(tOfDay(15)), wps, [5, 10, 15, 20]))).toEqual([
      ['15:00', '16:10'],
      ['15:05', '16:15'],
      ['15:15', '16:25'],
      ['15:30', '16:40'],
      ['15:50', '17:00'],
    ]);
  });

  it('Forward Pass - zero-length legs: every waypoint shares the arrival time', () => {
    const wps = [mkWp(0, tOfDay(17)), mkWp(1, tOfDay(17)), mkWp(2, tOfDay(17))];
    expect(timeWindows(scanTripFromUni(mkReq(tOfDay(16)), wps, [0, 0]))).toEqual([
      ['16:00', '17:00'],
      ['16:00', '17:00'],
      ['16:00', '17:00'],
    ]);
  });

  // Test backwards pass
  const runWithDepart = (passLatest: Date) =>
    scanTripFromUni(mkReq(tOfDay(16)), [mkWp(0, passLatest), mkWp(1, tOfDay(17))], [10]);

  it.each([
    ['Backwards Pass - passenger can depart 1 min after driver: driver wins', tOfDay(16, 51), '16:50'],
    ['Backwards Pass - passenger equals driver (no change)', tOfDay(16, 50), '16:50'],
    ['Backwards Pass - passenger must depart 1 min after driver: passenger wins', tOfDay(16, 49), '16:49'],
  ])('%s', (_name, passLatest, expLatest) => {
    expect(timeWindows(runWithDepart(passLatest))).toEqual([['16:00', expLatest], ['16:10', '17:00']]);
  });

  it('Backwards Pass - an early passenger dropoff in the middle brings forward every later waypoint', () => {
    const wps = [mkWp(0, tOfDay(18)), mkWp(1, tOfDay(17, 30)), mkWp(2, tOfDay(18)), mkWp(3, tOfDay(18))];
    expect(timeWindows(scanTripFromUni(mkReq(tOfDay(16)), wps, [10, 10, 10]))).toEqual([
      ['16:00', '17:20'],
      ['16:10', '17:30'],
      ['16:20', '17:50'],
      ['16:30', '18:00'],
    ]);
  });

  // Test driver arrival
  it('Driver Arrival - latest is unchanged but earliest is tightened by the forward pass', () => {
    const result = scanTripFromUni(mkReq(tOfDay(12)), [mkWp(0, tOfDay(15)), mkWp(1, tOfDay(16, 30))], [10]);
    expect(timeWindows(result)).toEqual([['12:00', '15:00'], ['12:10', '16:30']]);
  });

  // Test final feasability test
  it('Feasability - start 08:51 (1 min too late): null', () => {
    expect(runWithStart(tOfDay(8, 51))).toBeNull();
  });
  it('Feasability - start 08:50 (exactly feasible): zero-length windows', () => {
    expect(timeWindows(runWithStart(tOfDay(8, 50)))).toEqual([['08:50', '08:50'], ['09:00', '09:00']]);
  });
  it('Feasability - start 08:49 (1 min of slack)', () => {
    expect(timeWindows(runWithStart(tOfDay(8, 49)))).toEqual([['08:49', '08:50'], ['08:59', '09:00']]);
  });

  const run3WithLatest = (wp1Latest: Date) =>
    scanTripFromUni(mkReq(tOfDay(16)), [mkWp(0, tOfDay(17)), mkWp(1, wp1Latest), mkWp(2, tOfDay(17))], [10, 10]);

  it.each([
    ['Feasability - intermediary latest 1 min after its earliest', tOfDay(16, 11), [['16:00', '16:01'], ['16:10', '16:11'], ['16:20', '17:00']]],
    ['Feasability - intermediary latest equals its earliest', tOfDay(16, 10), [['16:00', '16:00'], ['16:10', '16:10'], ['16:20', '17:00']]],
    ['Feasability - intermediary latest 1 min before its earliest', tOfDay(16, 9), null],
  ])('%s', (_name, wp1Latest, expected) => {
    expect(timeWindows(run3WithLatest(wp1Latest))).toEqual(expected);
  });

  const wps4 = () => [mkWp(0, tOfDay(19)), mkWp(1, tOfDay(19)), mkWp(2, tOfDay(19)), mkWp(3, tOfDay(19))];

  it('Feasability - start 18:31 (1 min too short) - null', () => {
    expect(scanTripFromUni(mkReq(tOfDay(18, 31)), wps4(), [10, 10, 10])).toBeNull();
  });
  it('Feasability - start 18:30 (exact fit)', () => {
    expect(timeWindows(scanTripFromUni(mkReq(tOfDay(18, 30)), wps4(), [10, 10, 10]))).toEqual([
      ['18:30', '18:30'],
      ['18:40', '18:40'],
      ['18:50', '18:50'],
      ['19:00', '19:00'],
    ]);
  });
  it('Feasability - start 18:29 (1 min of slack)', () => {
    expect(timeWindows(scanTripFromUni(mkReq(tOfDay(18, 29)), wps4(), [10, 10, 10]))).toEqual([
      ['18:29', '18:30'],
      ['18:39', '18:40'],
      ['18:49', '18:50'],
      ['18:59', '19:00'],
    ]);
  });
  it('infeasible input returns null rather than throwing', () => {
    expect(() => scanTripFromUni(mkReq(tOfDay(18)), [mkWp(0, tOfDay(18)), mkWp(1, tOfDay(18))], [30])).not.toThrow();
  });

  // Test immutability
  const flattenWp = (ws: Waypoint[]) =>
    ws.map(w => [w.loc.lat, w.loc.lon, w.earliest.getTime(), w.latest.getTime()]);

  it('Immutability - does not mutate wps, legs or req', () => {
    const wps = [mkWp(0, tOfDay(8)), mkWp(1, tOfDay(8), tOfDay(9, 30)), mkWp(2, tOfDay(8), tOfDay(9, 30))];
    const legs = [10, 10];
    const r = mkReq(tOfDay(7));
    const wpsBefore = flattenWp(wps);
    const endBefore = r.window.end.getTime();

    wps.forEach(w => Object.freeze(w));
    Object.freeze(wps);
    Object.freeze(legs);

    expect(() => scanTripFromUni(r, wps, legs)).not.toThrow();
    expect(flattenWp(wps)).toEqual(wpsBefore);
    expect(legs).toEqual([10, 10]);
    expect(r.window.end.getTime()).toBe(endBefore);
  });
  it('Immutability - returns a new array of new objects, in the original order, with locations preserved', () => {
    const wps = [mkWp(0, tOfDay(8)), mkWp(1, tOfDay(8)), mkWp(2, tOfDay(8))];
    const result = scanTripFromUni(mkReq(tOfDay(6)), wps, [10, 10])!;

    expect(result).not.toBe(wps);
    expect(result).toHaveLength(3);
    result.forEach((w, i) => {
      expect(w).not.toBe(wps[i]);
      expect(w.loc).toEqual(wps[i].loc);
    });
  });
  it('Immutability - returns the same result when called twice with the same inputs', () => {
    const wps = [mkWp(0, tOfDay(8)), mkWp(1, tOfDay(8)), mkWp(2, tOfDay(8))];
    const first = timeWindows(scanTripFromUni(mkReq(tOfDay(6)), wps, [10, 10]));
    const second = timeWindows(scanTripFromUni(mkReq(tOfDay(6)), wps, [10, 10]));
    expect(second).toEqual(first);
  });
});

describe('addPassengner testing', () => {
  // --------------------- Mocks ---------------------
  jest.mock('../../mobile/services/googleRoutes', () => require('../../__mocks__/googleRouteAPI').routesModule);
  jest.mock('../../mobile/services/googleRoutes', () => require('../../__mocks__/googleRouteAPI').configModule);
  jest.mock('../../mobile/utility/distances', () => ({ ...jest.requireActual('../../mobile/utility/distances'), calcDist: jest.fn() }));
  jest.mock('../../backend/server/matching', () => ({ ...jest.requireActual('../../backend/server/matching'), isBookingToUni: jest.fn() }));
  jest.mock('../../backend/server/tripAdditions', () => ({ scanTripToUni: jest.fn(), scanTripFromUni: jest.fn() }));

  const mockCalcDist = jest.mocked(calcDist);
  const mockIsToUni = jest.mocked(isBookingToUni);
  const mockScanTo = jest.mocked(scanTripToUni);
  const mockScanFrom = jest.mocked(scanTripFromUni);
  const mockComputeRoute = jest.mocked(computeRoute);

  // Set up
  const toDate = (h: number, m = 0) => new Date(Date.UTC(2030, 0, 1, h, m));
  const hm = (d: Date) => d.toISOString().slice(11, 16);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const SCAN_MARK = toDate(1, 23);   // the default scan mock stamps this onto every `latest`
  const PAX_START = toDate(8, 15);   // unique value, so the new stop can be found by its `earliest`
  const UNI: Coord = { lat: 1000, lon: 1000 };

  const c = (lat: number, lon = 0): Coord => ({ lat, lon });
  const wp = (lat: number, earliest = toDate(8), latest = toDate(23)): Waypoint => ({ loc: c(lat), earliest, latest });
  // waypoints on a line, each with a distinct `earliest` (08:00, 08:02, ...)
  const line = (lats: number[]) => lats.map((lat, i) => wp(lat, toDate(8, 2 * i)));

  const makeTrip = (
    wps: Waypoint[],
    legs: number[] = wps.slice(1).map(() => 10),
    legDists: number[] = legs.map(() => 1000),
  ): Trip => ({ waypoints: wps, legs, legDists, currDur: sum(legs), currDist: sum(legDists) });

  const makeReq = (start: Coord, end: Coord, window = { start: PAX_START, end: toDate(12) }): MatchRequest => ({
    reqId: 7, start, end, window, status: 'unassigned',
  });
  const toUniReq = (pickupLat: number, window?: { start: Date; end: Date; }) => makeReq(c(pickupLat), UNI, window);
  const fromUniReq = (dropLat: number, window?: { start: Date; end: Date; }) => makeReq(UNI, c(dropLat), window);

  const stopIdx = (t: Trip | null) => t!.waypoints.findIndex(w => w.earliest.getTime() === PAX_START.getTime());
  const windows = (ws: Waypoint[] | null) => ws && ws.map(w => [hm(w.earliest), hm(w.latest)]);

  function deepFreeze<T>(o: T): T {
    Object.values(o as object).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); });
    return Object.freeze(o);
  }

  beforeEach(() => {
    jest.resetAllMocks();
    resetGoogleApiMock();
    mockCalcDist.mockImplementation((a: Coord, b: Coord) => Math.hypot(a.lat - b.lat, a.lon - b.lon));
    mockIsToUni.mockReturnValue(true);
    const stamp = (_r: MatchRequest, wps: Waypoint[]) => wps.map(w => ({ ...w, latest: SCAN_MARK }));
    mockScanTo.mockImplementation(stamp);
    mockScanFrom.mockImplementation(stamp);
  });

  // Find unique endpoint regardless of booking direction

  // start = lat 25 (nearest gap 2), end = lat 15 (nearest gap 1)
  const req = () => makeReq(c(25), c(15));

  it('Unique endpoint - to-uni', async () => {
    mockIsToUni.mockReturnValue(true);
    const t = await addPassenger(makeTrip(line([0, 10, 20, 30])), req());
    expect(stopIdx(t)).toBe(3);
    expect(t!.waypoints[3].loc).toEqual(c(25));
  });

  it('Unique endpoint - from-uni', async () => {
    mockIsToUni.mockReturnValue(false);
    const t = await addPassenger(makeTrip(line([0, 10, 20, 30])), req());
    expect(stopIdx(t)).toBe(2);
    expect(t!.waypoints[2].loc).toEqual(c(15));
  });

  // Choosing the best gap

  it.each([
    ['gap 0: first gap (on lower boundary)', 5, 0],
    ['gap 1: just above lower / just below upper boundary', 15, 1],
    ['gap 2: last gap (on upper boundary, n-2)', 25, 2],
    ['pickup before the driver start: still gap 0', -50, 0],
    ['pickup beyond the uni: still gap 2, uni stays last', 100, 2],
  ])('%s', async (_name, pickupLat, gap) => {
    const curr = makeTrip(line([0, 10, 20, 30]));
    const t = await addPassenger(curr, toUniReq(pickupLat));

    expect(t).not.toBeNull();
    expect(t!.waypoints).toHaveLength(5);
    expect(stopIdx(t)).toBe(gap + 1);
    expect(t!.waypoints[0].loc).toEqual(curr.waypoints[0].loc);   // first waypoint unchanged
    expect(t!.waypoints[4].loc).toEqual(curr.waypoints[3].loc);   // last waypoint unchanged
  });

  // lat 9: gap0 = 9+1 = 10, gap1 = 1+11 = 12 | lat 10: 10 vs 10 (tie) | lat 11: 12 vs 10
  it.each([
    ['gap 0 better by a margin (just below the tie)', 9, 1],
    ['exact tie: the earliest gap wins', 10, 1],
    ['gap 1 better by a margin (just above the tie)', 11, 2],
  ])('%s', async (_name, pickupLat, expectedStopIdx) => {
    const t = await addPassenger(makeTrip(line([0, 10, 20])), toUniReq(pickupLat));
    expect(stopIdx(t)).toBe(expectedStopIdx);
  });

  // D1 (design question): expects "least added distance", i.e. subtract the existing leg.
  it('prefers the smallest ADDED distance, not the smallest sum of distances', async () => {
    // A(0,0) B(10,0) C(100,0), passenger at (5,30).
    // sum metric:   gap0 = 60.8, gap1 = 130.0 -> picks gap 0
    // true detour:  gap0 = 60.8-10 = 50.8, gap1 = 130.0-90 = 40.0 -> should pick gap 1
    const wps = [wp(0), wp(10), wp(100)];
    const t = await addPassenger(makeTrip(wps), makeReq(c(5, 30), UNI));
    expect(stopIdx(t)).toBe(2);
  });

  // Validate trip sizes before and after insertion

  it('1 waypoint (just below minimum) rejects', async () => {
    await expect(addPassenger(makeTrip(line([0])), toUniReq(5))).rejects.toThrow();
  });
  it('2 waypoints (on minimum): the new stop goes between driver and uni', async () => {
    const t = await addPassenger(makeTrip(line([0, 20]), [10], [1000]), toUniReq(10)); // FAILS now (B1)
    expect(stopIdx(t)).toBe(1);
    expect(t!.legs).toEqual([10, 15]);
    expect(t!.currDur).toBe(25);
  });
  it('3 waypoints (just above minimum) is accepted', async () => {
    const t = await addPassenger(makeTrip(line([0, 10, 20])), toUniReq(15));
    expect(t).not.toBeNull();
    expect(t!.waypoints).toHaveLength(4);
  });

  // Test new waypoint's time window

  it('earliest/latest come from the passenger window, passed to the scan', async () => {
    const p = toUniReq(15, { start: at(8, 15), end: at(11, 45) });
    await addPassenger(makeTrip(line([0, 10, 20, 30])), p);

    const stop = mockScanTo.mock.calls[0][1][3];
    expect(stop).toEqual({ loc: c(15), earliest: at(8, 15), latest: at(11, 45) });
  });

  // ensure API call is only made once

  it('not configured: rejects and never calls the API', async () => {
    mockConfig.isPlacesConfigured = false;
    await expect(addPassenger(makeTrip(line([0, 10, 20, 30])), toUniReq(15))).rejects.toThrow(/API key/);
    expect(mockComputeRoute).not.toHaveBeenCalled();
  });
  it('configured: calls the API exactly once', async () => {
    await addPassenger(makeTrip(line([0, 10, 20, 30])), toUniReq(15));
    expect(mockComputeRoute).toHaveBeenCalledTimes(1);
  });

  // successful new route generation

  it.each([
    ['gap 0 (first)', 0, 5],
    ['gap 1 (middle)', 1, 15],
    ['gap 2 (last)', 2, 25],
  ])('%s: route runs from the previous stop, via the new stop, to the next stop', async (_name, gap, pickupLat) => {
    const curr = makeTrip(line([0, 10, 20, 30]));
    await addPassenger(curr, toUniReq(pickupLat));

    expect(mockComputeRoute).toHaveBeenCalledWith({
      origin: curr.waypoints[gap].loc,
      dest: curr.waypoints[gap + 1].loc,
      inters: [c(pickupLat)],
      depTime: curr.waypoints[gap].earliest,
      apiKey: 'test-api-key',
      fieldMask: 'routes.legs.duration,routes.legs.distanceMeters',
    });
  });

  // application of API results

  const base = () => makeTrip(line([0, 10, 20, 30]), [10, 20, 30], [1000, 2000, 3000]);

  it('replaces the old leg with two new legs, in the right order and position', async () => {
    mockComputeRoute.mockResolvedValue(routesResponse(leg(600, 1500), leg(900, 2500)));
    const t = await addPassenger(base(), toUniReq(15));

    expect(t!.legs).toEqual([10, 10, 15, 30]);
    expect(t!.legDists).toEqual([1000, 1500, 2500, 3000]);
    expect(t!.currDur).toBe(60 - 20 + 10 + 15);
    expect(t!.currDist).toBe(6000 - 2000 + 1500 + 2500);
  });

  it('keeps totals and array lengths consistent', async () => {
    const t = (await addPassenger(base(), toUniReq(15)))!;
    expect(t.currDur).toBe(sum(t.legs));
    expect(t.currDist).toBe(sum(t.legDists));
    expect(t.legs).toHaveLength(t.waypoints.length - 1);
    expect(t.legDists).toHaveLength(t.legs.length);
  });

  describe('duration string -> minutes (first leg)', () => {
    it.each([
      ['0s', 0],
      ['60s', 1],
      ['120s', 2],
    ])('"%s" becomes %d min', async (seconds, minutes) => {
      mockComputeRoute.mockResolvedValue({ routes: [{ legs: [{ duration: seconds, distanceMeters: 1000 }, leg(900, 2500)] }] });
      const t = await addPassenger(base(), toUniReq(15));
      expect(t!.legs[1]).toBe(minutes);
      expect(t!.currDur).toBe(60 - 20 + minutes + 15);
    });
  });

  it('legs are whole minutes (905s -> 16)', async () => {
    mockComputeRoute.mockResolvedValue(routesResponse(leg(905, 1500), leg(900, 2500)));
    const t = await addPassenger(base(), toUniReq(15));
    expect(Number.isInteger(t!.legs[1])).toBe(true);
    expect(t!.legs[1]).toBe(16);
  });

  describe('API failures', () => {
    it('rejects when computeRoute rejects', async () => {
      mockComputeRoute.mockRejectedValue(new Error('network down'));
      await expect(addPassenger(base(), toUniReq(15))).rejects.toThrow('network down');
    });
    it('rejects when no routes are returned', async () => {
      mockComputeRoute.mockResolvedValue(emptyRoutesResponse());
      await expect(addPassenger(base(), toUniReq(15))).rejects.toThrow();
    });
    it('rejects when only one leg is returned', async () => {
      mockComputeRoute.mockResolvedValue(routesResponse(leg(600, 1500)));
      await expect(addPassenger(base(), toUniReq(15))).rejects.toThrow();
    });
  });

  // scan and return results

  const base = () => makeTrip(line([0, 10, 20, 30]), [10, 20, 30], [1000, 2000, 3000]);

  it('to-uni: calls scanTripToUni once with (request, waypoints incl. new stop, new legs)', async () => {
    const curr = base();
    const p = toUniReq(15);
    await addPassenger(curr, p);

    expect(mockScanFrom).not.toHaveBeenCalled();
    expect(mockScanTo).toHaveBeenCalledTimes(1);
    const [reqArg, wpsArg, legsArg] = mockScanTo.mock.calls[0];
    expect(reqArg).toBe(p);
    expect(wpsArg).toEqual([
      curr.waypoints[0], curr.waypoints[1],
      { loc: c(15), earliest: p.window.start, latest: p.window.end },
      curr.waypoints[2], curr.waypoints[3],
    ]);
    expect(legsArg).toEqual([10, 10, 15, 30]);
  });

  it('from-uni: calls scanTripFromUni once, and not scanTripToUni', async () => {
    mockIsToUni.mockReturnValue(false);
    const p = fromUniReq(15);
    await addPassenger(base(), p);

    expect(mockScanTo).not.toHaveBeenCalled();
    expect(mockScanFrom).toHaveBeenCalledTimes(1);
    expect(mockScanFrom.mock.calls[0][0]).toBe(p);
    expect(mockScanFrom.mock.calls[0][2]).toEqual([10, 10, 15, 30]);
  });

  it.each([
    ['to-uni', true, () => mockScanTo],
    ['from-uni', false, () => mockScanFrom],
  ])('%s: returns null when the scan says the passenger is infeasible', async (_name, toUni, scan) => {
    mockIsToUni.mockReturnValue(toUni);
    scan().mockReturnValue(null);
    const p = toUni ? toUniReq(15) : fromUniReq(15);
    await expect(addPassenger(base(), p)).resolves.toBeNull();
  });

  it('returns the SCANNED waypoints, not the unscanned ones', async () => { // FAILS now (B3)
    const t = await addPassenger(base(), toUniReq(15));
    expect(t!.waypoints).toHaveLength(5);
    t!.waypoints.forEach(w => expect(w.latest).toEqual(SCAN_MARK));
  });

  // check for immutability

  it('does not mutate the current trip or request (frozen inputs would throw)', async () => {
    const curr = deepFreeze(makeTrip(line([0, 10, 20, 30]), [10, 20, 30], [1000, 2000, 3000]));
    const p = deepFreeze(toUniReq(15));

    const t = await addPassenger(curr, p);

    expect(t).not.toBeNull();
    expect(t!.waypoints).not.toBe(curr.waypoints);
    expect(t!.legs).not.toBe(curr.legs);
    expect(t!.legDists).not.toBe(curr.legDists);
    expect(curr.legs).toEqual([10, 20, 30]);
    expect(curr.currDur).toBe(60);
  });
});

// works with real scanTripToUni - move to integration testing folder later

describe('addPassenger integration with real scanTripToUni', () => {
  beforeEach(() => {
    const real = jest.requireActual('../src/scan');
    mockScanTo.mockImplementation(real.scanTripToUni);
    mockScanFrom.mockImplementation(real.scanTripFromUni);
    mockComputeRoute.mockResolvedValue(routesResponse(leg(600, 1500), leg(300, 800)));
  });

  const trip = () => makeTrip([wp(0, at(8)), wp(10, at(8)), wp(20, at(8), at(9, 30))], [10, 10], [1000, 1000]);
  const run = (end: Date) => addPassenger(trip(), toUniReq(15, { start: at(8, 30), end }));

  it('passenger end 09:00 (stricter than the uni 09:30): windows are tightened', async () => {
    const t = await run(at(9));
    expect(windows(t!.waypoints)).toEqual([
      ['08:00', '08:35'],
      ['08:10', '08:45'],
      ['08:30', '08:55'],
      ['08:35', '09:00'],
    ]);
    expect(t!.legs).toEqual([10, 10, 5]);
  });

  describe('feasibility boundary: passenger must arrive at the uni by 08:35 at the earliest', () => {
    it('end 08:34 (1 min too early): null', async () => {
      await expect(run(at(8, 34))).resolves.toBeNull();
    });
    it('end 08:35 (exact fit): zero-slack windows', async () => {
      expect(windows((await run(at(8, 35)))!.waypoints)).toEqual([
        ['08:00', '08:10'],
        ['08:10', '08:20'],
        ['08:30', '08:30'],
        ['08:35', '08:35'],
      ]);
    });
    it('end 08:36 (1 min of slack)', async () => {
      expect(windows((await run(at(8, 36)))!.waypoints)).toEqual([
        ['08:00', '08:11'],
        ['08:10', '08:21'],
        ['08:30', '08:31'],
        ['08:35', '08:36'],
      ]);
    });
  });
});

// works with real scanTripFromUni - move to integrations tests folder later

describe('integration with real scanTripFromUni', () => {
  beforeEach(() => {
    const real = jest.requireActual('../src/scan');
    mockIsToUni.mockReturnValue(false);
    mockScanTo.mockImplementation(real.scanTripToUni);
    mockScanFrom.mockImplementation(real.scanTripFromUni);
    mockComputeRoute.mockResolvedValue(routesResponse(leg(600, 1500), leg(300, 800)));
  });

  const trip = () => makeTrip([wp(0, at(8)), wp(10, at(8)), wp(20, at(8), at(9, 30))], [10, 10], [1000, 1000]);
  const run = (start: Date) => addPassenger(trip(), fromUniReq(15, { start, end: at(9) }));

  it('uses the from-uni scan, not the to-uni scan', async () => {
    await run(at(8, 30));
    expect(mockScanFrom).toHaveBeenCalledTimes(1);
    expect(mockScanTo).not.toHaveBeenCalled();
  });

  it('passenger departure 08:30 (later than the driver\'s 08:00): windows are tightened', async () => {
    const t = await run(at(8, 30));
    expect(windows(t!.waypoints)).toEqual([
      ['08:30', '08:40'],
      ['08:40', '08:50'],
      ['08:50', '09:00'],
      ['08:55', '09:30'],
    ]);
    expect(t!.legs).toEqual([10, 10, 5]);
  });

  describe('feasibility boundary: the shared uni departure must be no later than 08:40', () => {
    it('start 08:41 (1 min too late): null', async () => {
      await expect(run(at(8, 41))).resolves.toBeNull();
    });
    it('start 08:40 (exact fit): zero-slack windows', async () => {
      expect(windows((await run(at(8, 40)))!.waypoints)).toEqual([
        ['08:40', '08:40'],
        ['08:50', '08:50'],
        ['09:00', '09:00'],
        ['09:05', '09:30'],
      ]);
    });
    it('start 08:39 (1 min of slack)', async () => {
      expect(windows((await run(at(8, 39)))!.waypoints)).toEqual([
        ['08:39', '08:40'],
        ['08:49', '08:50'],
        ['08:59', '09:00'],
        ['09:04', '09:30'],
      ]);
    });
  });
});