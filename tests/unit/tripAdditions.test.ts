import type { MatchOffer, MatchRequest, Waypoint, Trip } from "../../backend/server/matching.schema";
import { MONASH_CLAYTON_LOCATION } from "../../mobile/services/googlePlaces";
import { scanTripToUni, scanTripFromUni, addPassenger } from "../../backend/server/tripAdditions";

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

