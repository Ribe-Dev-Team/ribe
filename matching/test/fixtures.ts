import { Coord, MatchOffer, MatchRequest, Preferences } from '../src/types';

export const CAMPUS: Coord = { lat: -37.9105, lon: 145.1362 }; // Monash Clayton

export const PREFS: Preferences = {
  genderPreference: 'ANY', quietRide: false, luggage: false,
};

export const at = (h: number, m = 0, day = 15) =>
  new Date(Date.UTC(2026, 8, day, h - 10, m)); // Melbourne (UTC+10)

export function makeRequest(p: Partial<MatchRequest> & { reqId: string; start: Coord }): MatchRequest {
  return {
    riderId: 'rider-' + p.reqId,
    direction: 'TO_CAMPUS',
    end: CAMPUS,
    travelWindow: { start: at(8), end: at(8, 45) },
    arriveBy: at(9),
    maxDetour: 10,
    preferences: { ...PREFS },
    status: 'unassigned',
    ...p,
  } as MatchRequest;
}

export function makeOffer(p: Partial<MatchOffer> & { offerId: string; start: Coord }): MatchOffer {
  return {
    driverId: 'driver-' + p.offerId,
    direction: 'TO_CAMPUS',
    end: CAMPUS,
    travelWindow: { start: at(8), end: at(8, 45) },
    maxDetour: 20,
    seatsOffered: 4,
    seatsFilled: 0,
    acceptingMore: true,
    status: 'open',
    preferences: { ...PREFS },
    onBoard: [],
    currTripDuration: 0,
    ...p,
  } as MatchOffer;
}

/** Deterministic spread of points around campus, radius in km. */
export function ring(n: number, radiusKm: number, seed = 1): Coord[] {
  const out: Coord[] = [];
  for (let i = 0; i < n; i++) {
    const ang = ((i * 137.508 + seed * 31) % 360) * (Math.PI / 180);
    const r = radiusKm * (0.35 + ((i * 17 + seed * 7) % 100) / 154);
    out.push({
      lat: CAMPUS.lat + (r / 110.57) * Math.cos(ang),
      lon: CAMPUS.lon + (r / (111.32 * Math.cos(CAMPUS.lat * Math.PI / 180))) * Math.sin(ang),
    });
  }
  return out;
}
