/*
Tests the ride details map's two Google pieces, with no network:

  fetchRoutePolyline   asks the Routes API for the road route through the
                       points, and gives up quietly (null) on any failure
  staticMapUrl         the Static Maps image: a marker per point - A, numbered
                       stops, B - and the route when there is one
*/

import { fetchRoutePolyline } from '../../mobile/services/googleRoutes';
import { staticMapUrl } from '../../mobile/components/RideMap';
import { RideMapPoint } from '../../mobile/services/rideData';

const points: RideMapPoint[] = [
  { lat: -37.8, lng: 145.0, label: 'Your start', kind: 'start' },
  { lat: -37.85, lng: 145.05, label: 'Sam', kind: 'stop' },
  { lat: -37.91, lng: 145.13, label: 'Monash', kind: 'end' },
];

const respond = (ok: boolean, body: unknown) =>
  jest.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch;

describe('fetchRoutePolyline', () => {
  it('returns the encoded route through every point, in order', async () => {
    const fetchImpl = respond(true, { routes: [{ polyline: { encodedPolyline: 'abc123' } }] });

    await expect(fetchRoutePolyline(points, 'key', fetchImpl)).resolves.toBe('abc123');

    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(init.headers).toMatchObject({ 'X-Goog-Api-Key': 'key', 'X-Goog-FieldMask': 'routes.polyline.encodedPolyline' });
    const body = JSON.parse(init.body);
    expect(body.origin.location.latLng).toEqual({ latitude: -37.8, longitude: 145.0 });
    expect(body.intermediates).toHaveLength(1);
    expect(body.destination.location.latLng).toEqual({ latitude: -37.91, longitude: 145.13 });
    expect(body.routingPreference).toBe('TRAFFIC_UNAWARE');
  });

  it('gives null, so the map shows points alone, when the Routes API refuses or finds nothing', async () => {
    await expect(fetchRoutePolyline(points, 'key', respond(false, {}))).resolves.toBeNull();
    await expect(fetchRoutePolyline(points, 'key', respond(true, { routes: [] }))).resolves.toBeNull();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(fetchRoutePolyline(points, 'key', jest.fn().mockRejectedValue(new Error('offline')))).resolves.toBeNull();
    warn.mockRestore();
  });

  it("doesn't call Google without a key or with fewer than two points", async () => {
    const fetchImpl = respond(true, {});
    await expect(fetchRoutePolyline(points, '', fetchImpl)).resolves.toBeNull();
    await expect(fetchRoutePolyline(points.slice(0, 1), 'key', fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('staticMapUrl', () => {
  const markersOf = (url: string) => new URL(url).searchParams.getAll('markers');

  it('marks the start A, each stop by number, and the end B', () => {
    const url = staticMapUrl(points, null, 'key');

    expect(url.startsWith('https://maps.googleapis.com/maps/api/staticmap?')).toBe(true);
    expect(markersOf(url)).toEqual([
      expect.stringMatching(/label:A\|-37\.8,145$/),
      expect.stringMatching(/label:1\|-37\.85,145\.05$/),
      expect.stringMatching(/label:B\|-37\.91,145\.13$/),
    ]);
    expect(new URL(url).searchParams.get('path')).toBeNull();
  });

  it('draws the route when there is one', () => {
    const path = new URL(staticMapUrl(points, 'abc123', 'key')).searchParams.get('path');
    expect(path).toMatch(/enc:abc123$/);
  });

  it('drops a route too long for Static Maps rather than losing the map', () => {
    const url = staticMapUrl(points, 'x'.repeat(20_000), 'key');
    expect(new URL(url).searchParams.get('path')).toBeNull();
    expect(markersOf(url)).toHaveLength(3);
  });
});
