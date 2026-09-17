import { Coord, TravelTimeMatrix } from './types';
import { haversineKm } from './geo';

/** Ordered-pair cache key, shared by every TravelTimeMatrix implementation in
 *  this file so a leg computed one way is never missed by a lookup done another. */
export const legKey = (a: Coord, b: Coord) =>
  `${a.lat.toFixed(6)},${a.lon.toFixed(6)}|${b.lat.toFixed(6)},${b.lon.toFixed(6)}`;

const key = legKey;

export interface SyntheticOptions {
  roadFactor?: number;   // straight-line km -> road km
  avgSpeedKmh?: number;
  jitter?: number;       // +/- proportion applied per leg
  seed?: number;
}

/**
 * Stand-in for Google Distance Matrix.
 *
 * Straight-line distance x road factor, converted at an average urban speed,
 * with deterministic per-leg noise so the algorithm meets cases where road
 * distance diverges from straight line. Noise is cached per ordered pair, so
 * repeated lookups of the same leg agree with themselves — without that,
 * feasibility checks would be non-deterministic within a single run.
 *
 * Asymmetric by construction (a->b need not equal b->a), which is also true
 * of real road networks.
 */
export class SyntheticTravelTime implements TravelTimeMatrix {
  private readonly roadFactor: number;
  private readonly avgSpeedKmh: number;
  private readonly jitter: number;
  private readonly seed: number;
  private readonly cache = new Map<string, number>();

  constructor(opts: SyntheticOptions = {}) {
    this.roadFactor = opts.roadFactor ?? 1.4;
    this.avgSpeedKmh = opts.avgSpeedKmh ?? 40;
    this.jitter = opts.jitter ?? 0.15;
    this.seed = opts.seed ?? 20260917;
  }

  minutes(a: Coord, b: Coord): number {
    const k = key(a, b);
    const hit = this.cache.get(k);
    if (hit !== undefined) return hit;

    const km = haversineKm(a, b) * this.roadFactor;
    const base = (km / this.avgSpeedKmh) * 60;

    // Noise is attached to the POINT PAIR via a hash of its coordinates, not
    // drawn fresh per call, and it only ever slows a leg down (never speeds it
    // up). Independent two-sided noise per leg lets a detour come out faster
    // than the direct route, which is geometrically impossible and quietly
    // produces negative detours in the statistics.
    const mins = base * (1 + this.hashUnit(k) * this.jitter);

    this.cache.set(k, mins);
    return mins;
  }

  /** Deterministic value in [0,1) derived from the leg itself, offset by seed. */
  private hashUnit(k: string): number {
    let h = this.seed >>> 0;
    for (let i = 0; i < k.length; i++) {
      h = Math.imul(h ^ k.charCodeAt(i), 0x01000193) >>> 0;
    }
    return h / 4294967296;
  }
}

/** Explicit lookup table, for tests that need exact hand-chosen numbers. */
export class FixtureTravelTime implements TravelTimeMatrix {
  constructor(
    private readonly table: Map<string, number>,
    private readonly fallback: TravelTimeMatrix,
  ) {}

  minutes(a: Coord, b: Coord): number {
    return this.table.get(key(a, b)) ?? this.fallback.minutes(a, b);
  }
}

/**
 * In-memory TravelTimeMatrix backed by one Google Distance Matrix batch.
 *
 * Built once per matching run by `buildGoogleTravelTimeMatrix`; every
 * `minutes()` call afterwards is a Map read, per the README: "Build the
 * matrix once per batch and every feasibility check stays in-memory
 * arithmetic — no API calls inside the matching loop."
 */
export class PrecomputedTravelTime implements TravelTimeMatrix {
  constructor(
    private readonly table: Map<string, number>,
    private readonly fallback?: TravelTimeMatrix,
  ) {}

  minutes(a: Coord, b: Coord): number {
    const hit = this.table.get(key(a, b));
    if (hit !== undefined) return hit;
    if (this.fallback) return this.fallback.minutes(a, b);
    throw new Error(
      `No travel time for leg ${key(a, b)}. It wasn't in the point set the ` +
      `matrix was built from — pass every offer start/end and every request ` +
      `waypoint to buildGoogleTravelTimeMatrix, or supply a fallback.`,
    );
  }
}

export interface GoogleDistanceMatrixOptions {
  apiKey: string;
  /** Origins-per-request and destinations-per-request. Google caps a single
   *  Distance Matrix request at 25x25 (625 elements); kept well under that by
   *  default since most quota tiers also cap total elements per request. */
  chunkSize?: number;
  /** Injectable for tests / non-global fetch runtimes. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Overridable for tests. Defaults to the real Distance Matrix endpoint. */
  baseUrl?: string;
  /** Used for a leg Google couldn't route (e.g. ZERO_RESULTS). Omit to throw
   *  lazily instead, only if that leg is ever actually looked up. */
  fallback?: TravelTimeMatrix;
}

interface DistanceMatrixResponse {
  status: string;
  error_message?: string;
  rows: Array<{
    elements: Array<{ status: string; duration?: { value: number } }>;
  }>;
}

/**
 * Calls the Google Distance Matrix API once for every chunk pair covering
 * `points` x `points`, and returns a TravelTimeMatrix that answers every
 * `minutes(a, b)` lookup between them from memory.
 *
 * `points` must include every coordinate this batch's matching run could
 * query: each offer's start and end, each request's `waypointOf(req)`, and
 * each onBoard rider's waypoint. Duplicates (campus shows up constantly) are
 * deduped before any request is made.
 */
export async function buildGoogleTravelTimeMatrix(
  points: Coord[],
  opts: GoogleDistanceMatrixOptions,
): Promise<PrecomputedTravelTime> {
  const uniquePoints = dedupePoints(points);
  const chunkSize = opts.chunkSize ?? 10;
  const doFetch = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? 'https://maps.googleapis.com/maps/api/distancematrix/json';

  const table = new Map<string, number>();
  const originChunks = chunkPoints(uniquePoints, chunkSize);
  const destChunks = chunkPoints(uniquePoints, chunkSize);

  for (const origins of originChunks) {
    for (const destinations of destChunks) {
      const url = buildDistanceMatrixUrl(baseUrl, origins, destinations, opts.apiKey);
      const res = await doFetch(url);
      if (!res.ok) {
        throw new Error(`Distance Matrix request failed: ${res.status} ${res.statusText}`);
      }

      const body = (await res.json()) as DistanceMatrixResponse;
      if (body.status !== 'OK') {
        throw new Error(`Distance Matrix API error: ${body.status}${body.error_message ? ` — ${body.error_message}` : ''}`);
      }

      body.rows.forEach((row, i) => {
        row.elements.forEach((el, j) => {
          // Elements Google couldn't route (e.g. ZERO_RESULTS) are left out of
          // the table on purpose — PrecomputedTravelTime decides at lookup
          // time whether that leg is actually needed, and falls back or throws.
          if (el.status === 'OK' && el.duration) {
            table.set(key(origins[i], destinations[j]), el.duration.value / 60);
          }
        });
      });
    }
  }

  return new PrecomputedTravelTime(table, opts.fallback);
}

function dedupePoints(points: Coord[]): Coord[] {
  const seen = new Map<string, Coord>();
  for (const p of points) {
    seen.set(`${p.lat.toFixed(6)},${p.lon.toFixed(6)}`, p);
  }
  return [...seen.values()];
}

function chunkPoints(points: Coord[], size: number): Coord[][] {
  const out: Coord[][] = [];
  for (let i = 0; i < points.length; i += size) out.push(points.slice(i, i + size));
  return out;
}

function buildDistanceMatrixUrl(
  base: string, origins: Coord[], destinations: Coord[], apiKey: string,
): string {
  const fmt = (c: Coord) => `${c.lat},${c.lon}`;
  const params = new URLSearchParams({
    origins: origins.map(fmt).join('|'),
    destinations: destinations.map(fmt).join('|'),
    mode: 'driving',
    units: 'metric',
    key: apiKey,
  });
  return `${base}?${params.toString()}`;
}
