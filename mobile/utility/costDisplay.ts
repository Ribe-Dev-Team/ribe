/*
A ride's cost split as the app shows it. Every figure is worked out by the
matching runner (backend/server/costSplitting) and read from the car's stored
timetable - the app never calculates costs itself. None include parking.
*/

export interface RideCostSplit {
  /** Whose view: a rider sees their own share, a driver what their passengers
   *  are suggested to contribute in total. */
  viewer: 'rider' | 'driver';
  medianFuelPrice: number;   // c/L
  fuelType: string;
  fuelSource: 'servo-saver' | 'fallback';
  vehicleEconomy: number;    // L/100km
  tripDistanceKm: number;
  tripParticipants: number;  // driver included
  fuelCost: number;          // $, the driver's own trip
  baseTripContribution: number; // $, each person's share of fuelCost
  /** Rider view: their own detour and suggested contribution. */
  detourDistanceKm?: number;
  detourCost?: number;
  passengerContribution?: number;
  /** Driver view: every passenger's suggested contribution, added up. */
  passengersTotal?: number;
}

export function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** The one amount a ride card shows: a rider's contribution, or what a
 *  driver's passengers contribute in total. Undefined until it's priced. */
export function headlineAmount(split?: RideCostSplit): number | undefined {
  if (!split) return undefined;
  return split.viewer === 'rider' ? split.passengerContribution : split.passengersTotal;
}
