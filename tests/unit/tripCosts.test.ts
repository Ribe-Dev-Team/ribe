/*
Tests backend/server/costSplitting/tripCosts.ts - pricing a whole car from the
matcher's road distances.

  priceCar        the trip's fuel, everyone's equal share of it, and each rider's
                  own detour: the car's route with them, less without them
  priceSchedule   a stored timetable gets those costs, trip-level and per stop

Distances are a hand-written table, so every expected amount can be checked by
hand. 200 c/L at 10 L/100km is $0.20 a km.
*/

import { priceCar, priceSchedule, Pricing } from '../../backend/server/costSplitting/tripCosts';
import { RoadDistanceMatrix } from '../../backend/server/matching/types';
import { StoredSchedule } from '../../backend/server/matching/writes';
import { Coord } from '../../backend/server/matching.schema';

const point = (lat: number): Coord => ({ lat, lon: 145 });
const HOME = point(1);
const CAMPUS = point(2);
const R1 = point(3);
const R2 = point(4);
const name = new Map([[1, 'HOME'], [2, 'CAMPUS'], [3, 'R1'], [4, 'R2']]);

/** Road km between named points; every leg a test uses is listed. */
function table(legs: Record<string, number>): RoadDistanceMatrix {
  return {
    km: (a, b) => {
      const leg = `${name.get(a.lat)}>${name.get(b.lat)}`;
      if (!(leg in legs)) throw new Error(`no distance for ${leg}`);
      return legs[leg];
    },
  };
}

const pricing: Pricing = { fuel: { price: 200, fuelType: 'U91', source: 'fallback' }, vehicleEconomy: 10 };
const now = new Date('2026-10-01T00:00:00Z');

describe('priceCar', () => {
  it('prices one rider as "via their pickup, minus direct" - the original formula', () => {
    // Direct 30 km; via R1 32 + 3 = 35 km, so R1's detour is 5 km.
    const d = table({ 'HOME>CAMPUS': 30, 'HOME>R1': 32, 'R1>CAMPUS': 3 });

    const { trip, riders } = priceCar(HOME, CAMPUS, [{ reqId: 'r1', waypoint: R1 }], d, pricing, now);

    expect(trip).toMatchObject({
      tripDistanceKm: 30,
      tripParticipants: 2,
      fuelCost: expect.closeTo(6),               // 30 km x $0.20
      baseTripContribution: expect.closeTo(3),   // ÷ 2
      medianFuelPrice: 200,
      fuelType: 'U91',
      fuelSource: 'fallback',
      vehicleEconomy: 10,
      calculatedAt: now,
    });
    expect(riders).toEqual([{
      detourDistanceKm: expect.closeTo(5),
      detourCost: expect.closeTo(1),             // 5 km x $0.20
      passengerContribution: expect.closeTo(4),  // $3 share + $1 detour
    }]);
  });

  it("charges each rider what they add to the car's route, everyone else keeping their order", () => {
    // HOME > R1 > R2 > CAMPUS = 10 + 5 + 20 = 35 km.
    // Without R1: HOME > R2 > CAMPUS = 12 + 20 = 32, so R1 adds 3.
    // Without R2: HOME > R1 > CAMPUS = 10 + 22 = 32, so R2 adds 3.
    const d = table({
      'HOME>CAMPUS': 30, 'HOME>R1': 10, 'R1>R2': 5, 'R2>CAMPUS': 20, 'HOME>R2': 12, 'R1>CAMPUS': 22,
    });

    const { trip, riders } = priceCar(
      HOME, CAMPUS, [{ reqId: 'r1', waypoint: R1 }, { reqId: 'r2', waypoint: R2 }], d, pricing, now,
    );

    expect(trip.tripParticipants).toBe(3);
    expect(trip.baseTripContribution).toBeCloseTo(2); // $6 ÷ 3
    expect(riders.map((r) => r.detourDistanceKm)).toEqual([expect.closeTo(3), expect.closeTo(3)]);
    expect(riders.map((r) => r.passengerContribution)).toEqual([expect.closeTo(2.6), expect.closeTo(2.6)]);
  });

  it('never charges a negative detour when a pickup sits on a shorter road', () => {
    const d = table({ 'HOME>CAMPUS': 30, 'HOME>R1': 14, 'R1>CAMPUS': 15 });

    const { riders } = priceCar(HOME, CAMPUS, [{ reqId: 'r1', waypoint: R1 }], d, pricing, now);

    expect(riders[0].detourDistanceKm).toBe(0);
    expect(riders[0].detourCost).toBe(0);
  });
});

describe('priceSchedule', () => {
  const at = new Date('2026-10-05T21:00:00Z');
  const schedule: StoredSchedule = {
    departAt: at,
    arriveAt: at,
    stops: [{ requestId: 'r1', pickupAt: at, arriveAt: at }],
  };
  const d = table({ 'HOME>CAMPUS': 30, 'HOME>R1': 32, 'R1>CAMPUS': 3 });

  it("adds the car's costs to the timetable and each rider's to their stop", () => {
    const priced = priceSchedule(schedule, { start: HOME, end: CAMPUS }, new Map([['r1', R1]]), d, pricing, now);

    expect(priced.costs).toMatchObject({ tripDistanceKm: 30, tripParticipants: 2 });
    expect(priced.stops[0]).toMatchObject({
      requestId: 'r1', pickupAt: at, arriveAt: at, cost: { passengerContribution: expect.closeTo(4) },
    });
  });

  it("refuses a rider whose pickup point it wasn't given", () => {
    expect(() => priceSchedule(schedule, { start: HOME, end: CAMPUS }, new Map(), d, pricing, now))
      .toThrow(/No pickup point for rider r1/);
  });
});
