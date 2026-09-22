import { deriveRiderMaxDetour } from '../src/riderPolicy';
import { DEFAULT_CONFIG } from '../src/types';

const cfg = DEFAULT_CONFIG;

describe('deriveRiderMaxDetour', () => {
  test('scales with the rider’s own direct trip', () => {
    // The whole point of a percentage: a long trip earns a bigger allowance.
    expect(deriveRiderMaxDetour(30, cfg)).toBeCloseTo(12);
    expect(deriveRiderMaxDetour(60, cfg)).toBeCloseTo(24);
  });

  test('never falls below the floor on short trips', () => {
    // 40% of 6 minutes is 2.4 — tight enough that no insertion would fit.
    expect(deriveRiderMaxDetour(6, cfg)).toBe(cfg.riderDetourFloorMinutes);
    expect(deriveRiderMaxDetour(1, cfg)).toBe(cfg.riderDetourFloorMinutes);
  });

  test('the floor and the percentage cross over where they should', () => {
    // Below 12.5 min the floor binds; above it the percentage does.
    const crossover = cfg.riderDetourFloorMinutes / cfg.riderDetourPercent;
    expect(deriveRiderMaxDetour(crossover - 1, cfg)).toBe(cfg.riderDetourFloorMinutes);
    expect(deriveRiderMaxDetour(crossover + 1, cfg)).toBeGreaterThan(cfg.riderDetourFloorMinutes);
  });

  test('degenerate direct times fall back to the floor rather than 0 or NaN', () => {
    // A zero or NaN cap would silently make every insertion infeasible (or,
    // worse, every insertion feasible) rather than failing loudly.
    expect(deriveRiderMaxDetour(0, cfg)).toBe(cfg.riderDetourFloorMinutes);
    expect(deriveRiderMaxDetour(-5, cfg)).toBe(cfg.riderDetourFloorMinutes);
    expect(deriveRiderMaxDetour(Number.NaN, cfg)).toBe(cfg.riderDetourFloorMinutes);
    expect(deriveRiderMaxDetour(Number.POSITIVE_INFINITY, cfg)).toBe(cfg.riderDetourFloorMinutes);
  });

  test('always returns a positive, finite number', () => {
    for (const d of [0, 1, 5, 12.5, 30, 120, Number.NaN, -1]) {
      const out = deriveRiderMaxDetour(d, cfg);
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBeGreaterThan(0);
    }
  });

  test('honours an overridden policy', () => {
    const strict = { riderDetourPercent: 0.15, riderDetourFloorMinutes: 2 };
    expect(deriveRiderMaxDetour(40, strict)).toBeCloseTo(6);
    expect(deriveRiderMaxDetour(4, strict)).toBe(2);
  });

  test('the shipped default is the measured 40% / 5 min', () => {
    // Pinned deliberately: these numbers came from a measured sweep
    // (see riderPolicy.ts), so a casual change should break a test.
    expect(cfg.riderDetourPercent).toBe(0.40);
    expect(cfg.riderDetourFloorMinutes).toBe(5);
  });
});
