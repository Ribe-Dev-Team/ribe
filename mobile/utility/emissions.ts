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

export async function estimateEmissionsSaved(address: string, numPassengers: number = 1): Promise<number | null> {
  const loc = await geocodeAddress(address);
  if (!loc) return null;
  
  const distanceStraightLine = getDistanceFromLatLonInKm(loc.lat, loc.lng, MONASH_CLAYTON_LOCATION.lat, MONASH_CLAYTON_LOCATION.lng);
  
  // Approximate road distance factor
  const roadDistanceKm = distanceStraightLine * 1.35;
  
  // Average Australian petrol car emissions = ~0.17 kg CO2 / km
  const EMISSIONS_PER_KM = 0.17;
  
  // Round to 1 decimal place
  const totalEmissions = roadDistanceKm * EMISSIONS_PER_KM * numPassengers;
  return Math.round(totalEmissions * 10) / 10;
}
