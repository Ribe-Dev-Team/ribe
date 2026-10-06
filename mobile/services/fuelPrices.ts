// Median fuel price lookup via the Victorian Government's Servo Saver public API.
// The key isn't issued yet, so without EXPO_PUBLIC_SERVO_SAVER_API_KEY every call returns
// FALLBACK_FUEL_PRICE and cost splitting still works end to end.
//
// TODO: once the key arrives, check the endpoint, headers and response shape below against the
// Servo Saver API docs - they're written from the published spec but haven't been exercised yet.

export const SERVO_SAVER_API_KEY = process.env['EXPO_PUBLIC_SERVO_SAVER_API_KEY'] ?? '';

const SERVO_SAVER_PRICES_URL = 'https://api.fuel.service.vic.gov.au/open-data/v1/fuel/prices';

// Rough Melbourne median for unleaded 91 (c/L). Only used when the API is unavailable.
export const FALLBACK_FUEL_PRICE = 190;

// Servo Saver data is refreshed on a delay anyway, so there's no point refetching more often.
const CACHE_TTL_MS = 60 * 60 * 1000;

export type FuelType = 'U91' | 'P95' | 'P98' | 'E10' | 'DSL';

export interface MedianFuelPrice {
  price: number; // c/L
  fuelType: FuelType;
  source: 'servo-saver' | 'fallback';
}

interface ServoSaverPrice {
  fuelType?: string;
  price?: number;
  isAvailable?: boolean;
}

interface ServoSaverStation {
  fuelPrices?: ServoSaverPrice[];
}

const cache = new Map<FuelType, { value: MedianFuelPrice; fetchedAt: number }>();

export function isFuelPricesConfigured(): boolean {
  return SERVO_SAVER_API_KEY.length > 0;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Pulls every available price for `fuelType` out of a Servo Saver /fuel/prices response.
export function extractPrices(json: unknown, fuelType: FuelType): number[] {
  const stations: ServoSaverStation[] = (json as { fuelPriceDetails?: ServoSaverStation[] })?.fuelPriceDetails ?? [];
  return stations.flatMap((station) =>
    (station.fuelPrices ?? [])
      .filter((entry) => entry.fuelType === fuelType && entry.isAvailable !== false)
      .map((entry) => entry.price)
      .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0),
  );
}

function fallback(fuelType: FuelType): MedianFuelPrice {
  return { price: FALLBACK_FUEL_PRICE, fuelType, source: 'fallback' };
}

function transactionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function fetchMedianFuelPrice(fuelType: FuelType = 'U91'): Promise<MedianFuelPrice> {
  if (!isFuelPricesConfigured()) return fallback(fuelType);

  const cached = cache.get(fuelType);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.value;

  try {
    const response = await fetch(SERVO_SAVER_PRICES_URL, {
      headers: {
        'x-consumer-id': SERVO_SAVER_API_KEY,
        'x-transactionid': transactionId(),
      },
    });
    if (!response.ok) throw new Error(`Servo Saver responded with ${response.status}`);

    const price = median(extractPrices(await response.json(), fuelType));
    if (price === null) return fallback(fuelType);

    const value: MedianFuelPrice = { price, fuelType, source: 'servo-saver' };
    cache.set(fuelType, { value, fetchedAt: Date.now() });
    return value;
  } catch (err) {
    console.warn('Fuel price lookup failed:', err);
    return fallback(fuelType);
  }
}

// Test hook - the cache is module-level so it otherwise leaks between tests.
export function clearFuelPriceCache() {
  cache.clear();
}
