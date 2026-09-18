// Thin wrapper around the Google Maps Platform REST APIs (Places Autocomplete, Place Details,
// Geocoding, Static Maps). Kept as plain REST calls - no native map SDK - so it works today in
// Expo Go and can be reused as-is for trip-route previews later, without a dev-client migration.

export const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export function isPlacesConfigured(): boolean {
  return GOOGLE_MAPS_API_KEY.length > 0;
}

export interface PlacePrediction {
  placeId: string;
  description: string;
}

export interface ResolvedPlace {
  description: string;
  lat: number;
  lng: number;
}

// Monash University Clayton campus - the fixed second point on every booking's route preview.
export const MONASH_CLAYTON_LOCATION = {
  label: 'Monash University Clayton',
  lat: -37.9106,
  lng: 145.1361,
};

function buildUrl(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams({ ...params, key: GOOGLE_MAPS_API_KEY }).toString();
  return `https://maps.googleapis.com/maps/api/${path}?${query}`;
}

export function createSessionToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function fetchPlacePredictions(input: string, sessionToken: string): Promise<PlacePrediction[]> {
  if (!isPlacesConfigured() || !input.trim()) return [];
  try {
    const url = buildUrl('place/autocomplete/json', {
      input: input.trim(),
      sessiontoken: sessionToken,
      components: 'country:au',
    });
    const response = await fetch(url);
    const json = await response.json();
    if (json.status !== 'OK') return [];
    return (json.predictions ?? []).map((prediction: { place_id: string; description: string }) => ({
      placeId: prediction.place_id,
      description: prediction.description,
    }));
  } catch (err) {
    console.warn('Places autocomplete failed:', err);
    return [];
  }
}

export async function fetchPlaceDetails(placeId: string, sessionToken: string): Promise<ResolvedPlace | null> {
  if (!isPlacesConfigured()) return null;
  try {
    const url = buildUrl('place/details/json', {
      place_id: placeId,
      sessiontoken: sessionToken,
      fields: 'formatted_address,geometry',
    });
    const response = await fetch(url);
    const json = await response.json();
    const location = json.result?.geometry?.location;
    if (json.status !== 'OK' || !location) return null;
    return { description: json.result.formatted_address ?? '', lat: location.lat, lng: location.lng };
  } catch (err) {
    console.warn('Place details lookup failed:', err);
    return null;
  }
}

export async function geocodeAddress(address: string): Promise<ResolvedPlace | null> {
  if (!isPlacesConfigured() || !address.trim()) return null;
  try {
    const url = buildUrl('geocode/json', { address: address.trim(), components: 'country:AU' });
    const response = await fetch(url);
    const json = await response.json();
    const first = json.results?.[0];
    const location = first?.geometry?.location;
    if (json.status !== 'OK' || !location) return null;
    return { description: first.formatted_address ?? address, lat: location.lat, lng: location.lng };
  } catch (err) {
    console.warn('Geocoding failed:', err);
    return null;
  }
}
