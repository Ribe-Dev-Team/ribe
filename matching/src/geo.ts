import { Coord } from './types';

const EARTH_RADIUS_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in km. */
export function haversineKm(a: Coord, b: Coord): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * KEY-135. Initial bearing from a to b, in degrees clockwise from north, [0, 360).
 */
export function bearingDegrees(a: Coord, b: Coord): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * KEY-135: "Handle bearings around 0°/360°."
 * Smallest angle between two bearings, always in [0, 180].
 * Naive subtraction makes 350° and 10° look 340° apart; they are 20°.
 */
export function bearingDifference(b1: number, b2: number): number {
  const raw = Math.abs(b1 - b2) % 360;
  return raw > 180 ? 360 - raw : raw;
}
