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

export interface TripStop {
  requestId: string;
  pickupAt: Timestamp;
  arriveAt: Timestamp;
}

export interface TripSchedule {
  departAt: Timestamp;
  arriveAt: Timestamp;
  stops: TripStop[];
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
