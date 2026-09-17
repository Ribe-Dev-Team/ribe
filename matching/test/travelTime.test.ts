import {
  buildGoogleTravelTimeMatrix, PrecomputedTravelTime, SyntheticTravelTime,
} from '../src/travelTime';
import { CAMPUS } from './fixtures';

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
