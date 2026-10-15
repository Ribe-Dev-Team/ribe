/*
Suggested cost splitting for a shared trip.

  Base Trip Contribution ($)           = M.F.P. x V.E. x T.D. / T.P.
  Detour Cost (per individual) ($)     = M.F.P. x V.E. x D.D.
  Recommended Passenger Contribution   = Detour Cost + B.T.C.

  M.F.P. - Median Fuel Price (c/L)
  V.E.   - Vehicle Economy (L/100km)
  T.D.   - Trip Distance, no detours (km)
  T.P.   - Trip Participants (#), driver included
  D.D.   - Detour Distance, for this passenger (km)

Parking is not included: the app says so wherever it shows a split.

Units: c/L x L/100km x km leaves (cents x 1/100), so every fuel cost below goes
through fuelCostDollars() which divides by 100 (cents -> dollars) and by 100
(per-100km -> per-km). Skipping that conversion overstates costs 10,000x.
*/

/*
Fallback vehicle economy until drivers can enter their own. ABS Survey of Motor
Vehicle Use average for passenger vehicles is roughly 11 L/100km.
*/
export const DEFAULT_VEHICLE_ECONOMY = 11.1;

export interface CostSplitInput {
  medianFuelPrice: number;    // c/L
  vehicleEconomy: number;     // L/100km
  tripDistanceKm: number;     // driver's trip with no detours
  tripParticipants: number;   // driver + passengers
  detourDistanceKm?: number;  // extra distance driven to pick up THIS passenger
}

export interface CostSplit {
  fuelCost: number;               // $, whole trip with no detours
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
export function fuelCostDollars(medianFuelPrice: number, vehicleEconomy: number, distanceKm: number): number {
  assertNonNegative(medianFuelPrice, 'Median fuel price');
  assertNonNegative(vehicleEconomy, 'Vehicle economy');
  assertNonNegative(distanceKm, 'Distance');
  return (medianFuelPrice / 100) * (vehicleEconomy / 100) * distanceKm;
}

/*
Extra distance the driver covers by picking this passenger up, i.e. the route
with them minus the route without them. Clamped at 0 since routing can return a
marginally shorter path through a waypoint.
*/
export function calcDetourDistance(withoutPassengerKm: number, withPassengerKm: number): number {
  assertNonNegative(withoutPassengerKm, 'Distance without passenger');
  assertNonNegative(withPassengerKm, 'Distance with passenger');
  return Math.max(0, withPassengerKm - withoutPassengerKm);
}

export function calcBaseTripContribution(
  { medianFuelPrice, vehicleEconomy, tripDistanceKm, tripParticipants }: CostSplitInput,
): number {
  if (!Number.isInteger(tripParticipants) || tripParticipants < 1) {
    throw new Error(`Trip participants must be a positive integer, but was ${tripParticipants}`);
  }
  return fuelCostDollars(medianFuelPrice, vehicleEconomy, tripDistanceKm) / tripParticipants;
}

export function calcDetourCost({ medianFuelPrice, vehicleEconomy, detourDistanceKm = 0 }: CostSplitInput): number {
  return fuelCostDollars(medianFuelPrice, vehicleEconomy, detourDistanceKm);
}

export function calcPassengerContribution(input: CostSplitInput): number {
  return calcDetourCost(input) + calcBaseTripContribution(input);
}

/* Full breakdown. Values are unrounded; the app rounds them for display. */
export function calcCostSplit(input: CostSplitInput): CostSplit {
  const baseTripContribution = calcBaseTripContribution(input);
  const detourCost = calcDetourCost(input);
  return {
    fuelCost: fuelCostDollars(input.medianFuelPrice, input.vehicleEconomy, input.tripDistanceKm),
    baseTripContribution,
    detourCost,
    passengerContribution: baseTripContribution + detourCost,
  };
}
