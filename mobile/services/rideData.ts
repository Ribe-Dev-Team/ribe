import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { RideCardProps, RideStatus } from '../components/RideCard';
import { db } from '../firebaseConfig';

interface FirestoreRideRecord {
  userId: string;
  status: RideStatus;
  toUni: boolean;
  address: string;
  date: Timestamp | Date | string;
  departureTime: string;
  arrivalTime: string;
  maxDetourTime?: number;
  seatCapacity?: number;
  requestID?: string;
  offerID?: string;
}

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

function buildRideCard(record: FirestoreRideRecord, kind: 'request' | 'offer'): RideCardProps {
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

  const requests = requestsSnap.docs.map((docSnap) => {
    const data = docSnap.data() as FirestoreRideRecord;
    return buildRideCard({ ...data, status: data.status ?? 'pending' }, 'request');
  });

  const offers = offersSnap.docs.map((docSnap) => {
    const data = docSnap.data() as FirestoreRideRecord;
    return buildRideCard({ ...data, status: data.status ?? 'pending' }, 'offer');
  });

  return { requests, offers };
}

export type { UserRideBundle };
