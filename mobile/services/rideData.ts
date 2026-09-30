import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { RideCardProps } from '../components/RideCard';
import { db } from '../firebaseConfig';
import { Coord } from '../pages/schema/booking.schema';
import { BookingStatus, DisplayableBookingStatus, isDisplayable } from '../pages/schema/matchStatus';

interface FirestoreRideRecord {
  userId: string;
  // Stored status, which is a superset of what RideCard can render: it also
  // carries the terminal 'cancelled'/'expired' states the matcher can produce.
  status: BookingStatus;
  toUni: boolean;
  address: string;
  // Optional: documents written before coordinates were captured have none.
  coord?: Coord;
  date: Timestamp | Date | string;
  departureTime: string;
  arrivalTime: string;
  maxDetourTime?: number;
  seatCapacity?: number;
  requestID?: string;
  offerID?: string;
}

/** A stored ride that is still in play, so its status is one RideCard renders. */
type DisplayableRideRecord = FirestoreRideRecord & { status: DisplayableBookingStatus };

interface UserRideBundle {
  requests: RideCardProps[];
  offers: RideCardProps[];
}

function toDate(value: Timestamp | Date | string | undefined): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  return value.toDate();
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Takes the narrowed record: terminal statuses are filtered out before this
 *  runs, because RideCard has no rendering for them. */
function buildRideCard(
  record: DisplayableRideRecord,
  kind: 'request' | 'offer',
): RideCardProps {
  const date = toDate(record.date);
  const departureTime = record.departureTime ?? '09:00';
  const arrivalTime = record.arrivalTime ?? '10:00';
  const durationMinutes = Math.max(15, Math.abs(toMinutes(arrivalTime) - toMinutes(departureTime)) || 30);

  const driverName = kind === 'request' ? 'Matched driver' : 'Your driving offer';
  const vehicle = kind === 'request' ? 'Vehicle pending' : 'Your vehicle';

  return {
    status: record.status,
    date,
    pickup: {
      address: record.address || 'Pickup location pending',
      time: departureTime,
    },
    destination: {
      address: record.toUni ? 'Monash University' : 'Home',
      eta: arrivalTime,
    },
    etaMinutes: durationMinutes,
    cost: '$8.50',
    co2SavedKg: 2.4,
    driver: {
      uid: undefined,
      name: driverName,
      vehicle,
    },
    plate: 'Pending',
    matchedAt: new Date(),
    pickupDateTime: date,
  };
}

export async function fetchUserRides(userId: string): Promise<UserRideBundle> {
  const requestsQuery = query(collection(db, 'rideRequests'), where('userId', '==', userId));
  const offersQuery = query(collection(db, 'rideOffers'), where('userId', '==', userId));

  const [requestsSnap, offersSnap] = await Promise.all([
    getDocs(requestsQuery),
    getDocs(offersQuery),
  ]);

  // Cancelled and expired rides are dropped rather than rendered: RideCard has
  // no presentation for them, and they are no longer part of a user's plans.
  const toCards = (
    docs: { data: () => unknown }[],
    kind: 'request' | 'offer',
  ): RideCardProps[] =>
    docs
      .map((docSnap) => docSnap.data() as FirestoreRideRecord)
      .map((data) => ({ ...data, status: data.status ?? 'pending' }))
      .filter((data): data is DisplayableRideRecord => isDisplayable(data.status))
      .map((data) => buildRideCard(data, kind));

  return {
    requests: toCards(requestsSnap.docs, 'request'),
    offers: toCards(offersSnap.docs, 'offer'),
  };
}

export type { UserRideBundle };
