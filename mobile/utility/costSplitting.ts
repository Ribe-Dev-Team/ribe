/*
Utility file to handle suggested cost splitting for a shared trip.

  Base Trip Contribution ($)           = M.F.P. x V.E. x T.D. / T.P.  (+ parking / T.P.)
  Detour Cost (per individual) ($)     = M.F.P. x V.E. x D.D.
  Recommended Passenger Contribution   = Detour Cost + B.T.C.

  M.F.P. - Median Fuel Price (c/L)
  V.E.   - Vehicle Economy (L/100km)
  T.D.   - Trip Distance, no detours (km)
  T.P.   - Trip Participants (#), driver included
  D.D.   - Detour Distance, for this passenger (km)

Units: c/L x L/100km x km leaves (cents x 1/100), so every fuel cost below goes
through fuelCostDollars() which divides by 100 (cents -> dollars) and by 100
(per-100km -> per-km). Skipping that conversion overstates costs 10,000x.
*/

export {
  CostSplitInput,
  CostSplit,
  DEFAULT_VEHICLE_ECONOMY,
  fuelCostDollars,
  calcDetourDistance,
  calcBaseTripContribution,
  calcDetourCost,
  calcPassengerContribution,
  calcCostSplit,
  formatDollars,
};

/*
Fallback vehicle economy until drivers can enter their own. ABS Survey of Motor
Vehicle Use average for passenger vehicles is roughly 11 L/100km.
*/
const DEFAULT_VEHICLE_ECONOMY = 11.1;

interface CostSplitInput {
  medianFuelPrice: number;    // c/L
  vehicleEconomy: number;     // L/100km
  tripDistanceKm: number;     // driver's trip with no detours
  tripParticipants: number;   // driver + passengers
  detourDistanceKm?: number;  // extra distance driven to pick up THIS passenger
  parkingCost?: number;       // $, total for the trip, shared evenly
}

interface CostSplit {
  fuelCost: number;               // $, whole trip with no detours
  parkingCost: number;            // $, whole trip
  baseTripContribution: number;   // $, per participant
  detourCost: number;             // $, this passenger only
  passengerContribution: number;  // $, recommended amount for this passenger
}

function assertNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number, but was ${value}`);
  }
}

/* Cost in dollars of driving `distanceKm` at the given fuel price and economy. */
function fuelCostDollars(medianFuelPrice: number, vehicleEconomy: number, distanceKm: number): number {
  assertNonNegative(medianFuelPrice, 'Median fuel price');
  assertNonNegative(vehicleEconomy, 'Vehicle economy');
  assertNonNegative(distanceKm, 'Distance');
  return (medianFuelPrice / 100) * (vehicleEconomy / 100) * distanceKm;
}

/*
Extra distance the driver covers by picking this passenger up, i.e. the route
via the pickup minus the direct route. Clamped at 0 since routing can return a
marginally shorter path through a waypoint.
*/
function calcDetourDistance(directDistanceKm: number, distanceWithPickupKm: number): number {
  assertNonNegative(directDistanceKm, 'Direct distance');
  assertNonNegative(distanceWithPickupKm, 'Distance with pickup');
  return Math.max(0, distanceWithPickupKm - directDistanceKm);
}

function calcBaseTripContribution(
  { medianFuelPrice, vehicleEconomy, tripDistanceKm, tripParticipants, parkingCost = 0 }: CostSplitInput,
): number {
  if (!Number.isInteger(tripParticipants) || tripParticipants < 1) {
    throw new Error(`Trip participants must be a positive integer, but was ${tripParticipants}`);
  }
  assertNonNegative(parkingCost, 'Parking cost');
  const fuelCost = fuelCostDollars(medianFuelPrice, vehicleEconomy, tripDistanceKm);
  return (fuelCost + parkingCost) / tripParticipants;
}

function calcDetourCost({ medianFuelPrice, vehicleEconomy, detourDistanceKm = 0 }: CostSplitInput): number {
  return fuelCostDollars(medianFuelPrice, vehicleEconomy, detourDistanceKm);
}

function calcPassengerContribution(input: CostSplitInput): number {
  return calcDetourCost(input) + calcBaseTripContribution(input);
}

/* Full breakdown for display. Values are unrounded; round at the UI with formatDollars. */
function calcCostSplit(input: CostSplitInput): CostSplit {
  const baseTripContribution = calcBaseTripContribution(input);
  const detourCost = calcDetourCost(input);
  return {
    fuelCost: fuelCostDollars(input.medianFuelPrice, input.vehicleEconomy, input.tripDistanceKm),
    parkingCost: input.parkingCost ?? 0,
    baseTripContribution,
    detourCost,
    passengerContribution: baseTripContribution + detourCost,
  };
}

function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
