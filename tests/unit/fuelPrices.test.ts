import {
  median,
  extractPrices,
  fetchMedianFuelPrice,
  isFuelPricesConfigured,
  FALLBACK_FUEL_PRICE,
} from '../../mobile/services/fuelPrices';

describe('median', () => {
  it('returns null for no prices', () => {
    expect(median([])).toBeNull();
  });

  it('picks the middle of an odd list', () => {
    expect(median([210, 180, 195])).toBe(195);
  });

  it('averages the middle pair of an even list', () => {
    expect(median([180, 200, 190, 210])).toBe(195);
  });
});

describe('extractPrices', () => {
  const response = {
    fuelPriceDetails: [
      { fuelPrices: [{ fuelType: 'U91', price: 189.9, isAvailable: true }, { fuelType: 'DSL', price: 199.9, isAvailable: true }] },
      { fuelPrices: [{ fuelType: 'U91', price: 0, isAvailable: true }] },
      { fuelPrices: [{ fuelType: 'U91', price: 179.9, isAvailable: false }] },
      { fuelPrices: [{ fuelType: 'U91', price: 192.5 }] },
      {},
    ],
  };

  it('keeps only available, valid prices for the requested fuel', () => {
    expect(extractPrices(response, 'U91')).toEqual([189.9, 192.5]);
  });

  it('tolerates an unexpected response shape', () => {
    expect(extractPrices(null, 'U91')).toEqual([]);
    expect(extractPrices({ something: 'else' }, 'U91')).toEqual([]);
  });
});

describe('fetchMedianFuelPrice without an API key', () => {
  it('falls back to the default price without calling the API', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    expect(isFuelPricesConfigured()).toBe(false);
    await expect(fetchMedianFuelPrice()).resolves.toEqual({ price: FALLBACK_FUEL_PRICE, fuelType: 'U91', source: 'fallback' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
