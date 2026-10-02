/**
 * Test double for the Google Routes wrapper (`computeRoute`) and the Google config flags.
 * Response shape follows the real API: `duration` is a string like "905s", `distanceMeters` is a number.
 */
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

export const routesResponse = (...legs: MockLeg[]) => ({ routes: [{ legs }] });
export const emptyRoutesResponse = () => ({ routes: [] });

/** Call in beforeEach (after jest.resetAllMocks()). Default: leg 1 = 10 min / 1500 m, leg 2 = 15 min / 2500 m. */
export function resetGoogleApiMock() {
  mockConfig.isPlacesConfigured = true;
  mockConfig.apiKey = 'test-api-key';
  computeRoute.mockReset();
  computeRoute.mockResolvedValue(routesResponse(leg(600, 1500), leg(900, 2500)));
}