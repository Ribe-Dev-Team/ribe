/*
Tests src/travelTime.ts - the two Google clients that fetch travel times. No
network: each client gets a fake `fetch` answering in Google's documented
format, so these prove a client handles that format, not that Google still
uses it - `npm run test:live` checks the real APIs.

  buildGoogleTravelTimeMatrix   legacy Distance Matrix client
  buildRoutesTravelTimeMatrix   Routes API client (the runner's default)

For both: converting Google's durations to minutes, request shape, removing
duplicate points, splitting big requests into chunks, what happens to a leg
Google can't route, and errors.

Not tested here: SyntheticTravelTime itself, though most other test files use it.
*/

import {
  buildGoogleTravelTimeMatrix, buildRoutesTravelTimeMatrix, PrecomputedTravelTime, SyntheticTravelTime,
} from '../travelTime';
import { CAMPUS } from '../fixtures';

const A = CAMPUS;
const B = { lat: CAMPUS.lat + 0.05, lon: CAMPUS.lon };
const C = { lat: CAMPUS.lat, lon: CAMPUS.lon + 0.05 };

/** Fakes the Distance Matrix JSON shape: one row per origin, one element per
 *  destination, in the same order they were sent. `seconds(a, b)` lets each
 *  test control exactly what "Google" answers for a given leg. */
function fakeFetch(seconds: (originIdx: number, destIdx: number) => number | null) {
  const calls: string[] = [];
  const impl = (jest.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const origins = u.searchParams.get('origins')!.split('|');
    const destinations = u.searchParams.get('destinations')!.split('|');
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        status: 'OK',
        rows: origins.map((_, i) => ({
          elements: destinations.map((_, j) => {
            const s = seconds(i, j);
            return s === null
              ? { status: 'ZERO_RESULTS' }
              : { status: 'OK', duration: { value: s } };
          }),
        })),
      }),
    };
  }) as unknown) as typeof fetch;
  return { impl, calls };
}

describe('buildGoogleTravelTimeMatrix', () => {
  it('answers minutes() from the batched response, converting seconds to minutes', async () => {
    const { impl } = fakeFetch(() => 600); // 10 minutes, every leg

    const t = await buildGoogleTravelTimeMatrix([A, B, C], { apiKey: 'k', fetchImpl: impl });

    expect(t).toBeInstanceOf(PrecomputedTravelTime);
    expect(t.minutes(A, B)).toBeCloseTo(10, 6);
    expect(t.minutes(B, C)).toBeCloseTo(10, 6);
  });

  it('dedupes repeated points before building the matrix', async () => {
    const { impl, calls } = fakeFetch(() => 60);

    // CAMPUS appears three times, as it would when many trips share it.
    await buildGoogleTravelTimeMatrix([A, A, B, A, B], { apiKey: 'k', fetchImpl: impl });

    // Only 2 unique points -> a single 2x2 request, well under chunkSize.
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]);
    expect(u.searchParams.get('origins')!.split('|')).toHaveLength(2);
  });

  it('chunks origins and destinations to stay under the per-request cap', async () => {
    const points = Array.from({ length: 25 }, (_, i) => ({
      lat: CAMPUS.lat + i * 0.001, lon: CAMPUS.lon,
    }));
    const { impl, calls } = fakeFetch(() => 60);

    await buildGoogleTravelTimeMatrix(points, { apiKey: 'k', fetchImpl: impl, chunkSize: 10 });

    // 25 points / chunkSize 10 -> 3 chunks each side -> 9 requests, none over 10x10.
    expect(calls).toHaveLength(9);
    for (const url of calls) {
      const u = new URL(url);
      expect(u.searchParams.get('origins')!.split('|').length).toBeLessThanOrEqual(10);
      expect(u.searchParams.get('destinations')!.split('|').length).toBeLessThanOrEqual(10);
    }
  });

  it('omits legs Google could not route, and falls back to the supplied matrix for them', async () => {
    const { impl } = fakeFetch((i, j) => (i === 0 && j === 1 ? null : 120));
    const fallback = new SyntheticTravelTime({ jitter: 0 });

    const t = await buildGoogleTravelTimeMatrix([A, B], { apiKey: 'k', fetchImpl: impl, fallback });

    expect(t.minutes(B, A)).toBeCloseTo(2, 6); // routed leg: 120s
    expect(t.minutes(A, B)).toBeCloseTo(fallback.minutes(A, B), 6); // ZERO_RESULTS leg
  });

  it('throws on lookup for an unrouted leg when no fallback was given', async () => {
    const { impl } = fakeFetch(() => null);

    const t = await buildGoogleTravelTimeMatrix([A, B], { apiKey: 'k', fetchImpl: impl });

    expect(() => t.minutes(A, B)).toThrow(/No travel time for leg/);
  });

  it('throws when the API-level status is not OK', async () => {
    const impl = (jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ status: 'REQUEST_DENIED', error_message: 'bad key', rows: [] }),
    })) as unknown) as typeof fetch;

    await expect(
      buildGoogleTravelTimeMatrix([A, B], { apiKey: 'bad', fetchImpl: impl }),
    ).rejects.toThrow(/REQUEST_DENIED/);
  });

  it('throws when the HTTP response itself is not ok', async () => {
    const impl = (jest.fn(async () => ({
      ok: false, status: 500, statusText: 'Internal Server Error',
    })) as unknown) as typeof fetch;

    await expect(
      buildGoogleTravelTimeMatrix([A, B], { apiKey: 'k', fetchImpl: impl }),
    ).rejects.toThrow(/500/);
  });
});

/** Fakes computeRouteMatrix: a POSTed JSON body in, a flat element list out, in
 *  Google's documented shape (empty `status` on success, duration as "123s"). */
function fakeRoutesFetch(seconds: (originIdx: number, destIdx: number) => number | null) {
  const calls: Array<{ url: string; init: RequestInit; body: any; }> = [];
  const impl = (jest.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    calls.push({ url, init, body });
    const elements = body.origins.flatMap((_: unknown, i: number) =>
      body.destinations.map((_: unknown, j: number) => {
        const s = seconds(i, j);
        return s === null
          ? { originIndex: i, destinationIndex: j, status: {}, condition: 'ROUTE_NOT_FOUND' }
          : { originIndex: i, destinationIndex: j, status: {}, condition: 'ROUTE_EXISTS', duration: `${s}s` };
      }));
    return { ok: true, status: 200, statusText: 'OK', json: async () => elements, text: async () => '' };
  }) as unknown) as typeof fetch;
  return { impl, calls };
}

describe('buildRoutesTravelTimeMatrix', () => {
  it('answers minutes() from the matrix, converting "Ns" durations to minutes', async () => {
    const { impl } = fakeRoutesFetch((i, j) => (i === j ? 0 : 600));

    const t = await buildRoutesTravelTimeMatrix([A, B, C], { apiKey: 'k', fetchImpl: impl });

    expect(t.minutes(A, B)).toBeCloseTo(10, 6);
    expect(t.minutes(C, A)).toBeCloseTo(10, 6);
    expect(t.minutes(B, B)).toBe(0);
  });

  it('sends the key and field mask as headers, and lat/lng waypoints in the body', async () => {
    const { impl, calls } = fakeRoutesFetch(() => 60);

    await buildRoutesTravelTimeMatrix([A, B], { apiKey: 'secret', fetchImpl: impl });

    expect(calls).toHaveLength(1);
    const { url, init, body } = calls[0];
    expect(url).toBe('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'X-Goog-Api-Key': 'secret',
      'X-Goog-FieldMask': 'originIndex,destinationIndex,status,condition,duration',
    });
    expect(body.travelMode).toBe('DRIVE');
    expect(body.origins[1]).toEqual({ waypoint: { location: { latLng: { latitude: B.lat, longitude: B.lon } } } });
  });

  it('reads a response that leaves out zero indices', async () => {
    const impl = (jest.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      json: async () => [
        { status: {}, condition: 'ROUTE_EXISTS', duration: '0s' },
        { destinationIndex: 1, status: {}, condition: 'ROUTE_EXISTS', duration: '300s' },
        { originIndex: 1, status: {}, condition: 'ROUTE_EXISTS', duration: '240s' },
        { originIndex: 1, destinationIndex: 1, status: {}, condition: 'ROUTE_EXISTS', duration: '0s' },
      ],
    })) as unknown) as typeof fetch;

    const t = await buildRoutesTravelTimeMatrix([A, B], { apiKey: 'k', fetchImpl: impl });

    expect(t.minutes(A, B)).toBeCloseTo(5, 6);
    expect(t.minutes(B, A)).toBeCloseTo(4, 6);
  });

  it('dedupes and chunks exactly like the legacy client', async () => {
    const points = Array.from({ length: 25 }, (_, i) => ({ lat: CAMPUS.lat + i * 0.001, lon: CAMPUS.lon }));
    const { impl, calls } = fakeRoutesFetch(() => 60);

    await buildRoutesTravelTimeMatrix([...points, ...points], { apiKey: 'k', fetchImpl: impl, chunkSize: 10 });

    expect(calls).toHaveLength(9);
    for (const { body } of calls) {
      expect(body.origins.length * body.destinations.length).toBeLessThanOrEqual(100);
    }
  });

  it('leaves out legs with no route, falling back or throwing only on lookup', async () => {
    const { impl } = fakeRoutesFetch((i, j) => (i === 0 && j === 1 ? null : 120));
    const fallback = new SyntheticTravelTime({ jitter: 0 });

    const withFallback = await buildRoutesTravelTimeMatrix([A, B], { apiKey: 'k', fetchImpl: impl, fallback });
    expect(withFallback.minutes(B, A)).toBeCloseTo(2, 6);
    expect(withFallback.minutes(A, B)).toBeCloseTo(fallback.minutes(A, B), 6);

    const without = await buildRoutesTravelTimeMatrix([A, B], { apiKey: 'k', fetchImpl: impl });
    expect(() => without.minutes(A, B)).toThrow(/No travel time for leg/);
  });

  it('treats an element carrying an error status as unrouted', async () => {
    const impl = (jest.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      json: async () => [{ originIndex: 0, destinationIndex: 1, status: { code: 5 }, condition: 'ROUTE_EXISTS', duration: '60s' }],
    })) as unknown) as typeof fetch;

    const t = await buildRoutesTravelTimeMatrix([A, B], { apiKey: 'k', fetchImpl: impl });
    expect(() => t.minutes(A, B)).toThrow(/No travel time for leg/);
  });

  it("throws with Google's explanation when the request is refused", async () => {
    const impl = (jest.fn(async () => ({
      ok: false, status: 403, statusText: 'Forbidden',
      text: async () => 'Routes API has not been used in project 123 before or it is disabled.',
    })) as unknown) as typeof fetch;

    await expect(buildRoutesTravelTimeMatrix([A, B], { apiKey: 'k', fetchImpl: impl }))
      .rejects.toThrow(/403.*Routes API has not been used/);
  });
});
