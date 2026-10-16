// Median fuel price lookup via the Victorian Government's Servo Saver public API.
// The key isn't issued yet, so without one every call returns FALLBACK_FUEL_PRICE
// and cost splitting still works end to end. The runner looks the price up once
// per run (runner/run.ts) and prices every car in that run with it.
//
// TODO: once the key arrives, check the endpoint, headers and response shape below against the
// Servo Saver API docs - they're written from the published spec but haven't been exercised yet.

const SERVO_SAVER_PRICES_URL = 'https://api.fuel.service.vic.gov.au/open-data/v1/fuel/prices';

// Rough Melbourne median for unleaded 91 (c/L). Only used when the API is unavailable.
export const FALLBACK_FUEL_PRICE = 240;

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

export interface FuelPriceOptions {
  /** Servo Saver consumer id. Absent or empty: the fallback price, no call made. */
  apiKey?: string;
  fuelType?: FuelType;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
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

export function fallbackFuelPrice(fuelType: FuelType = 'U91'): MedianFuelPrice {
  return { price: FALLBACK_FUEL_PRICE, fuelType, source: 'fallback' };
}

function transactionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Never throws: any failure is logged and priced at the fallback, so a fuel
 *  API outage never stops a matching run. */
export async function fetchMedianFuelPrice(opts: FuelPriceOptions = {}): Promise<MedianFuelPrice> {
  const fuelType = opts.fuelType ?? 'U91';
  if (!opts.apiKey) return fallbackFuelPrice(fuelType);

  try {
    const response = await (opts.fetchImpl ?? fetch)(SERVO_SAVER_PRICES_URL, {
      headers: {
        'x-consumer-id': opts.apiKey,
        'x-transactionid': transactionId(),
      },
    });
    if (!response.ok) throw new Error(`Servo Saver responded with ${response.status}`);

    const price = median(extractPrices(await response.json(), fuelType));
    return price === null ? fallbackFuelPrice(fuelType) : { price, fuelType, source: 'servo-saver' };
  } catch (err) {
    console.warn('Fuel price lookup failed:', err);
    return fallbackFuelPrice(fuelType);
  }
}
