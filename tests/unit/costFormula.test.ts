import {
  fuelCostDollars,
  calcDetourDistance,
  calcBaseTripContribution,
  calcDetourCost,
  calcPassengerContribution,
  calcCostSplit,
} from '../../backend/server/costSplitting/formula';

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

  it.each([0, -1, 1.5])('rejects %p participants', (tripParticipants) => {
    expect(() => calcBaseTripContribution({ ...base, tripParticipants })).toThrow();
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
    expect(calcPassengerContribution({ ...base, detourDistanceKm: 5 })).toBeCloseTo(1 + 2);
  });
});

describe('calcCostSplit', () => {
  it('returns a consistent breakdown', () => {
    const split = calcCostSplit({ ...base, detourDistanceKm: 5 });
    expect(split).toEqual({
      fuelCost: expect.closeTo(6),
      baseTripContribution: expect.closeTo(2),
      detourCost: expect.closeTo(1),
      passengerContribution: expect.closeTo(3),
    });
  });
});
