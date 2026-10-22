import {
  geocodeAddress,
  GOOGLE_MAPS_API_KEY,
  isPlacesConfigured,
  MONASH_CLAYTON_LOCATION,
} from '../services/googlePlaces';
import { computeRoute } from '../services/googleRoutes';
import type { Coord } from '../pages/schema/booking.schema';

// Haversine formula to get straight-line distance
function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Average Australian petrol car emissions = ~0.17 kg CO2 / km
export const EMISSIONS_PER_KM = 0.17;
export const ROAD_DISTANCE_FACTOR = 1.35;

/**
 * Returns estimated road distance in km between an address and Monash Clayton.
 */
export async function getRoadDistanceKm(
  address: string,
  coord?: Coord,
  toUni = true,
): Promise<number | null> {
  const loc = coord
    ? { lat: coord.lat, lng: coord.lon }
    : await geocodeAddress(address);
  if (!loc) return null;

  if (isPlacesConfigured()) {
    try {
      const home = { lat: loc.lat, lon: loc.lng };
      const campus = { lat: MONASH_CLAYTON_LOCATION.lat, lon: MONASH_CLAYTON_LOCATION.lng };
      const result = await computeRoute({
        route: {
          origin: toUni ? home : campus,
          dest: toUni ? campus : home,
          depTime: new Date(),
        },
        apiKey: GOOGLE_MAPS_API_KEY,
        fieldMask: 'routes.distanceMeters',
      });
      const distanceMeters = result?.routes?.[0]?.distanceMeters;
      if (typeof distanceMeters === 'number' && Number.isFinite(distanceMeters) && distanceMeters >= 0) {
        return distanceMeters / 1000;
      }
    } catch {
      // Keep bookings usable when route lookup is unavailable; estimate below.
    }
  }

  const distanceStraightLine = getDistanceFromLatLonInKm(
    loc.lat,
    loc.lng,
    MONASH_CLAYTON_LOCATION.lat,
    MONASH_CLAYTON_LOCATION.lng,
  );
  return distanceStraightLine * ROAD_DISTANCE_FACTOR;
}

/**
 * Estimates emissions saved for a single trip/address to Monash Clayton.
 */
export async function estimateEmissionsSaved(
  address: string,
  numPassengers: number = 1,
  coord?: Coord,
  toUni = true,
): Promise<number | null> {
  const roadDistanceKm = await getRoadDistanceKm(address, coord, toUni);
  if (roadDistanceKm === null) return null;
  
  // Round to 1 decimal place
  const totalEmissions = roadDistanceKm * EMISSIONS_PER_KM * numPassengers;
  return Math.round(totalEmissions * 10) / 10;
}

/**
 * Calculates driver savings as the sum of rider solo-trip emissions.
 */
export function calculateDriverEmissionsSaved(
  _driverDistanceKm: number,
  riderEmissionsKg: number[],
): number {
  if (riderEmissionsKg.length === 0) return 0;
  const ridersEmission = riderEmissionsKg.reduce((sum, val) => sum + val, 0);
  return Math.round(ridersEmission * 10) / 10;
}

/**
 * Estimates driver savings from each rider's solo trip to Monash Clayton.
 * Riders can be provided as addresses (string) or pre-calculated emissions (number).
 * If no riders are provided, returns 0.
 */
export async function estimateDriverEmissionsSaved(
  _driverAddress: string,
  riders: (string | number)[] = [],
  toUni = true,
): Promise<number | null> {
  if (riders.length === 0) return 0;

  let totalRiderEmissions = 0;

  for (const rider of riders) {
    if (typeof rider === 'number') {
      totalRiderEmissions += rider;
    } else {
      const riderDist = await getRoadDistanceKm(rider, undefined, toUni);
      if (riderDist !== null) {
        totalRiderEmissions += riderDist * EMISSIONS_PER_KM;
      }
    }
  }

  return Math.round(totalRiderEmissions * 10) / 10;
}
