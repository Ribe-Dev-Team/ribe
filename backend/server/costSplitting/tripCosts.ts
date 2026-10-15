/*
Prices a whole car: the trip's fuel, each rider's share of it, and each rider's
own detour, using the formulas in formula.ts.

The runner prices a car whenever it writes the car's timetable - a match's
proposed timetable, or the confirmed one it fills in - and the result is stored
ON that timetable (writes.ts → StoredSchedule): trip-level figures as
`schedule.costs`, each rider's as `stops[i].cost`. The app only reads them.
Storing them there rather than on each rider's request keeps them in step with
the car: everyone's share changes when a rider joins, and accepting a match
already swaps the proposed timetable in (acceptMatch), costs included.

Distances come from the same per-batch Google matrix the matcher uses for
travel times (matching/travelTime.ts), so pricing makes no extra API calls.
*/

import { Coord } from '../matching.schema';
import { RoadDistanceMatrix } from '../matching/types';
import type { StoredSchedule } from '../matching/writes';
import { calcCostSplit, calcDetourDistance } from './formula';
import { MedianFuelPrice } from './fuelPrices';

/** What a run prices every car with: one fuel price for the whole run, and the
 *  vehicle economy (the default until drivers can enter their own). */
export interface Pricing {
  fuel: MedianFuelPrice;
  vehicleEconomy: number;
}

/** The trip-level half of a car's split, stored as `schedule.costs`. Inputs are
 *  kept beside the results so a stored amount can always be explained, and a
 *  stale one spotted: it is a snapshot as of `calculatedAt`. */
export interface StoredTripCosts {
  medianFuelPrice: number;   // c/L
  fuelType: string;
  fuelSource: 'servo-saver' | 'fallback';
  vehicleEconomy: number;    // L/100km
  tripDistanceKm: number;    // the driver's own trip, no detours
  tripParticipants: number;  // driver included
  fuelCost: number;          // $, the driver's own trip
  baseTripContribution: number; // $, each participant's share of fuelCost
  calculatedAt: Date;
}

/** One rider's half, stored on their stop as `stops[i].cost`. */
export interface StoredRiderCost {
  detourDistanceKm: number;
  detourCost: number;            // $
  passengerContribution: number; // $, base share + detour cost
}

/** One rider on the car's route: who, and the point the car goes out of its
 *  way for (pickup going to campus, drop-off coming from it). */
export interface PricedStop {
  reqId: string;
  waypoint: Coord;
}

function routeKm(points: Coord[], d: RoadDistanceMatrix): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += d.km(points[i], points[i + 1]);
  return total;
}

/**
 * Every rider's cost on one car, riders in route order. Each rider's detour is
 * what they add to the car's route: its length with everyone, less its length
 * without them, everyone else keeping their order - the same marginal measure
 * the matcher uses for a rider's added minutes. With one rider that is exactly
 * "via their pickup, minus direct".
 */
export function priceCar(
  start: Coord,
  end: Coord,
  riders: PricedStop[],
  d: RoadDistanceMatrix,
  pricing: Pricing,
  now: Date,
): { trip: StoredTripCosts; riders: StoredRiderCost[] } {
  const waypoints = riders.map((r) => r.waypoint);
  const tripDistanceKm = d.km(start, end);
  const fullKm = routeKm([start, ...waypoints, end], d);
  const tripParticipants = 1 + riders.length;
  const base = {
    medianFuelPrice: pricing.fuel.price,
    vehicleEconomy: pricing.vehicleEconomy,
    tripDistanceKm,
    tripParticipants,
  };

  const perRider = riders.map((_, i) => {
    const withoutKm = routeKm([start, ...waypoints.slice(0, i), ...waypoints.slice(i + 1), end], d);
    const detourDistanceKm = calcDetourDistance(withoutKm, fullKm);
    const split = calcCostSplit({ ...base, detourDistanceKm });
    return { detourDistanceKm, detourCost: split.detourCost, passengerContribution: split.passengerContribution };
  });

  const split = calcCostSplit(base);
  return {
    trip: {
      medianFuelPrice: pricing.fuel.price,
      fuelType: pricing.fuel.fuelType,
      fuelSource: pricing.fuel.source,
      vehicleEconomy: pricing.vehicleEconomy,
      tripDistanceKm,
      tripParticipants,
      fuelCost: split.fuelCost,
      baseTripContribution: split.baseTripContribution,
      calculatedAt: now,
    },
    riders: perRider,
  };
}

/**
 * A stored timetable with its costs added. `waypointById` must hold every rider
 * the timetable lists; the car's route is its stops, in order.
 */
export function priceSchedule(
  schedule: StoredSchedule,
  car: { start: Coord; end: Coord },
  waypointById: Map<string, Coord>,
  d: RoadDistanceMatrix,
  pricing: Pricing,
  now: Date,
): StoredSchedule {
  const riders = schedule.stops.map((s) => {
    const waypoint = waypointById.get(s.requestId);
    if (!waypoint) throw new Error(`No pickup point for rider ${s.requestId}, so their trip can't be priced.`);
    return { reqId: s.requestId, waypoint };
  });
  const priced = priceCar(car.start, car.end, riders, d, pricing, now);
  return {
    ...schedule,
    costs: priced.trip,
    stops: schedule.stops.map((s, i) => ({ ...s, cost: priced.riders[i] })),
  };
}
