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
 * In-memory TravelTimeMatrix backed by one batch of Google travel times.
 *
 * Built once per matching run by `buildRoutesTravelTimeMatrix` (or the legacy
 * `buildGoogleTravelTimeMatrix`); every
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
      `waypoint to the matrix builder, or supply a fallback.`,
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
 * LEGACY - prefer `buildRoutesTravelTimeMatrix`. Google made the Distance Matrix
 * API a legacy service on 1 March 2025 and it cannot be enabled on Cloud
 * projects created since, where every call fails with REQUEST_DENIED. Kept for
 * keys on older projects that still have it enabled.
 *
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

export interface RoutesMatrixOptions {
  apiKey: string;
  /** Origins-per-request and destinations-per-request. 10x10 = 100 elements,
   *  under every Route Matrix cap (625 for plain driving, 100 for
   *  TRAFFIC_AWARE_OPTIMAL), so the default never trips a limit. */
  chunkSize?: number;
  /** Injectable for tests / non-global fetch runtimes. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Overridable for tests. Defaults to the real computeRouteMatrix endpoint. */
  baseUrl?: string;
  /** Used for a leg Google couldn't route. Omit to throw lazily instead, only
   *  if that leg is ever actually looked up. */
  fallback?: TravelTimeMatrix;
}

/** One element of a computeRouteMatrix response. `status` is an empty object
 *  on success; indices are typed optional because proto3 JSON may omit a 0. */
interface RouteMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  status?: { code?: number; message?: string };
  condition?: string;
  duration?: string; // e.g. "712s"
}

/**
 * Same contract as `buildGoogleTravelTimeMatrix`, on the Routes API that
 * replaced Distance Matrix: one POST to computeRouteMatrix per chunk pair
 * covering `points` x `points`, and a TravelTimeMatrix that answers every
 * lookup between them from memory. No API calls happen inside a matching run.
 *
 * Uses TRAFFIC_UNAWARE on purpose. A batch covers a whole day of departures, so
 * no single departure time describes every leg, and live traffic for "now" is
 * wrong for a trip tomorrow morning. It is also the cheapest Route Matrix tier.
 *
 * Cost scales with the square of the point count, which is why the runner builds
 * one matrix per batch (a day in one direction) rather than across batches.
 */
export async function buildRoutesTravelTimeMatrix(
  points: Coord[],
  opts: RoutesMatrixOptions,
): Promise<PrecomputedTravelTime> {
  const uniquePoints = dedupePoints(points);
  const chunks = chunkPoints(uniquePoints, opts.chunkSize ?? 10);
  const doFetch = opts.fetchImpl ?? fetch;
  const url = opts.baseUrl ?? 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

  const asWaypoint = (c: Coord) => ({
    waypoint: { location: { latLng: { latitude: c.lat, longitude: c.lon } } },
  });

  const table = new Map<string, number>();
  for (const origins of chunks) {
    for (const destinations of chunks) {
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': opts.apiKey,
          'X-Goog-FieldMask': 'originIndex,destinationIndex,status,condition,duration',
        },
        body: JSON.stringify({
          origins: origins.map(asWaypoint),
          destinations: destinations.map(asWaypoint),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_UNAWARE',
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Route Matrix request failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
      }

      const body: unknown = await res.json();
      if (!Array.isArray(body)) throw new Error('Route Matrix returned something other than an element list');

      for (const el of body as RouteMatrixElement[]) {
        // Unroutable legs are left out, exactly like the legacy client:
        // PrecomputedTravelTime falls back or throws only if one is looked up.
        if (el.condition !== 'ROUTE_EXISTS' || (el.status?.code ?? 0) !== 0 || !el.duration) continue;
        const from = origins[el.originIndex ?? 0];
        const to = destinations[el.destinationIndex ?? 0];
        if (from && to) table.set(key(from, to), parseFloat(el.duration) / 60);
      }
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
