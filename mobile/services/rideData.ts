import { collection, doc, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore';
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
  // Written by the matching runner; all absent while still unmatched.
  matchedOfferId?: string;
  matchedDriverId?: string;
  matchedAt?: Timestamp | Date | string;
  acceptDeadline?: Timestamp | Date | string;
  riderDetourMinutes?: number;
  pendingRequestId?: string | null;
  confirmedRequestIds?: string[];
}

/** A stored ride that is still in play, so its status is one RideCard renders. */
type DisplayableRideRecord = FirestoreRideRecord & { status: DisplayableBookingStatus };

/** The slice of drivers/{uid} the ride cards need. */
interface DriverSummary {
  name: string;
  vehicle: string;
  plate: string;
  phone?: string;
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

/**
 * Like toDate, but preserves "absent" instead of defaulting to now. An absent
 * matchedAt means "not matched", and defaulting it would start RideCard's
 * 12-hour approval countdown on a card that has no match behind it.
 */
function toDateOrUndefined(value: Timestamp | Date | string | undefined): Date | undefined {
  return value === undefined || value === null ? undefined : toDate(value);
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Fetch each matched driver's profile once, keyed by uid.
 *
 * Batched here rather than fetched per card: several of a user's requests can be
 * matched to the same driver. A driver doc that is missing (the user never
 * finished driver registration) simply yields no entry, and the caller falls
 * back to placeholder text rather than failing the whole screen.
 */
async function fetchDrivers(uids: string[]): Promise<Map<string, DriverSummary>> {
  const unique = [...new Set(uids)];
  const out = new Map<string, DriverSummary>();

  await Promise.all(unique.map(async (uid) => {
    try {
      const snap = await getDoc(doc(db, 'drivers', uid));
      if (!snap.exists()) return;

      const data = snap.data() as Record<string, unknown>;
      const vehicle = [data['vehicleMake'], data['vehicleModel']].filter(Boolean).join(' ');

      out.set(uid, {
        name: (data['name'] as string) || 'Your driver',
        vehicle: vehicle || 'Vehicle details coming soon',
        plate: (data['licensePlate'] as string) || 'Plate not shared',
        phone: data['phoneNumber'] as string | undefined,
      });
    } catch (error) {
      // One unreadable driver doc must not blank out the whole ride list.
      console.warn('Failed to load driver profile', uid, error);
    }
  }));

  return out;
}

/** Takes the narrowed record: terminal statuses are filtered out before this
 *  runs, because RideCard has no rendering for them. */
function buildRideCard(
  record: DisplayableRideRecord,
  kind: 'request' | 'offer',
  docId: string,
  driver?: DriverSummary,
): RideCardProps {
  const date = toDate(record.date);
  const departureTime = record.departureTime ?? '09:00';
  const arrivalTime = record.arrivalTime ?? '10:00';
  const durationMinutes = Math.max(15, Math.abs(toMinutes(arrivalTime) - toMinutes(departureTime)) || 30);

  // On an offer the viewer IS the driver, so their own details belong on the
  // card. On a request the driver comes from drivers/{matchedDriverId}, and is
  // absent only while the request is still unmatched.
  const resolved: DriverSummary = kind === 'offer'
    ? { name: 'Your driving offer', vehicle: 'Your vehicle', plate: 'Your plate' }
    : driver ?? { name: 'Searching for a driver', vehicle: 'Vehicle pending', plate: 'Pending' };

  return {
    rideId: docId,
    kind,
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
    // PLACEHOLDER: there is no fare model and no distance-to-CO2 calculation in
    // the codebase yet, so these two are constants rather than data. They are
    // NOT derived from the match.
    cost: '$8.50',
    co2SavedKg: 2.4,
    driver: {
      uid: kind === 'request' ? record.matchedDriverId : record.userId,
      name: resolved.name,
      vehicle: resolved.vehicle,
    },
    plate: resolved.plate,
    driverPhone: resolved.phone,
    // The matcher's own timestamp, not the time of this fetch.
    matchedAt: toDateOrUndefined(record.matchedAt),
    // The deadline the runner actually enforces - often well under 12h, since
    // it is clamped to the matching cutoff before departure.
    acceptDeadline: toDateOrUndefined(record.acceptDeadline),
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
  // The doc id is carried alongside, because the accept/decline handlers need it
  // to write back and it is not reliably stored inside the document.
  const narrow = (docs: { id: string; data: () => unknown }[]) =>
    docs
      .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() as FirestoreRideRecord }))
      .map(({ id, data }) => ({ id, data: { ...data, status: data.status ?? 'pending' } }))
      .filter((row): row is { id: string; data: DisplayableRideRecord } =>
        isDisplayable(row.data.status));

  const requestRows = narrow(requestsSnap.docs);
  const offerRows = narrow(offersSnap.docs);

  // One round of driver lookups covering every matched request on this screen.
  const drivers = await fetchDrivers(
    requestRows
      .map((row) => row.data.matchedDriverId)
      .filter((uid): uid is string => Boolean(uid)),
  );

  return {
    requests: requestRows.map(({ id, data }) => buildRideCard(
      data,
      'request',
      id,
      data.matchedDriverId ? drivers.get(data.matchedDriverId) : undefined,
    )),
    offers: offerRows.map(({ id, data }) => buildRideCard(data, 'offer', id)),
  };
}

export type { UserRideBundle };
