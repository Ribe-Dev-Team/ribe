import {
  EMISSIONS_PER_KM,
  ROAD_DISTANCE_FACTOR,
  getRoadDistanceKm,
  estimateEmissionsSaved,
  calculateDriverEmissionsSaved,
  estimateDriverEmissionsSaved,
} from '../../mobile/utility/emissions';
import * as googlePlaces from '../../mobile/services/googlePlaces';

jest.mock('../../mobile/services/googlePlaces', () => ({
  MONASH_CLAYTON_LOCATION: {
    label: 'Monash University Clayton',
    lat: -37.9106,
    lng: 145.1361,
  },
  geocodeAddress: jest.fn(),
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

    it('calculates total distance emission plus each riders emission when driver gets riders', () => {
      const driverDistanceKm = 20; // 20 * 0.17 = 3.4 kg
      const riderEmissions = [2.5, 1.8]; // sum = 4.3 kg
      // Total = 3.4 + 4.3 = 7.7 kg
      const saved = calculateDriverEmissionsSaved(driverDistanceKm, riderEmissions);
      expect(saved).toBe(7.7);
    });

    it('correctly rounds to 1 decimal place', () => {
      const driverDistanceKm = 15.3; // 15.3 * 0.17 = 2.601
      const riderEmissions = [1.25, 2.12]; // sum = 3.37
      // 2.601 + 3.37 = 5.971 -> 6.0
      expect(calculateDriverEmissionsSaved(driverDistanceKm, riderEmissions)).toBe(6.0);
    });
  });

  describe('estimateDriverEmissionsSaved', () => {
    it('returns 0 if no riders are given', async () => {
      const saved = await estimateDriverEmissionsSaved('Driver Origin', []);
      expect(saved).toBe(0);
    });

    it('returns null if driver address fails to geocode', async () => {
      (googlePlaces.geocodeAddress as jest.Mock).mockResolvedValue(null);
      const saved = await estimateDriverEmissionsSaved('Driver Origin', ['Rider 1']);
      expect(saved).toBeNull();
    });

    it('calculates driver trip emission plus each rider address emission', async () => {
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

      const driverDist = await getRoadDistanceKm('Driver Origin');
      const rider1Dist = await getRoadDistanceKm('Rider 1');
      const rider2Dist = await getRoadDistanceKm('Rider 2');

      const expected = Math.round(
        (driverDist! * 0.17 + rider1Dist! * 0.17 + rider2Dist! * 0.17) * 10,
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
      const driverDist = await getRoadDistanceKm('Driver Origin');
      const driverEmission = driverDist! * 0.17;
      const expected = Math.round((driverEmission + 2.4 + 1.6) * 10) / 10;

      const saved = await estimateDriverEmissionsSaved('Driver Origin', [2.4, 1.6]);
      expect(saved).toBe(expected);
    });
  });
});

