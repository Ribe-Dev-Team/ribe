// Driving distances for cost splitting, via the Google Routes API (computeRoutes). Needs the
// Routes API enabled on the same key as Places; returns null whenever a distance can't be found
// so callers can fall back to an estimate rather than showing a wrong number.

import { GOOGLE_MAPS_API_KEY, isPlacesConfigured } from './googlePlaces';
import { calcDetourDistance } from '../utility/costSplitting';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TripDistances {
  tripDistanceKm: number;   // driver's origin -> destination, no detours
  detourDistanceKm: number; // extra km to go via the passenger's pickup
}

function toWaypoint({ lat, lng }: LatLng) {
  return { location: { latLng: { latitude: lat, longitude: lng } } };
}

export async function fetchDrivingDistanceKm(origin: LatLng, destination: LatLng, via: LatLng[] = []): Promise<number | null> {
  if (!isPlacesConfigured()) return null;
  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: toWaypoint(origin),
        destination: toWaypoint(destination),
        intermediates: via.map(toWaypoint),
        travelMode: 'DRIVE',
      }),
    });
    if (!response.ok) throw new Error(`Routes API responded with ${response.status}: ${await response.text()}`);
    const json = await response.json();
    const meters = json.routes?.[0]?.distanceMeters;
    return typeof meters === 'number' ? meters / 1000 : null;
  } catch (err) {
    console.warn('Route distance lookup failed:', err);
    return null;
  }
}

// Trip distance for the driver, plus the extra distance of detouring via one passenger's pickup.
export async function fetchTripDistances(driverOrigin: LatLng, destination: LatLng, pickup: LatLng): Promise<TripDistances | null> {
  const [direct, withPickup] = await Promise.all([
    fetchDrivingDistanceKm(driverOrigin, destination),
    fetchDrivingDistanceKm(driverOrigin, destination, [pickup]),
  ]);
  if (direct === null || withPickup === null) return null;
  return { tripDistanceKm: direct, detourDistanceKm: calcDetourDistance(direct, withPickup) };
}
