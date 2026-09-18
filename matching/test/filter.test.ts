import { windowsOverlap, hardFilter, corridorDetourKm } from '../src/filter';
import { DEFAULT_CONFIG } from '../src/types';
import { CAMPUS, at, makeOffer, makeRequest, ring } from './fixtures';

const near = ring(1, 3)[0];

describe('time windows (KEY-133)', () => {
  it('accepts the overlapping example from the ticket', () => {
    const r = makeRequest({ reqId: 'r', start: near, travelWindow: { start: at(8), end: at(8, 30) } });
    const o = makeOffer({ offerId: 'o', start: near, travelWindow: { start: at(8, 15), end: at(8, 45) } });
    expect(windowsOverlap(r, o)).toBe(true);
  });
  it('rejects the non-overlapping example from the ticket', () => {
    const r = makeRequest({ reqId: 'r', start: near, travelWindow: { start: at(8), end: at(8, 30) } });
    const o = makeOffer({ offerId: 'o', start: near, travelWindow: { start: at(9), end: at(9, 30) } });
    expect(windowsOverlap(r, o)).toBe(false);
  });
  it('treats touching endpoints as overlapping', () => {
    const r = makeRequest({ reqId: 'r', start: near, travelWindow: { start: at(8), end: at(8, 30) } });
    const o = makeOffer({ offerId: 'o', start: near, travelWindow: { start: at(8, 30), end: at(9) } });
    expect(windowsOverlap(r, o)).toBe(true);
  });
});

describe('corridor test', () => {
  it('is near zero for a rider on the driver path', () => {
    const start = { lat: CAMPUS.lat + 0.1, lon: CAMPUS.lon };
    const mid   = { lat: CAMPUS.lat + 0.05, lon: CAMPUS.lon };
    const r = makeRequest({ reqId: 'r', start: mid });
    const o = makeOffer({ offerId: 'o', start });
    expect(corridorDetourKm(r, o)).toBeLessThan(0.05);
  });
  it('is large for a rider behind the driver', () => {
    const start = { lat: CAMPUS.lat + 0.05, lon: CAMPUS.lon };
    const behind = { lat: CAMPUS.lat + 0.20, lon: CAMPUS.lon };
    const r = makeRequest({ reqId: 'r', start: behind });
    const o = makeOffer({ offerId: 'o', start });
    expect(corridorDetourKm(r, o)).toBeGreaterThan(5);
  });
});

describe('closed trips are excluded (KEY-137)', () => {
  it('rejects every pair on a trip the driver closed', () => {
    const r = makeRequest({ reqId: 'r', start: near });
    const o = makeOffer({ offerId: 'o', start: near, acceptingMore: false });
    const { candidates, rejected } = hardFilter([r], [o], DEFAULT_CONFIG, at(9), at(0));
    expect(candidates).toHaveLength(0);
    expect(rejected[0].reason).toBe('DRIVER_CLOSED');
  });
});
