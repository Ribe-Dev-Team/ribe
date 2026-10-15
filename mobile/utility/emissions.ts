import { geocodeAddress, MONASH_CLAYTON_LOCATION } from '../services/googlePlaces';

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
export async function getRoadDistanceKm(address: string): Promise<number | null> {
  const loc = await geocodeAddress(address);
  if (!loc) return null;
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
export async function estimateEmissionsSaved(address: string, numPassengers: number = 1): Promise<number | null> {
  const roadDistanceKm = await getRoadDistanceKm(address);
  if (roadDistanceKm === null) return null;
  
  // Round to 1 decimal place
  const totalEmissions = roadDistanceKm * EMISSIONS_PER_KM * numPassengers;
  return Math.round(totalEmissions * 10) / 10;
}

/**
 * Calculates emissions saved from the driver's perspective:
 * When the driver has riders, amount saved is the total driver distance emission
 * plus each rider's emission.
 * If there are no riders aboard, returns 0.
 */
export function calculateDriverEmissionsSaved(
  driverDistanceKm: number,
  riderEmissionsKg: number[],
): number {
  if (riderEmissionsKg.length === 0) return 0;
  const driverEmission = driverDistanceKm * EMISSIONS_PER_KM;
  const ridersEmission = riderEmissionsKg.reduce((sum, val) => sum + val, 0);
  return Math.round((driverEmission + ridersEmission) * 10) / 10;
}

/**
 * Estimates emissions saved for a driver offering a ride to Monash Clayton with riders:
 * Driver's trip emission (totalDistance * 0.17 kg/km) + each rider's individual emission.
 * Riders can be provided as addresses (string) or pre-calculated emissions (number).
 * If no riders are provided, returns 0.
 */
export async function estimateDriverEmissionsSaved(
  driverAddress: string,
  riders: (string | number)[] = [],
): Promise<number | null> {
  if (riders.length === 0) return 0;

  const driverDist = await getRoadDistanceKm(driverAddress);
  if (driverDist === null) return null;

  const driverEmission = driverDist * EMISSIONS_PER_KM;
  let totalRiderEmissions = 0;

  for (const rider of riders) {
    if (typeof rider === 'number') {
      totalRiderEmissions += rider;
    } else {
      const riderDist = await getRoadDistanceKm(rider);
      if (riderDist !== null) {
        totalRiderEmissions += riderDist * EMISSIONS_PER_KM;
      }
    }
  }

  return Math.round((driverEmission + totalRiderEmissions) * 10) / 10;
}
