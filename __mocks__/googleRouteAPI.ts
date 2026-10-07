/**
 * Test double for the Google Routes wrapper (`computeRoute`) and the Google config flags.
 * Response shape follows the real API: `duration` is a string like "905s", `distanceMeters` is a number.
 */

import { sum } from "../tests/helpers";

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

export const computeRoute = jest.fn();

// Mutable so tests can flip configuration per-test
export const mockConfig = { isPlacesConfigured: true, apiKey: 'test-api-key' };

// Module shapes handed to jest.mock(...) factories (getters keep the values live)
export const routesModule = { computeRoute };
export const configModule = {
  get isPlacesConfigured() { return mockConfig.isPlacesConfigured; },
  get GOOGLE_MAPS_API_KEY() { return mockConfig.apiKey; },
};

export interface MockLeg { duration: string; distanceMeters: number; }

export const leg = (seconds: number, meters: number): MockLeg => ({
  duration: `${seconds}s`,
  distanceMeters: meters,
});

export const routesResponse = (...legs: MockLeg[]) => ({
  routes: [{
    duration: `${sum(legs.map(l => parseInt(l.duration)))}s`,
    distanceMeters: sum(legs.map(l => l.distanceMeters)),
    legs,
    optimizedIntermediateWaypointIndex: legs.slice(2).map((_, i) => i),
  }]
});
export const emptyRoutesResponse = () => ({ routes: [] });

/** Call in beforeEach (after jest.resetAllMocks()). Default: leg 1 = 8 min / 2007 m, leg 2 = 10 min / 3210 m. */
export function resetGoogleApiMock() {
  mockConfig.isPlacesConfigured = true;
  mockConfig.apiKey = 'test-api-key';
  computeRoute.mockReset();
  computeRoute.mockResolvedValue(routesResponse(leg(455, 2007), leg(600, 3210)));
}