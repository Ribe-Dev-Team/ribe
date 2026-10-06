import {
  fuelCostDollars,
  calcDetourDistance,
  calcBaseTripContribution,
  calcDetourCost,
  calcPassengerContribution,
  calcCostSplit,
  formatDollars,
} from '../../mobile/utility/costSplitting';

// 200 c/L, 10 L/100km -> $0.20 per km, which keeps the expected values easy to check by hand.
const base = { medianFuelPrice: 200, vehicleEconomy: 10, tripDistanceKm: 30, tripParticipants: 3 };

describe('fuelCostDollars', () => {
  it('converts c/L and L/100km into dollars', () => {
    expect(fuelCostDollars(200, 10, 100)).toBeCloseTo(20);
  });

  it('is zero for zero distance', () => {
    expect(fuelCostDollars(200, 10, 0)).toBe(0);
  });

  it.each([-1, NaN, Infinity])('rejects an invalid distance (%p)', (km) => {
    expect(() => fuelCostDollars(200, 10, km)).toThrow();
  });
});

describe('calcDetourDistance', () => {
  it('is the extra distance of going via the pickup', () => {
    expect(calcDetourDistance(30, 34.5)).toBeCloseTo(4.5);
  });

  it('never goes negative', () => {
    expect(calcDetourDistance(30, 29.8)).toBe(0);
  });
});

describe('calcBaseTripContribution', () => {
  it('splits trip fuel evenly across participants', () => {
    // 30km x $0.20 = $6, over 3 people
    expect(calcBaseTripContribution(base)).toBeCloseTo(2);
  });

  it('splits parking evenly across participants', () => {
    expect(calcBaseTripContribution({ ...base, parkingCost: 9 })).toBeCloseTo(5);
  });

  it.each([0, -1, 1.5])('rejects %p participants', (tripParticipants) => {
    expect(() => calcBaseTripContribution({ ...base, tripParticipants })).toThrow();
  });

  it('rejects negative parking', () => {
    expect(() => calcBaseTripContribution({ ...base, parkingCost: -5 })).toThrow();
  });
});

describe('calcDetourCost', () => {
  it('charges the full detour to the passenger who caused it', () => {
    expect(calcDetourCost({ ...base, detourDistanceKm: 5 })).toBeCloseTo(1);
  });

  it('is zero when there is no detour', () => {
    expect(calcDetourCost(base)).toBe(0);
  });
});

describe('calcPassengerContribution', () => {
  it('is detour cost plus base trip contribution', () => {
    expect(calcPassengerContribution({ ...base, detourDistanceKm: 5, parkingCost: 3 })).toBeCloseTo(1 + 3);
  });
});

describe('calcCostSplit', () => {
  it('returns a consistent breakdown', () => {
    const split = calcCostSplit({ ...base, detourDistanceKm: 5, parkingCost: 3 });
    expect(split.fuelCost).toBeCloseTo(6);
    expect(split.parkingCost).toBe(3);
    expect(split.baseTripContribution).toBeCloseTo(3);
    expect(split.detourCost).toBeCloseTo(1);
    expect(split.passengerContribution).toBeCloseTo(4);
  });
});

describe('formatDollars', () => {
  it('rounds to cents', () => {
    expect(formatDollars(4.256)).toBe('$4.26');
  });
});
