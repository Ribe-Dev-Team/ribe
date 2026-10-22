import {
  EMISSIONS_PER_KM,
  ROAD_DISTANCE_FACTOR,
  getRoadDistanceKm,
  estimateEmissionsSaved,
  calculateDriverEmissionsSaved,
  estimateDriverEmissionsSaved,
} from '../../mobile/utility/emissions';
import * as googlePlaces from '../../mobile/services/googlePlaces';
import * as googleRoutes from '../../mobile/services/googleRoutes';

jest.mock('../../mobile/services/googlePlaces', () => ({
  MONASH_CLAYTON_LOCATION: {
    label: 'Monash University Clayton',
    lat: -37.9106,
    lng: 145.1361,
  },
  GOOGLE_MAPS_API_KEY: 'test-key',
  isPlacesConfigured: () => true,
  geocodeAddress: jest.fn(),
}));

jest.mock('../../mobile/services/googleRoutes', () => ({
  computeRoute: jest.fn(),
}));

describe('emissions calculator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constants', () => {
    it('uses standard Australian petrol emissions and road detour factor', () => {
      expect(EMISSIONS_PER_KM).toBe(0.17);
      expect(ROAD_DISTANCE_FACTOR).toBe(1.35);
    });
  });

  describe('getRoadDistanceKm', () => {
    it('returns null if geocoding returns null', async () => {
      (googlePlaces.geocodeAddress as jest.Mock).mockResolvedValue(null);
      const dist = await getRoadDistanceKm('Unknown Place');
      expect(dist).toBeNull();
    });

    it('calculates road distance using straight-line distance times 1.35', async () => {
      // Point at approx 10 km straight-line distance north of Clayton campus
      (googlePlaces.geocodeAddress as jest.Mock).mockResolvedValue({
        lat: -37.8206,
        lng: 145.1361,
        description: 'Test Location',
      });
      const dist = await getRoadDistanceKm('123 North St');
      expect(dist).not.toBeNull();
      expect(dist!).toBeGreaterThan(12);
      expect(dist!).toBeLessThan(15);
    });

    it('uses Google Routes distance in km when the route is available', async () => {
      (googlePlaces.geocodeAddress as jest.Mock).mockResolvedValue({
        lat: -37.8206,
        lng: 145.1361,
        description: 'Test Location',
      });
      (googleRoutes.computeRoute as jest.Mock).mockResolvedValue({ routes: [{ distanceMeters: 12345 }] });

      await expect(getRoadDistanceKm('123 North St')).resolves.toBe(12.345);
      expect(googleRoutes.computeRoute).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: 'test-key',
        fieldMask: 'routes.distanceMeters',
        route: expect.objectContaining({
          origin: { lat: -37.8206, lon: 145.1361 },
          dest: { lat: -37.9106, lon: 145.1361 },
        }),
      }));
    });

    it('uses the existing road-factor estimate if route lookup fails', async () => {
      (googlePlaces.geocodeAddress as jest.Mock).mockResolvedValue({
        lat: -37.8206,
        lng: 145.1361,
        description: 'Test Location',
      });
      (googleRoutes.computeRoute as jest.Mock).mockRejectedValue(new Error('Routes API unavailable'));

      const dist = await getRoadDistanceKm('123 North St');
      expect(dist).toBeGreaterThan(12);
      expect(dist).toBeLessThan(15);
    });

    it('uses stored coordinates without geocoding', async () => {
      (googleRoutes.computeRoute as jest.Mock).mockResolvedValue({ routes: [{ distanceMeters: 8000 }] });

      await expect(getRoadDistanceKm('ignored', { lat: -37.8206, lon: 145.1361 })).resolves.toBe(8);
      expect(googlePlaces.geocodeAddress).not.toHaveBeenCalled();
    });

    it('routes from campus to home for trips leaving campus', async () => {
      const home = { lat: -37.8206, lon: 145.1361 };
      const campus = { lat: -37.9106, lon: 145.1361 };
      (googleRoutes.computeRoute as jest.Mock).mockResolvedValue({ routes: [{ distanceMeters: 8000 }] });

      await getRoadDistanceKm('ignored', home, false);

      expect(googleRoutes.computeRoute).toHaveBeenCalledWith(expect.objectContaining({
        route: expect.objectContaining({ origin: campus, dest: home }),
      }));
    });
  });

  describe('estimateEmissionsSaved', () => {
    it('returns null if address fails to geocode', async () => {
      (googlePlaces.geocodeAddress as jest.Mock).mockResolvedValue(null);
      const saved = await estimateEmissionsSaved('Invalid');
      expect(saved).toBeNull();
    });

    it('calculates emissions saved for 1 passenger', async () => {
      (googlePlaces.geocodeAddress as jest.Mock).mockResolvedValue({
        lat: -37.8206,
        lng: 145.1361,
        description: 'Test Location',
      });
      const saved = await estimateEmissionsSaved('123 North St', 1);
      const expectedDist = await getRoadDistanceKm('123 North St');
      expect(saved).toBe(Math.round(expectedDist! * 0.17 * 10) / 10);
    });

    it('calculates emissions saved scaled by numPassengers', async () => {
      (googlePlaces.geocodeAddress as jest.Mock).mockResolvedValue({
        lat: -37.8206,
        lng: 145.1361,
        description: 'Test Location',
      });
      const single = await estimateEmissionsSaved('123 North St', 1);
      const triple = await estimateEmissionsSaved('123 North St', 3);
      expect(triple).toBe(Math.round((single! * 3) * 10) / 10);
    });
  });

  describe('calculateDriverEmissionsSaved (driver point of view)', () => {
    it('returns 0 when driver has no riders', () => {
      expect(calculateDriverEmissionsSaved(20, [])).toBe(0);
    });

    it('sums rider emissions without adding the driver emission', () => {
      const driverDistanceKm = 20; // 20 * 0.17 = 3.4 kg
      const riderEmissions = [2.5, 1.8]; // sum = 4.3 kg
      const saved = calculateDriverEmissionsSaved(driverDistanceKm, riderEmissions);
      expect(saved).toBe(4.3);
    });

    it('correctly rounds to 1 decimal place', () => {
      const driverDistanceKm = 15.3; // 15.3 * 0.17 = 2.601
      const riderEmissions = [1.25, 2.12]; // sum = 3.37
      // Rider total 3.37 -> 3.4; driver emission is not included.
      expect(calculateDriverEmissionsSaved(driverDistanceKm, riderEmissions)).toBe(3.4);
    });
  });

  describe('estimateDriverEmissionsSaved', () => {
    it('returns 0 if no riders are given', async () => {
      const saved = await estimateDriverEmissionsSaved('Driver Origin', []);
      expect(saved).toBe(0);
    });

    it('does not include or require the driver address emission', async () => {
      (googlePlaces.geocodeAddress as jest.Mock).mockResolvedValue(null);
      const saved = await estimateDriverEmissionsSaved('Driver Origin', ['Rider 1']);
      expect(saved).toBe(0);
    });

    it('sums each rider address emission without the driver trip', async () => {
      (googlePlaces.geocodeAddress as jest.Mock).mockImplementation(async (addr: string) => {
        if (addr === 'Driver Origin') {
          return { lat: -37.8206, lng: 145.1361, description: 'Driver' };
        }
        if (addr === 'Rider 1') {
          return { lat: -37.8500, lng: 145.1361, description: 'Rider 1' };
        }
        if (addr === 'Rider 2') {
          return { lat: -37.8800, lng: 145.1361, description: 'Rider 2' };
        }
        return null;
      });

      const rider1Dist = await getRoadDistanceKm('Rider 1');
      const rider2Dist = await getRoadDistanceKm('Rider 2');

      const expected = Math.round(
        (rider1Dist! * 0.17 + rider2Dist! * 0.17) * 10,
      ) / 10;

      const saved = await estimateDriverEmissionsSaved('Driver Origin', ['Rider 1', 'Rider 2']);
      expect(saved).toBe(expected);
    });

    it('supports pre-calculated rider emission values (numbers)', async () => {
      (googlePlaces.geocodeAddress as jest.Mock).mockResolvedValue({
        lat: -37.8206,
        lng: 145.1361,
        description: 'Driver',
      });
      const expected = 4.0;

      const saved = await estimateDriverEmissionsSaved('Driver Origin', [2.4, 1.6]);
      expect(saved).toBe(expected);
    });
  });
});

