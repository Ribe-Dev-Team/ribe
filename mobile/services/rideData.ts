import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
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
  // Matching and Cancellation Metadata
  matchedOfferId?: string;
  matchedRequestId?: string;
  cancelledAt?: Timestamp | Date | string;
  cancelledBy?: string;
  cancelReason?: string;
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

export function buildRideCard(
  record: Partial<FirestoreRideRecord>,
  kind: 'request' | 'offer',
  id?: string
): RideCardProps {
  const date = toDate(record.date);
  const departureTime = record.departureTime ?? '09:00';
  const arrivalTime = record.arrivalTime ?? '10:00';
  const durationMinutes = Math.max(15, Math.abs(toMinutes(arrivalTime) - toMinutes(departureTime)) || 30);

  const driverName = kind === 'request' ? 'Matched driver' : 'Your driving offer';
  const vehicle = kind === 'request' ? 'Vehicle pending' : 'Your vehicle';

  return {
    id,
    kind,
    status: record.status ?? 'pending',
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
    return buildRideCard({ ...data, status: data.status ?? 'pending' }, 'request', docSnap.id);
  });

  const offers = offersSnap.docs.map((docSnap) => {
    const data = docSnap.data() as FirestoreRideRecord;
    return buildRideCard({ ...data, status: data.status ?? 'pending' }, 'offer', docSnap.id);
  });

  return { requests, offers };
}

// ==========================================
// CANCELLATION FUNCTIONS
// ==========================================

/**
 * Cancels an unmatched pending ride request.
 */
export async function cancelRideRequest(requestId: string, userId: string, reason?: string): Promise<void> {
  const requestRef = doc(db, 'rideRequests', requestId);
  await updateDoc(requestRef, {
    status: 'cancelled' as RideStatus,
    cancelledAt: serverTimestamp(),
    cancelledBy: userId,
    ...(reason ? { cancelReason: reason } : {}),
  });
}

/**
 * Cancels an unmatched pending ride offer.
 */
export async function cancelRideOffer(offerId: string, userId: string, reason?: string): Promise<void> {
  const offerRef = doc(db, 'rideOffers', offerId);
  await updateDoc(offerRef, {
    status: 'cancelled' as RideStatus,
    cancelledAt: serverTimestamp(),
    cancelledBy: userId,
    ...(reason ? { cancelReason: reason } : {}),
  });
}

/**
 * Cancels a confirmed ride by atomically updating both the request and offer.
 */
export async function cancelConfirmedRide(params: {
  requestId: string;
  offerId: string;
  cancelledByUserId: string;
  reason?: string;
}): Promise<void> {
  const { requestId, offerId, cancelledByUserId, reason } = params;
  const batch = writeBatch(db);

  const requestRef = doc(db, 'rideRequests', requestId);
  const offerRef = doc(db, 'rideOffers', offerId);

  batch.update(requestRef, {
    status: 'cancelled' as RideStatus,
    matchedOfferId: null,
    cancelledAt: serverTimestamp(),
    cancelledBy: cancelledByUserId,
    ...(reason ? { cancelReason: reason } : {}),
  });

  batch.update(offerRef, {
    status: 'cancelled' as RideStatus,
    matchedRequestId: null,
    cancelledAt: serverTimestamp(),
    cancelledBy: cancelledByUserId,
    ...(reason ? { cancelReason: reason } : {}),
  });

  await batch.commit();
}

export type { UserRideBundle, FirestoreRideRecord };