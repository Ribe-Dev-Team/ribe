import {
  toLatLng,
  tripLeg,
  countTripParticipants,
  buildStoredCostSplit,
} from '../../mobile/utility/costSplitRecord';

const driverHome = { lat: -37.8, lng: 145.0 };
const riderHome = { lat: -37.85, lng: 145.05 };
const campus = { lat: -37.9106, lng: 145.1361 };

describe('toLatLng', () => {
  it('converts the stored { lat, lon } to { lat, lng }', () => {
    expect(toLatLng({ lat: -37.8, lon: 145 })).toEqual({ lat: -37.8, lng: 145 });
  });

  it.each([undefined, null, {}, { lat: -37.8 }, { lat: '-37.8', lon: 145 }])('is null for a missing or malformed coord (%p)', (coord) => {
    expect(toLatLng(coord as never)).toBeNull();
  });
});

describe('tripLeg', () => {
  it('goes driver home -> rider -> campus on the way to uni', () => {
    expect(tripLeg(true, driverHome, riderHome, campus)).toEqual({ origin: driverHome, destination: campus, via: riderHome });
  });

  it('goes campus -> rider -> driver home on the way back', () => {
    expect(tripLeg(false, driverHome, riderHome, campus)).toEqual({ origin: campus, destination: driverHome, via: riderHome });
  });
});

describe('countTripParticipants', () => {
  it('is the driver plus this rider when nobody else has confirmed', () => {
    expect(countTripParticipants('r1')).toBe(2);
    expect(countTripParticipants('r1', [])).toBe(2);
  });

  it('adds a rider still awaiting approval to the confirmed riders', () => {
    expect(countTripParticipants('r3', ['r1', 'r2'])).toBe(4);
  });

  it('does not double count a rider who is already confirmed', () => {
    expect(countTripParticipants('r1', ['r1', 'r2'])).toBe(3);
  });
});

describe('buildStoredCostSplit', () => {
  const calculatedAt = new Date('2026-10-06T00:00:00Z');
  // 200 c/L, 10 L/100km -> $0.20 per km.
  const record = buildStoredCostSplit({
    fuel: { price: 200, fuelType: 'U91', source: 'fallback' },
    vehicleEconomy: 10,
    tripDistanceKm: 30,
    detourDistanceKm: 5,
    tripParticipants: 3,
    calculatedAt,
  });

  it('stores the calculated split', () => {
    expect(record.fuelCost).toBeCloseTo(6);
    expect(record.baseTripContribution).toBeCloseTo(2);
    expect(record.detourCost).toBeCloseTo(1);
    expect(record.passengerContribution).toBeCloseTo(3);
    expect(record.parkingCost).toBe(0);
  });

  it('stores the inputs it was calculated from', () => {
    expect(record).toMatchObject({
      medianFuelPrice: 200,
      fuelType: 'U91',
      fuelSource: 'fallback',
      vehicleEconomy: 10,
      tripDistanceKm: 30,
      detourDistanceKm: 5,
      tripParticipants: 3,
      calculatedAt,
    });
  });

  it('rejects invalid inputs rather than saving a bad amount', () => {
    expect(() => buildStoredCostSplit({
      fuel: { price: 200, fuelType: 'U91', source: 'fallback' },
      vehicleEconomy: 10,
      tripDistanceKm: 30,
      detourDistanceKm: 5,
      tripParticipants: 0,
    })).toThrow();
  });
});
