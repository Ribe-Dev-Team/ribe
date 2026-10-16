import { Timestamp } from 'firebase/firestore';
import { Coord } from './booking.schema';
import { BookingStatus } from './matchStatus';

export type { Coord, BookingStatus };

export interface RideRequest {
  requestID: string;
  userId: string;
  status: BookingStatus;
  toUni: boolean;
  address: string;
  coord?: Coord;
  date: Timestamp;
  departureTime: string;
  arrivalTime: string;
  createdAt?: string;
  matchedOfferId?: string;
  matchedDriverId?: string;
  matchedAt?: Timestamp;
  acceptDeadline?: Timestamp;
  riderDetourMinutes?: number;
  routeIndex?: number;
  emissionsSavedKg?: number;
  pickupAt?: Timestamp;
  arriveAt?: Timestamp;
}

/** One rider's place in a car's timetable. */
/** One rider's cost split, worked out by the matching runner
 *  (backend/server/costSplitting/tripCosts.ts). Excludes parking. */
export interface RiderCost {
  detourDistanceKm: number;
  detourCost: number;            // $
  passengerContribution: number; // $, their share of the trip's fuel + their detour
}

/** The car's half of the split: the inputs and the per-person share. */
export interface TripCosts {
  medianFuelPrice: number;   // c/L
  fuelType: string;
  fuelSource: 'servo-saver' | 'fallback';
  vehicleEconomy: number;    // L/100km
  tripDistanceKm: number;    // the driver's own trip, no detours
  tripParticipants: number;  // driver included
  fuelCost: number;          // $
  baseTripContribution: number; // $, fuelCost / tripParticipants
  calculatedAt: Timestamp;
}

export interface TripStop {
  requestId: string;
  pickupAt: Timestamp; // at their door going to campus; the driver's departure leaving it
  arriveAt: Timestamp; // at their own destination
  cost?: RiderCost;    // absent until the runner has priced the car
}

/** A car's timetable, computed by the matcher from real drive times, with the
 *  car's cost split once the runner has priced it. The app only reads costs. */
export interface TripSchedule {
  departAt: Timestamp; // the driver sets off
  arriveAt: Timestamp; // the driver reaches their own destination
  stops: TripStop[];   // every rider, in pickup order
  costs?: TripCosts;
}

export interface RideOffer {
  offerID: string;
  userId: string;
  status: BookingStatus;
  toUni: boolean;
  address: string;
  coord?: Coord;
  date: Timestamp;
  departureTime: string;
  arrivalTime: string;
  maxDetourTime: number;
  seatCapacity: number;
  createdAt?: string;
  pendingRequestId?: string | null;
  matchedRiderId?: string;
  confirmedRequestIds?: string[];
  acceptingMore?: boolean;
  matchedAt?: Timestamp;
  acceptDeadline?: Timestamp;
  schedule?: TripSchedule;
  pendingSchedule?: TripSchedule;
  emissionsSavedKg?: number;
  driverEmissionsKg?: number;
}
