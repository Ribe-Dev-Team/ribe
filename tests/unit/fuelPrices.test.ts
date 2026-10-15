import {
  median,
  extractPrices,
  fetchMedianFuelPrice,
  FALLBACK_FUEL_PRICE,
} from '../../backend/server/costSplitting/fuelPrices';

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

describe('fetchMedianFuelPrice', () => {
  const fallback = { price: FALLBACK_FUEL_PRICE, fuelType: 'U91', source: 'fallback' };
  const respond = (body: unknown, ok = true) =>
    jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as typeof fetch;

  it('falls back to the default price without calling the API when there is no key', async () => {
    const fetchImpl = respond({});
    await expect(fetchMedianFuelPrice({ fetchImpl })).resolves.toEqual(fallback);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the median of the live prices, sending the key as the consumer id', async () => {
    const fetchImpl = respond({
      fuelPriceDetails: [{ fuelPrices: [{ fuelType: 'U91', price: 180 }, { fuelType: 'U91', price: 200 }] }],
    });
    await expect(fetchMedianFuelPrice({ apiKey: 'key', fetchImpl }))
      .resolves.toEqual({ price: 190, fuelType: 'U91', source: 'servo-saver' });
    const [, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(init.headers['x-consumer-id']).toBe('key');
  });

  it('falls back when the API fails or has no prices, rather than stopping the run', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(fetchMedianFuelPrice({ apiKey: 'key', fetchImpl: respond({}, false) })).resolves.toEqual(fallback);
    await expect(fetchMedianFuelPrice({ apiKey: 'key', fetchImpl: respond({ fuelPriceDetails: [] }) })).resolves.toEqual(fallback);
    warn.mockRestore();
  });
});
