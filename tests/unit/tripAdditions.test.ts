import type { MatchRequest, Waypoint, Trip, Coord } from "../../backend/server/matching.schema";
import { scanTripToUni, scanTripFromUni, calcDetours, findBestInd, updateLegDists, updateLegDurs } from "../../backend/server/tripAdditions";

// helper functions
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// Fixed UTC dates so tests are timezone-independent. Minutes may overflow (hour(8, 60) = 9:00).
const tOfDay = (h: number, m = 0) => new Date(Date.UTC(2030, 0, 1, h, m));
const hm = (d: Date) => d.toISOString().slice(11, 16);

// testing definition of uni
const UNI: Coord = { lat: 1000, lon: 1000 };

// simplify distances to be 1 dimensional by default
const newPoint = (lat: number, lon: number = UNI.lon) => ({ lat, lon });
const mkCoord = (lat: number, lon = 0): Coord => ({ lat, lon });

// make data structures
const mkWp = (lat: number, earliest = tOfDay(8), latest = tOfDay(23)): Waypoint => ({ loc: mkCoord(lat), earliest, latest });
const newWp = (lat: number, lon: number = UNI.lon) => ({
  loc: newPoint(lat, lon),
  earliest: tOfDay(9),
  latest: tOfDay(17),
});
const mkLine = (lats: number[]) => lats.map((lat, i) => mkWp(lat, tOfDay(8, 2 * i)));
const mkTrip = (
  wps: Waypoint[],
  legs: number[] = wps.slice(1).map((_, i) => 10 + i),
  legDists: number[] = legs.map((_, i) => 1000 + i * 10),
): Trip => ({
  waypoints: wps,
  legs,
  legDists,
  currDur: sum(legs),
  currDist: sum(legDists)
});
const mkReq = (start: Coord, end: Coord, window = { start: tOfDay(8, 15), end: tOfDay(12) }): MatchRequest => ({
  reqId: -7, start, end, window, status: 'unassigned',
});
const toUniReq = (pickupLat: number, window?: { start: Date; end: Date; }) => mkReq(mkCoord(pickupLat), UNI, window);
const fromUniReq = (dropLat: number, window?: { start: Date; end: Date; }) => mkReq(UNI, mkCoord(dropLat), window);

type ApiLeg = { duration: string; distanceMeters: number; };
const apiLeg = (seconds: number, meters: number): ApiLeg => ({ duration: `${seconds}s`, distanceMeters: meters });
// API response builder
const buildRouteResponse = (...legs: ApiLeg[]) => ({ routes: [{ legs }] });
const emptyRouteResponse = () => ({ routes: [] as { legs: ApiLeg[]; }[] });
// calcDist replacement
const euclid = (a: Coord, b: Coord) => Math.hypot(a.lat - b.lat, a.lon - b.lon);
// extract boundary times from waypoints
const windows = (ws: Waypoint[] | null) => ws && ws.map(w => [hm(w.earliest), hm(w.latest)]);

describe('scanTripToUni() testing', () => {
  // ------------------------- Helpers -------------------------
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
    expect(() => scanTripToUni(r, stops(4), [-1, 10, 11])).toThrow(/negative travel time/);
  });
  it('Input validation - leg = 0 (on boundary) is accepted', () => {
    expect(() => scanTripToUni(r, stops(4), [1, 0, 1])).not.toThrow();
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
  it('Feasability - infeasible input returns null rather than throwing', () => {
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

describe('scanTripFromUni() testing', () => {
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
    expect(() => scanTripFromUni(r, stops(4), [-1, 10, 11])).toThrow(/negative travel time/);
  });
  it('Input validation - leg = 0 (on boundary) is accepted', () => {
    expect(() => scanTripFromUni(r, stops(4), [1, 0, 1])).not.toThrow();
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

describe('calcDetours() testing', () => {
  const currPoints = [
    { loc: { lat: 700, lon: UNI.lon }, earliest: tOfDay(9), latest: tOfDay(17) },
    { loc: { lat: 850, lon: UNI.lon }, earliest: tOfDay(9), latest: tOfDay(17) },
    { loc: { lat: 900, lon: UNI.lon }, earliest: tOfDay(9), latest: tOfDay(17) },
    { loc: { lat: UNI.lat, lon: UNI.lon }, earliest: tOfDay(9), latest: tOfDay(17) },
  ];

  test('less than start', () => {
    const exp = [200, 500, 600];
    const act = calcDetours(currPoints, newPoint(600));
    expect(act).toEqual(exp);
  });
  test('more than end', () => {
    const exp = [400, 300, 100];
    const act = calcDetours(currPoints, newPoint(1050));
    expect(act).toEqual(exp);
  });
  test('in the middle', () => {
    const exp = [0, 200, 300];
    const act = calcDetours(currPoints, newPoint(750));
    expect(act).toEqual(exp);
  });
});

describe('findBestInd() testing', () => {
  const currPoints = [
    newWp(700),
    newWp(800),
    newWp(900),
    newWp(UNI.lat),
  ];

  test('cannot insert before start', () => {
    const exp = 1;
    const act = findBestInd(newWp(600), currPoints);
    expect(act).toBe(exp);
  });
  test('same as start still after start', () => {
    const exp = 1;
    const act = findBestInd(newWp(currPoints[0].loc.lat), currPoints);
    expect(act).toBe(exp);
  });
  test('can insert after start', () => {
    const exp = 1;
    const act = findBestInd(newWp(799), currPoints);
    expect(act).toBe(exp);
  });
  test('can insert in middle', () => {
    const exp = 2;
    const act = findBestInd(newWp(801), currPoints);
    expect(act).toBe(exp);
  });
  test('can insert before end', () => {
    const exp = 3;
    const act = findBestInd(newWp(999), currPoints);
    expect(act).toBe(exp);
  });
  test('cannot insert after end', () => {
    const exp = 3;
    const act = findBestInd(newWp(10000), currPoints);
    expect(act).toBe(exp);
  });
  test('same as end still before end', () => {
    const exp = 3;
    const act = findBestInd(newWp(currPoints.at(-1)!.loc.lat), currPoints);
    expect(act).toBe(exp);
  });
  test('same as existing (doesn\'t matter)', () => {
    const exp1 = 2;
    const exp2 = 3;
    const act = findBestInd(newWp(currPoints[2].loc.lat), currPoints);
    if (act === exp1) expect(act).toBe(exp1);
    else expect(act).toBe(exp2);
  });
});

describe('Updating legs testing', () => {
  // updateLegDists(currTrip: Trip, newLegs: { distanceMeters: number, duration: string; }[], ind: number);
  const currPoints = [
    newWp(700),
    newWp(800),
    newWp(900),
    newWp(UNI.lat),
  ];
  const t = mkTrip(currPoints, [7, 8, 4], [3100, 4900, 2001]);
  const mkLeg = (km: number, min: number) => ({ distanceMeters: km * 1000, duration: String(min * 60) + 's' });

  test('add after start', () => {
    const newLegs = [mkLeg(1.5, 3.25), mkLeg(1.8, 4.5)];

    const expLegsD = [1500, 1800, 4900, 2001];
    const expDist = sum(expLegsD); // 10 201 m
    const expLegsT = [4, 5, 8, 4];
    const expTime = sum(expLegsT); // 21 min

    const actD = updateLegDists(t, newLegs, 0);
    const actT = updateLegDurs(t, newLegs, 0);

    expect(actD.currDist).toBe(expDist);
    expect(actD.legDists).toEqual(expLegsD);
    expect(actT.currDur).toBe(expTime);
    expect(actT.legs).toEqual(expLegsT);
  });
  test('add in middle', () => {
    const newLegs = [mkLeg(4.4, 10), mkLeg(7.01, 12)];

    const expLegsD = [3100, 4400, 7010, 2001];
    const expDist = sum(expLegsD); // 16 511 m
    const expLegsT = [7, 10, 12, 4];
    const expTime = sum(expLegsT); // 33 min

    const actD = updateLegDists(t, newLegs, 1);
    const actT = updateLegDurs(t, newLegs, 1);

    expect(actD.currDist).toBe(expDist);
    expect(actD.legDists).toEqual(expLegsD);
    expect(actT.currDur).toBe(expTime);
    expect(actT.legs).toEqual(expLegsT);
  });
  test('add before end', () => {
    const newLegs = [mkLeg(0.09, 1), mkLeg(1.999, 5)];
    const expLegsD = [3100, 4900, 90, 1999];
    const expDist = sum(expLegsD); // 10 089 m
    const expLegsT = [7, 8, 1, 5];
    const expTime = sum(expLegsT); // 21 min

    const actD = updateLegDists(t, newLegs, 2);
    const actT = updateLegDurs(t, newLegs, 2);

    expect(actD.currDist).toBe(expDist);
    expect(actD.legDists).toEqual(expLegsD);
    expect(actT.currDur).toBe(expTime);
    expect(actT.legs).toEqual(expLegsT);
  });
});

// set-up mocks for addPassenger calls
function loadAddPassenger() {
  const mocks = { isToUni: jest.fn(), apiConfig: jest.fn(), computeRoute: jest.fn(), calcDist: jest.fn() };
  let addPassenger!: (curr: Trip, p: MatchRequest) => Promise<Trip | null>;

  jest.isolateModules(() => {
    jest.doMock('../../backend/server/matching', () => {
      const originalModule = jest.requireActual('../../backend/server/matching');
      return {
        ...originalModule,
        __esModule: true,
        isBookingToUni: mocks.isToUni,
      };
    });
    jest.doMock('../../mobile/services/googlePlaces', () => {
      const originalModule = jest.requireActual('../../mobile/services/googlePlaces');
      return {
        ...originalModule,
        GOOGLE_MAPS_API_KEY: 'test-api-key',
        isPlacesConfigured: mocks.apiConfig,
      };
    });
    jest.doMock('../../mobile/services/googleRoutes', () => {
      const originalModule = jest.requireActual('../../mobile/services/googleRoutes');
      return {
        ...originalModule,
        computeRoute: mocks.computeRoute,
      };
    });
    jest.doMock('../../mobile/utility/distances', () => {
      const originalModule = jest.requireActual('../../mobile/utility/distances');
      return {
        ...originalModule,
        __esModule: true,
        calcDist: mocks.calcDist,
      };
    });
    addPassenger = require('../../backend/server/tripAdditions').addPassenger;
  });

  return { addPassenger, ...mocks };
}

function deepFreeze<T>(o: T): T {
  Object.values(o as object).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(o);
}

describe('addPassenger testing', () => {
  jest.resetModules();
  const {
    addPassenger,
    isToUni: mockIsToUni,
    apiConfig: mockAPIConfig,
    computeRoute: mockComputeRoute,
    calcDist: mockCalcDist,
  } = loadAddPassenger();

  const fakeCompRoute = {
    routes: [{
      duration: '1055s',
      distanceMeters: 5217,
      legs: [
        { 'duration': '455s', 'distanceMeters': 2007 },
        { 'duration': '600s', 'distanceMeters': 3210 },
      ],
      optimizedIntermediateWaypointIndex: [0],
    }]
  };

  // start lat 875 = nearest gap 2
  const reqTo = () => mkReq(mkCoord(875), UNI);
  // end lat 725 = nearest gap 3
  const reqFrom = () => mkReq(UNI, mkCoord(725));
  // default trip
  const defPoints = [300, 150, 100, 0].map(l => UNI.lat - l);
  const defTrip = (to: boolean) => mkTrip(mkLine((to) ? defPoints : [...defPoints].reverse()));

  beforeEach(() => {
    jest.resetAllMocks();
    // default values
    mockAPIConfig.mockReturnValue(true);
    mockIsToUni.mockReturnValue(true);
    mockComputeRoute.mockReturnValue(fakeCompRoute);
    mockCalcDist.mockImplementation(euclid);
  });

  jest.doMock('../../backend/server/matching', () => {
    // Require the original module to not be mocked...
    const originalModule =
      jest.requireActual<typeof import('../../backend/server/matching')>('../../backend/server/matching');

    return {
      __esModule: true, // Use it when dealing with esModules
      ...originalModule,
      isBookingToUni: mockIsToUni,
    };
  });
  jest.doMock('../../mobile/services/googlePlaces', () => {
    const originalModule = jest.requireActual('../../mobile/services/googlePlaces');
    return {
      ...originalModule,
      GOOGLE_MAPS_API_KEY: 'test-api-key',
      isPlacesConfigured: mockAPIConfig,
    };
  });
  jest.doMock('../../mobile/services/googleRoutes', () => {
    const originalModule = jest.requireActual('../../mobile/services/googleRoutes');
    return {
      ...originalModule,
      computeRoute: mockComputeRoute,
    };
  });

  it('Unique endpoint - to-uni', async () => {
    mockAPIConfig.mockReturnValue(true);
    mockIsToUni.mockReturnValue(true);
    mockComputeRoute.mockReturnValue(fakeCompRoute);

    const t = await addPassenger(defTrip(true), reqTo());
    expect(t).not.toEqual(null);
    expect(t!.waypoints[2].loc).toEqual(mkCoord(875));
  });

  it('Unique endpoint - from-uni', async () => {
    mockAPIConfig.mockReturnValue(true);
    mockIsToUni.mockReturnValue(false);
    mockComputeRoute.mockReturnValue(fakeCompRoute);
    const t = await addPassenger(defTrip(false), reqFrom());
    expect(t).not.toEqual(null);
    expect(t!.waypoints[3].loc).toEqual(mkCoord(725));
  });

  // Choosing the best gap
  it.each([
    ['gap 0: first gap (on lower boundary)', 700, 1],
    ['gap 1: just above lower / just below upper boundary', 899, 2],
    ['gap 2: last gap (on upper boundary)', 1000, 3],
    ['pickup before the driver start: still first gap', -50, 1],
    ['pickup beyond the uni: still last gap, uni stays last', 2000, 3],
  ])('%s', async (_name, pickupLat, expInd) => {
    mockAPIConfig.mockReturnValue(true);
    mockIsToUni.mockReturnValue(true);
    mockComputeRoute.mockReturnValue(fakeCompRoute);

    const curr = defTrip(true);
    const t = await addPassenger(curr, toUniReq(pickupLat));

    expect(t).not.toBeNull();

    const newWps = t!.waypoints;
    expect(newWps).toHaveLength(5);
    expect(newWps[expInd].loc).toEqual(mkCoord(pickupLat, 0));
    expect(newWps[0].loc).toEqual(curr.waypoints[0].loc);   // first waypoint unchanged
    expect(newWps[4].loc).toEqual(curr.waypoints[3].loc);   // last waypoint unchanged
  });

  it('inserts at the least ADDED distance, not the least summed distance', async () => {
    // A = UNI-100, B = UNI-90, C = UNI, passenger P = (UNI-95, lon 30)
    // summed:  gap A-B = 60.8,  gap B-C = 130.0  -> would pick A-B (bestInd 1)
    // added:   gap A-B = 50.8,  gap B-C =  40.0  -> picks B-C     (bestInd 2)
    const curr = mkTrip(mkLine([100, 90, 0].map(l => UNI.lat - l)));
    const t = await addPassenger(curr, mkReq(mkCoord(UNI.lat - 95, 30), UNI));

    expect(t).not.toBeNull();
    const newWps = t!.waypoints;
    expect(newWps).toHaveLength(4);
    expect(newWps[2].loc).toEqual(mkCoord(UNI.lat - 95, 30));
  });

  it('consults isBookingToUni with the request', async () => {
    const p = reqTo();
    await addPassenger(defTrip(true), p);
    expect(mockIsToUni).toHaveBeenCalledWith(p);
  });

  // trip validation (before adding passenger)
  describe('current trip validation', () => {
    it.each([
      ['0 waypoints', []],
      ['1 waypoint (no end point)', [UNI.lat]],
    ])('%s rejects before calling the API', async (_name, lats) => {
      await expect(addPassenger(mkTrip(mkLine(lats)), reqTo())).rejects.toThrow(/not adequately populated/);
      expect(mockComputeRoute).not.toHaveBeenCalled();
    });

    it('2 waypoints (only driver\'s waypoints): the new stop goes between driver and uni', async () => {
      // 23 min / 9100 m to the stop, then 13 min / 5600 m onward
      mockComputeRoute.mockReturnValue(buildRouteResponse(apiLeg(1380, 9100), apiLeg(780, 5600)));
      const t = await addPassenger(mkTrip(mkLine([300, 0].map(l => UNI.lat - l))), reqTo());

      expect(t).not.toEqual(null);
      const newWps = t!.waypoints;
      expect(newWps).toHaveLength(3);
      expect(newWps[1].loc).toEqual(mkCoord(875));
      expect(t!.legs).toEqual([23, 13]);          // the single 10-min leg is replaced
      expect(t!.legDists).toEqual([9100, 5600]);  // the single 1000 m leg is replaced
      expect(t!.currDur).toBe(36);
      expect(t!.currDist).toBe(14700);
    });

    it.each([
      ['no leg times (0 legs)', [], [1000]],
      ['no leg distances (0 legs)', [10], []],
    ])('2 waypoints with %s rejects', async (_name, legs, legDists) => {
      const curr = mkTrip(mkLine([300, 0].map(l => UNI.lat - l)), legs, legDists);
      await expect(addPassenger(curr, reqTo())).rejects.toThrow(/not adequately populated/);
    });

    it('2 waypoints with exactly 1 leg time and 1 leg distance is accepted', async () => {
      const curr = mkTrip(mkLine([300, 0].map(l => UNI.lat - l)), [10], [1000]);
      await expect(addPassenger(curr, reqTo())).resolves.not.toBeNull();
    });

    it('an undefined waypoint in the list rejects with the intended message', async () => {
      const curr = mkTrip([mkWp(UNI.lat - 300), undefined as unknown as Waypoint, mkWp(UNI.lat)]);
      await expect(addPassenger(curr, reqTo())).rejects.toThrow(/undefined waypoint/);
    });
  });

  // check for updated window
  describe("new stop uses the passenger's window", () => {
    it('to-uni, default window 08:15-12:00, scanned windows are returned, not the raw ones', async () => {
      const t = await addPassenger(defTrip(true), reqTo());
      expect(windows(t!.waypoints)).toEqual([
        ['08:00', '11:20'],
        ['08:10', '11:30'],
        ['08:18', '11:38'], // new stop: raw window was 08:15-12:00
        ['08:28', '11:48'],
        ['08:40', '12:00'],
      ]);
    });

    it('to-uni: passenger start (08:30) bounds the new stop, passenger end (11:45) bounds the arrival', async () => {
      const p = mkReq(mkCoord(875), UNI, { start: tOfDay(8, 30), end: tOfDay(11, 45) });
      const t = await addPassenger(defTrip(true), p);
      expect(windows(t!.waypoints)).toEqual([
        ['08:00', '11:05'],
        ['08:10', '11:15'],
        ['08:30', '11:23'], // earliest = passenger start, since the driver would arrive at 08:18
        ['08:40', '11:33'],
        ['08:52', '11:45'],
      ]);
    });

    it('from-uni, default window 08:15-12:00, scanned windows are returned, not the raw ones', async () => {
      mockIsToUni.mockReturnValue(false);
      const t = await addPassenger(defTrip(false), reqFrom());
      expect(windows(t!.waypoints)).toEqual([
        ['08:15', '11:31'],
        ['08:25', '11:41'],
        ['08:36', '11:52'],
        ['08:44', '12:00'], // new stop: raw window was 08:15-12:00
        ['08:54', '23:00'],
      ]);
    });

    it('from-uni: passenger start (08:30) is the uni departure, passenger end (11:45) bounds the new stop', async () => {
      mockIsToUni.mockReturnValue(false);
      const p = mkReq(UNI, mkCoord(725), { start: tOfDay(8, 30), end: tOfDay(11, 45) });
      const t = await addPassenger(defTrip(false), p);
      expect(windows(t!.waypoints)).toEqual([
        ['08:30', '11:16'],
        ['08:40', '11:26'],
        ['08:51', '11:37'],
        ['08:59', '11:45'],
        ['09:09', '23:00'],
      ]);
    });
  });

  // infeasible passengers
  describe('infeasible passenger returns null', () => {
    describe('to-uni: with a 08:15 start, the uni arrival must be no earlier than 08:40', () => {
      const run = (end: Date) =>
        addPassenger(defTrip(true), mkReq(mkCoord(875), UNI, { start: tOfDay(8, 15), end }));

      it('end 08:39 (1 min too early): null', async () => {
        await expect(run(tOfDay(8, 39))).resolves.toBeNull();
      });
      it('end 08:40 (exact fit): zero-slack windows', async () => {
        expect(windows((await run(tOfDay(8, 40)))!.waypoints)).toEqual([
          ['08:00', '08:00'],
          ['08:10', '08:10'],
          ['08:18', '08:18'],
          ['08:28', '08:28'],
          ['08:40', '08:40'],
        ]);
      });
      it('end 08:41 (1 min of slack)', async () => {
        expect(windows((await run(tOfDay(8, 41)))!.waypoints)).toEqual([
          ['08:00', '08:01'],
          ['08:10', '08:11'],
          ['08:18', '08:19'],
          ['08:28', '08:29'],
          ['08:40', '08:41'],
        ]);
      });
    });

    describe('from-uni: with a 08:30 uni departure, the passenger must be dropped off no earlier than 08:59', () => {
      beforeEach(() => mockIsToUni.mockReturnValue(false));
      const run = (end: Date) =>
        addPassenger(defTrip(false), mkReq(UNI, mkCoord(725), { start: tOfDay(8, 30), end }));

      it('end 08:58 (1 min too early): null', async () => {
        await expect(run(tOfDay(8, 58))).resolves.toBeNull();
      });
      it('end 08:59 (exact fit): zero-slack windows up to the new stop', async () => {
        expect(windows((await run(tOfDay(8, 59)))!.waypoints)).toEqual([
          ['08:30', '08:30'],
          ['08:40', '08:40'],
          ['08:51', '08:51'],
          ['08:59', '08:59'],
          ['09:09', '23:00'],
        ]);
      });
      it('end 09:00 (1 min of slack)', async () => {
        expect(windows((await run(tOfDay(9, 0)))!.waypoints)).toEqual([
          ['08:30', '08:31'],
          ['08:40', '08:41'],
          ['08:51', '08:52'],
          ['08:59', '09:00'],
          ['09:09', '23:00'],
        ]);
      });
    });
  });

  // check Google API config guard
  describe('Places API configuration', () => {
    it('not configured: rejects and never calls the API', async () => {
      mockAPIConfig.mockReturnValue(false);
      await expect(addPassenger(defTrip(true), reqTo())).rejects.toThrow(/API key/);
      expect(mockComputeRoute).not.toHaveBeenCalled();
    });
    it('configured: calls the API exactly once', async () => {
      await addPassenger(defTrip(true), reqTo());
      expect(mockComputeRoute).toHaveBeenCalledTimes(1);
    });
  });

  // check request object creation
  it.each([
    ['gap 0 (first)', 0, 700],
    ['gap 1 (middle)', 1, 899],
    ['gap 2 (last)', 2, 1000],
  ])('%s: route runs from the previous stop, via the new stop, to the next stop', async (_name, gap, pickupLat) => {
    const curr = defTrip(true);
    await addPassenger(curr, toUniReq(pickupLat));

    expect(mockComputeRoute).toHaveBeenCalledWith({
      origin: curr.waypoints[gap].loc,
      dest: curr.waypoints[gap + 1].loc,
      inters: [mkCoord(pickupLat)],
      depTime: curr.waypoints[gap].earliest,
      apiKey: 'test-api-key',
      fieldMask: 'routes.legs.duration,routes.legs.distanceMeters',
    });
  });

  // confirm correct run-through of helper functions
  it('replaces the old leg with the two API legs (minutes rounded up) and keeps totals consistent', async () => {
    // 905 s = 15.08 min -> 16, 1260 s = 21 min exactly
    mockComputeRoute.mockReturnValue(buildRouteResponse(apiLeg(905, 4321), apiLeg(1260, 6789)));
    const t = (await addPassenger(defTrip(true), mkReq(mkCoord(899), UNI)))!;

    expect(t.legs).toEqual([10, 16, 21, 12]);
    expect(t.legDists).toEqual([1000, 4321, 6789, 1020]);
    expect(t.currDur).toBe(33 - 11 + 16 + 21);          // 59 min
    expect(t.currDist).toBe(3030 - 1010 + 4321 + 6789); // 13 130 m
    // internal consistency
    expect(t.currDur).toBe(sum(t.legs));
    expect(t.currDist).toBe(sum(t.legDists));
    expect(t.legs).toHaveLength(t.waypoints.length - 1);
    expect(t.legDists).toHaveLength(t.legs.length);
  });

  // confirm API rejections handled
  describe('API failures', () => {
    it('rejects when computeRoute rejects', async () => {
      mockComputeRoute.mockRejectedValue(new Error('network down'));
      await expect(addPassenger(defTrip(true), reqTo())).rejects.toThrow('network down');
    });
    it('rejects when no routes are returned', async () => {
      mockComputeRoute.mockReturnValue(emptyRouteResponse());
      await expect(addPassenger(defTrip(true), reqTo())).rejects.toThrow();
    });
    it('rejects when only one leg is returned', async () => {
      mockComputeRoute.mockReturnValue(buildRouteResponse(apiLeg(840, 2950)));
      await expect(addPassenger(defTrip(true), reqTo())).rejects.toThrow();
    });
  });

  // check for immutability of input arguments
  it('does not mutate the current trip or request', async () => {
    const curr = defTrip(true);
    const p = reqTo();
    const before = JSON.stringify([curr, p]); // Dates serialise to ISO strings, so time changes are caught
    deepFreeze(curr);
    deepFreeze(p);

    const t = await addPassenger(curr, p);

    expect(t).not.toBeNull();
    expect(t!.waypoints).not.toBe(curr.waypoints);
    expect(t!.legs).not.toBe(curr.legs);
    expect(t!.legDists).not.toBe(curr.legDists);
    expect(JSON.stringify([curr, p])).toBe(before);
  });
});

// =====================================================================
// Integration: real scanTripToUni (API, calcDist, isBookingToUni, config mocked)
// Move to the integration folder later.
//   Trip: UNI-100 / UNI-50 / UNI, earliest 08:00, uni latest 09:30, legs 10/10.
//   Passenger at UNI-75 -> gap 1. API: 10 min to the stop, 5 min onward => legs [10, 10, 5].
//   Passenger earliest 08:30, so the stop's earliest is max(08:10 + 10, 08:30) = 08:30.
// =====================================================================
describe('addPassenger integration with real scanTripToUni', () => {
  jest.resetModules();
  const m = loadAddPassenger();

  beforeEach(() => {
    jest.resetAllMocks();
    m.apiConfig.mockReturnValue(true);
    m.isToUni.mockReturnValue(true);
    m.calcDist.mockImplementation(euclid);
    m.computeRoute.mockResolvedValue(buildRouteResponse(apiLeg(600, 3200), apiLeg(300, 1750)));
  });

  const trip = () => mkTrip(
    [mkWp(UNI.lat - 100, tOfDay(8)), mkWp(UNI.lat - 50, tOfDay(8)), mkWp(UNI.lat, tOfDay(8), tOfDay(9, 30))],
    [10, 10], [1000, 1000],
  );
  const run = (end: Date) => m.addPassenger(trip(), toUniReq(UNI.lat - 25, { start: tOfDay(8, 30), end }));

  it('passenger end 09:00 (stricter than the uni 09:30): windows are tightened', async () => {
    const t = await run(tOfDay(9));
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
      await expect(run(tOfDay(8, 34))).resolves.toBeNull();
    });
    it('end 08:35 (exact fit): zero-slack windows', async () => {
      expect(windows((await run(tOfDay(8, 35)))!.waypoints)).toEqual([
        ['08:00', '08:10'],
        ['08:10', '08:20'],
        ['08:30', '08:30'],
        ['08:35', '08:35'],
      ]);
    });
    it('end 08:36 (1 min of slack)', async () => {
      expect(windows((await run(tOfDay(8, 36)))!.waypoints)).toEqual([
        ['08:00', '08:11'],
        ['08:10', '08:21'],
        ['08:30', '08:31'],
        ['08:35', '08:36'],
      ]);
    });
  });
});

// =====================================================================
// Integration: real scanTripFromUni (API, calcDist, isBookingToUni, config mocked)
// Move to the integration folder later.
//   Trip: UNI (uni) / UNI-50 / UNI-100, earliest 08:00, driver's final stop latest 09:30, legs 10/10.
//   Passenger drops off at UNI-75 -> gap 1, latest 09:00. API: legs [10, 10, 5].
//   Latest times (backward): final 09:30, stop 09:00, wp1 08:50, uni 08:40.
// =====================================================================
describe('integration with real scanTripFromUni', () => {
  jest.resetModules();
  const m = loadAddPassenger();

  beforeEach(() => {
    jest.resetAllMocks();
    m.apiConfig.mockReturnValue(true);
    m.isToUni.mockReturnValue(false);
    m.calcDist.mockImplementation(euclid);
    m.computeRoute.mockResolvedValue(buildRouteResponse(apiLeg(600, 2400), apiLeg(300, 1300)));
  });

  const trip = () => mkTrip(
    [mkWp(UNI.lat, tOfDay(8)), mkWp(UNI.lat - 50, tOfDay(8)), mkWp(UNI.lat - 100, tOfDay(8), tOfDay(9, 30))],
    [10, 10], [1000, 1000],
  );
  const run = (start: Date) => m.addPassenger(trip(), fromUniReq(UNI.lat - 75, { start, end: tOfDay(9) }));

  it('passenger departure 08:30 (later than the driver\'s 08:00): windows are tightened', async () => {
    const t = await run(tOfDay(8, 30));
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
      await expect(run(tOfDay(8, 41))).resolves.toBeNull();
    });
    it('start 08:40 (exact fit): zero-slack windows', async () => {
      expect(windows((await run(tOfDay(8, 40)))!.waypoints)).toEqual([
        ['08:40', '08:40'],
        ['08:50', '08:50'],
        ['09:00', '09:00'],
        ['09:05', '09:30'],
      ]);
    });
    it('start 08:39 (1 min of slack)', async () => {
      expect(windows((await run(tOfDay(8, 39)))!.waypoints)).toEqual([
        ['08:39', '08:40'],
        ['08:49', '08:50'],
        ['08:59', '09:00'],
        ['09:04', '09:30'],
      ]);
    });
  });
});
