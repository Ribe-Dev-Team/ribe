/*
The cost split saved onto a matched rideRequest (`costSplit` field), plus the
pure helpers that build it. Kept separate from costSplitting.ts because these
know about the match shape (rideRequests/rideOffers), while that file is only
the formula.

Used by scripts/backfillCostSplits.ts today, and meant to be reused when the
matcher writes the split at match time.

The inputs (fuel price, distances, participants) are stored alongside the
result so a saved amount can always be explained, and so a stale one can be
spotted - it is a snapshot as of `calculatedAt`, not a live value.
*/

import { calcCostSplit, CostSplit } from './costSplitting';

export {
  StoredCostSplit,
  LatLng,
  TripLeg,
  toLatLng,
  tripLeg,
  countTripParticipants,
  buildStoredCostSplit,
};

interface LatLng {
  lat: number;
  lng: number;
}

interface StoredCostSplit extends CostSplit {
  medianFuelPrice: number;   // c/L
  fuelType: string;
  fuelSource: 'servo-saver' | 'fallback';
  vehicleEconomy: number;    // L/100km
  tripDistanceKm: number;
  detourDistanceKm: number;
  tripParticipants: number;  // driver included
  calculatedAt: Date;
}

/* The driver's route, and the rider's stop on it. */
interface TripLeg {
  origin: LatLng;
  destination: LatLng;
  via: LatLng;
}

/* Firestore stores the matcher's { lat, lon }; the routing services take { lat, lng }. */
function toLatLng(coord: { lat?: unknown; lon?: unknown } | undefined | null): LatLng | null {
  if (!coord || typeof coord.lat !== 'number' || typeof coord.lon !== 'number') return null;
  return { lat: coord.lat, lng: coord.lon };
}

/*
Going to uni the driver leaves home, picks the rider up and ends at campus.
Going home it is reversed: the driver leaves campus, drops the rider off and
ends at their own home. Either way the rider's address is the waypoint.
*/
function tripLeg(toUni: boolean, driverHome: LatLng, riderHome: LatLng, campus: LatLng): TripLeg {
  return toUni
    ? { origin: driverHome, destination: campus, via: riderHome }
    : { origin: campus, destination: driverHome, via: riderHome };
}

/*
Driver + every confirmed rider on the offer, plus this rider. A rider still
awaiting approval isn't in confirmedRequestIds yet, but the split shown to them
should assume they join.
*/
function countTripParticipants(requestId: string, confirmedRequestIds: string[] = []): number {
  return 1 + new Set([...confirmedRequestIds, requestId]).size;
}

function buildStoredCostSplit(input: {
  fuel: { price: number; fuelType: string; source: 'servo-saver' | 'fallback' };
  vehicleEconomy: number;
  tripDistanceKm: number;
  detourDistanceKm: number;
  tripParticipants: number;
  parkingCost?: number;
  calculatedAt?: Date;
}): StoredCostSplit {
  const split = calcCostSplit({
    medianFuelPrice: input.fuel.price,
    vehicleEconomy: input.vehicleEconomy,
    tripDistanceKm: input.tripDistanceKm,
    detourDistanceKm: input.detourDistanceKm,
    tripParticipants: input.tripParticipants,
    parkingCost: input.parkingCost,
  });
  return {
    ...split,
    medianFuelPrice: input.fuel.price,
    fuelType: input.fuel.fuelType,
    fuelSource: input.fuel.source,
    vehicleEconomy: input.vehicleEconomy,
    tripDistanceKm: input.tripDistanceKm,
    detourDistanceKm: input.detourDistanceKm,
    tripParticipants: input.tripParticipants,
    calculatedAt: input.calculatedAt ?? new Date(),
  };
}
