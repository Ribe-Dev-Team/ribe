import { bearingDegrees, bearingDifference, haversineKm } from '../src/geo';
import { CAMPUS } from './fixtures';

describe('haversine', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(CAMPUS, CAMPUS)).toBeCloseTo(0, 6);
  });
  it('matches a known one-degree-of-latitude distance', () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 1, lon: 0 };
    expect(haversineKm(a, b)).toBeCloseTo(111.19, 1);
  });
});

describe('bearing (KEY-135)', () => {
  it('reads 0 for due north and 90 for due east', () => {
    expect(bearingDegrees({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 3);
    expect(bearingDegrees({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 3);
  });
  it('stays within [0,360)', () => {
    const b = bearingDegrees({ lat: 1, lon: 1 }, { lat: 0, lon: 0 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });

  // KEY-135 explicitly calls out the wraparound case.
  it('treats 350 and 10 as 20 degrees apart, not 340', () => {
    expect(bearingDifference(350, 10)).toBeCloseTo(20, 6);
    expect(bearingDifference(10, 350)).toBeCloseTo(20, 6);
  });
  it('never exceeds 180', () => {
    for (let a = 0; a < 360; a += 17)
      for (let b = 0; b < 360; b += 23)
        expect(bearingDifference(a, b)).toBeLessThanOrEqual(180 + 1e-9);
  });
});
