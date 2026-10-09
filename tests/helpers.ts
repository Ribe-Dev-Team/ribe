/* A file for function to help with testing. */
import { Coord, Waypoint, Trip, MatchRequest, type MatchOffer } from "../backend/server/matching.schema";

export {
  sum,
  tOfDay,
  hm,
  UNI,
  newPoint,
  mkCoord,
  mkWp,
  newWp,
  mkLine,
  mkTrip,
  mkReq,
  mkOffer,
  toUniReq,
  fromUniReq,
  ApiLeg,
  apiLeg,
  buildRouteResponse,
  emptyRouteResponse,
  windows,
  deepFreeze,
};
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
const mkOffer = (currTrip: Trip, toUni = true, o: Partial<MatchOffer> = {}): MatchOffer => ({
  offerId: -1,
  start: toUni ? mkCoord(UNI.lat - 300) : UNI,
  end: toUni ? UNI : mkCoord(UNI.lat - 300),
  directTime: 30,   // minutes
  directDist: 10,
  capacity: 3,
  window: { start: tOfDay(7), end: tOfDay(12), maxDetour: 20 }, // max trip time = 30 + 20 = 50 min
  status: 'active',
  currTrip,
  rides: [],
  ...o,
});
const toUniReq = (pickupLat: number, window?: { start: Date; end: Date; }) => mkReq(mkCoord(pickupLat), UNI, window);
const fromUniReq = (dropLat: number, window?: { start: Date; end: Date; }) => mkReq(UNI, mkCoord(dropLat), window);

type ApiLeg = { duration: string; distanceMeters: number; };
const apiLeg = (seconds: number, meters: number): ApiLeg => ({ duration: `${seconds}s`, distanceMeters: meters });
// API response builder
const buildRouteResponse = (...legs: ApiLeg[]) => ({ routes: [{ legs }] });
const emptyRouteResponse = () => ({ routes: [] as { legs: ApiLeg[]; }[] });
// extract boundary times from waypoints
const windows = (ws: Waypoint[] | null) => ws && ws.map(w => [hm(w.earliest), hm(w.latest)]);

// freeze objects for mutability checking
function deepFreeze<T>(o: T): T {
  Object.values(o as object).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(o);
}