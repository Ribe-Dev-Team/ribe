/*
Live check against the real Servo Saver API (Victorian Government fuel prices)
- `npm run test:live`. Not part of `npm test`: it needs the key and network
access. Free, unlike the Google checks beside it.

The other fuel-price tests run against a response shaped from the published
spec, so they prove the client reads that shape. This proves the spec matches
the real API: the key is accepted, and the response really is read into a
median the way the matching runner uses it. Bounds are loose on purpose -
prices move.
*/
import { fetchMedianFuelPrice } from '../../backend/server/costSplitting/fuelPrices';
import { envValue } from '../../backend/server/matching/runner/env';

describe('Servo Saver API (live)', () => {
  const apiKey = envValue('SERVO_SAVER_API_KEY', 'EXPO_PUBLIC_SERVO_SAVER_API_KEY');

  it('accepts the key and returns a plausible Melbourne median for unleaded 91', async () => {
    if (!apiKey) {
      throw new Error('No Servo Saver key: set SERVO_SAVER_API_KEY in backend/.env, or EXPO_PUBLIC_SERVO_SAVER_API_KEY in mobile/.env');
    }
    // A failed call falls back silently in the app; here it must not.
    const warn = jest.spyOn(console, 'warn');

    const fuel = await fetchMedianFuelPrice({ apiKey });

    expect(warn).not.toHaveBeenCalled();
    expect(fuel.source).toBe('servo-saver');
    expect(fuel.fuelType).toBe('U91');
    // c/L - a real median, not the fallback's guess.
    expect(fuel.price).toBeGreaterThan(120);
    expect(fuel.price).toBeLessThan(400);
  });

  it('returns a median for the other fuel types the runner can ask for', async () => {
    if (!apiKey) return;
    for (const fuelType of ['P95', 'P98', 'E10', 'DSL'] as const) {
      const fuel = await fetchMedianFuelPrice({ apiKey, fuelType });
      expect(fuel).toMatchObject({ source: 'servo-saver', fuelType });
    }
  });
});
