import { collection, doc, DocumentData, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore';
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
  acceptingMore?: boolean; // false once the driver locks the trip
  // A request's own estimated times, as of its match.
  pickupAt?: StoredTime;
  arriveAt?: StoredTime;
  // An offer's timetables (see firebaseBooking.schema.ts).
  schedule?: StoredSchedule;
  pendingSchedule?: StoredSchedule;
}

type StoredTime = Timestamp | Date | string;

/** A car's timetable as the matcher stored it on the offer. */
interface StoredSchedule {
  departAt: StoredTime;
  arriveAt: StoredTime;
  stops: { requestId: string; pickupAt: StoredTime; arriveAt: StoredTime }[];
}

/** The parts of a rider's matched offer their card needs, read on their behalf. */
type OfferView = Pick<
  FirestoreRideRecord,
  'status' | 'schedule' | 'pendingSchedule' | 'pendingRequestId' | 'confirmedRequestIds'
  | 'seatCapacity' | 'acceptingMore'
>;

/** A car's seats as a card shows them. `open`: still being offered new
 *  riders. `locked`: the driver stopped that, as opposed to the car being full. */
interface SeatState {
  filled: number;
  total: number;
  open: boolean;
  locked: boolean;
}

/** A driver's car from their offer (theirs, or the one a rider is matched to). */
function seatStateOf(offer: OfferView): SeatState | undefined {
  if (!offer.seatCapacity) return undefined;
  const filled = (offer.confirmedRequestIds ?? []).length;
  const locked = offer.acceptingMore === false;
  return { filled, total: offer.seatCapacity, open: !locked && filled < offer.seatCapacity, locked };
}

/** How long before the estimated pickup a rider is told to be ready. Covers
 *  the drive times not including traffic, and a driver running early. */
const READY_BUFFER_MINUTES = 10;

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

/** "HH:mm", the format the stored booking times use, on this device's clock. */
function formatClock(date: Date): string {
  const rounded = new Date(Math.round(date.getTime() / 60_000) * 60_000);
  return `${String(rounded.getHours()).padStart(2, '0')}:${String(rounded.getMinutes()).padStart(2, '0')}`;
}

/** Minutes since midnight back to "HH:mm", clamped to the day. */
function fromMinutes(total: number): string {
  const m = Math.max(0, Math.min(total, 24 * 60 - 1));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The matcher's estimate for one card: when the trip starts and ends for
 *  this user. */
interface TripTimes {
  startAt: Date;
  endAt: Date;
}

/**
 * The times the matcher actually planned, or undefined while there are none
 * (unmatched, or matched before timetables were stored). A rider's come from
 * the car's live timetable - the pending proposal while they're the one being
 * asked, the confirmed one after - falling back to the snapshot on their own
 * request. A driver's are their departure and arrival.
 */
function plannedTimes(
  record: DisplayableRideRecord,
  kind: 'request' | 'offer',
  docId: string,
  offer?: OfferView,
): TripTimes | undefined {
  if (kind === 'offer') {
    const schedule = record.pendingRequestId && record.pendingSchedule ? record.pendingSchedule : record.schedule;
    return schedule ? { startAt: toDate(schedule.departAt), endAt: toDate(schedule.arriveAt) } : undefined;
  }

  const schedule = offer?.pendingRequestId === docId ? offer.pendingSchedule : offer?.schedule;
  const stop = schedule?.stops.find((s) => s.requestId === docId);
  if (stop) return { startAt: toDate(stop.pickupAt), endAt: toDate(stop.arriveAt) };
  if (record.pickupAt && record.arriveAt) return { startAt: toDate(record.pickupAt), endAt: toDate(record.arriveAt) };
  return undefined;
}

/**
 * Everything known about a driver, from both places it lives: drivers/{uid}
 * (written by driver registration - car and plate) and users/{uid} (the
 * account - name, bio, degree, phone, and often the car too). Anyone can offer
 * a ride without finishing driver registration, so drivers/{uid} may not exist,
 * and it never holds a phone, bio or degree. Each field comes from drivers/{uid}
 * when it has a value, else users/{uid}. `{}` when neither can be read - an
 * unreadable profile must never fail the screen showing it.
 */
export async function fetchDriverProfile(uid: string): Promise<DocumentData> {
  const read = async (collectionName: string): Promise<DocumentData> => {
    try {
      const snap = await getDoc(doc(db, collectionName, uid));
      return snap.exists() ? snap.data() : {};
    } catch (error) {
      console.warn(`Failed to load ${collectionName} profile`, uid, error);
      return {};
    }
  };

  const [driverDoc, userDoc] = await Promise.all([read('drivers'), read('users')]);
  const merged: DocumentData = { ...userDoc };
  for (const [key, value] of Object.entries(driverDoc)) {
    if (value !== undefined && value !== null && value !== '') merged[key] = value;
  }
  return merged;
}

/**
 * Fetch each matched driver's profile once, keyed by uid.
 *
 * Batched here rather than fetched per card: several of a user's requests can be
 * matched to the same driver. Details come from fetchDriverProfile (driver
 * registration and account merged). A driver neither describes yields no
 * entry, and the caller shows a placeholder rather than failing the screen.
 */
async function fetchDrivers(uids: string[]): Promise<Map<string, DriverSummary>> {
  const unique = [...new Set(uids)];
  const out = new Map<string, DriverSummary>();

  await Promise.all(unique.map(async (uid) => {
    const profile = await fetchDriverProfile(uid);
    const field = (name: string) => (profile[name] || undefined) as string | undefined;

    const name = field('name');
    const vehicle = [field('vehicleMake'), field('vehicleModel')].filter(Boolean).join(' ');
    const plate = field('licensePlate');
    if (!name && !vehicle && !plate) return;

    out.set(uid, {
      name: name || 'Your driver',
      vehicle: vehicle || 'Vehicle details coming soon',
      plate: plate || 'Plate not shared',
      phone: field('phoneNumber'),
    });
  }));

  return out;
}

/**
 * Fetch the offers matched riders are on, for their timetables and to notice a
 * removed offer. Same rules as fetchDrivers: once per offer, and an unreadable
 * one just means that card falls back to what is stored on the request.
 */
async function fetchOfferViews(offerIds: string[]): Promise<Map<string, OfferView>> {
  const unique = [...new Set(offerIds)];
  const out = new Map<string, OfferView>();

  await Promise.all(unique.map(async (id) => {
    try {
      const snap = await getDoc(doc(db, 'rideOffers', id));
      if (!snap.exists()) return;
      const data = snap.data() as FirestoreRideRecord;
      out.set(id, {
        status: data.status,
        schedule: data.schedule,
        pendingSchedule: data.pendingSchedule,
        pendingRequestId: data.pendingRequestId,
        confirmedRequestIds: data.confirmedRequestIds,
        seatCapacity: data.seatCapacity,
        acceptingMore: data.acceptingMore,
      });
    } catch (error) {
      console.warn('Failed to load matched trip', id, error);
    }
  }));

  return out;
}

/**
 * A rider whose driver removed the offer is searching again. The runner makes
 * that true in Firestore on its next run (the driver's phone can't write the
 * rider's booking), so until then the card is shown as it is about to be,
 * rather than as a match that no longer exists.
 */
function asSearchingIfDropped(
  record: DisplayableRideRecord,
  docId: string,
  offer?: OfferView,
): DisplayableRideRecord {
  if (!offer || (record.status !== 'awaiting' && record.status !== 'confirmed')) return record;
  const kept = offer.status !== 'cancelled' && (record.status === 'awaiting'
    ? offer.pendingRequestId === docId
    : (offer.confirmedRequestIds ?? []).includes(docId));
  if (kept) return record;
  return {
    ...record,
    status: 'pending',
    matchedOfferId: undefined,
    matchedDriverId: undefined,
    matchedAt: undefined,
    acceptDeadline: undefined,
    pickupAt: undefined,
    arriveAt: undefined,
  };
}

/** Takes the narrowed record: terminal statuses are filtered out before this
 *  runs, because RideCard has no rendering for them. */
function buildRideCard(
  record: DisplayableRideRecord,
  kind: 'request' | 'offer',
  docId: string,
  driver?: DriverSummary,
  offer?: OfferView,
): RideCardProps {
  const date = toDate(record.date);
  const departureTime = record.departureTime ?? '09:00';
  const arrivalTime = record.arrivalTime ?? '10:00';

  // Once matched, show the trip the matcher planned: real pickup and arrival,
  // and the time actually spent in the car. Until then all there is is the
  // user's own booking window, so show that.
  const planned = plannedTimes(record, kind, docId, offer);
  const durationMinutes = planned
    ? Math.max(1, Math.round((planned.endAt.getTime() - planned.startAt.getTime()) / 60_000))
    : Math.max(15, Math.abs(toMinutes(arrivalTime) - toMinutes(departureTime)) || 30);
  // A driver leaves at the time they chose; a rider's pickup is an estimate.
  const estimated = (d: Date) => (kind === 'request' ? '~' : '') + formatClock(d);
  // Ready a little before the car is due - but never asked to be ready before
  // the earliest time they said they could leave.
  const readyBy = planned && kind === 'request'
    ? fromMinutes(Math.max(
      toMinutes(formatClock(planned.startAt)) - READY_BUFFER_MINUTES,
      toMinutes(departureTime),
    ))
    : undefined;

  // On an offer the viewer IS the driver, so their own details belong on the
  // card. On a request the driver's profile comes from fetchDrivers. A matched
  // ride whose driver profile can't be read still HAS a driver - only an
  // unmatched one is searching.
  const resolved: DriverSummary = kind === 'offer'
    ? { name: 'Your driving offer', vehicle: 'Your vehicle', plate: 'Your plate' }
    : driver ?? (record.matchedDriverId
      ? { name: 'Your driver', vehicle: 'Vehicle details coming soon', plate: 'Plate not shared' }
      : { name: 'Searching for a driver', vehicle: 'Vehicle pending', plate: 'Pending' });

  // The car's seats. A rider sees them once they're confirmed in it; a driver
  // always sees their own (0 of 3 while still searching).
  const seats = kind === 'offer'
    ? seatStateOf(record)
    : record.status === 'confirmed' && offer ? seatStateOf(offer) : undefined;
  // A driver's trip with a passenger aboard is an upcoming drive even while it
  // still takes more. Firestore keeps it 'pending' so the matcher can offer it
  // more riders, but on the driver's screen it belongs with confirmed trips.
  const status = kind === 'offer' && record.status === 'pending' && (seats?.filled ?? 0) > 0
    ? 'confirmed'
    : record.status;

  return {
    rideId: docId,
    kind,
    status,
    date,
    pickup: {
      address: record.address || 'Pickup location pending',
      time: planned ? estimated(planned.startAt) : departureTime,
    },
    destination: {
      address: record.toUni ? 'Monash University' : 'Home',
      eta: planned ? '~' + formatClock(planned.endAt) : arrivalTime,
    },
    etaMinutes: durationMinutes,
    readyBy,
    // Nothing planned yet: show the window they gave, not times that read as
    // a real pickup and arrival.
    timeWindow: planned ? undefined : { from: departureTime, to: arrivalTime },
    bookingWindow: { from: departureTime, to: arrivalTime },
    seats,
    // What they asked for, so a rider in a car still taking passengers can be
    // told they'll still arrive by it.
    arriveBy: arrivalTime,
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
    pickupDateTime: planned?.startAt ?? date,
  };
}

/**
 * A ride's times on one line, for the calendar and the details page: the
 * planned pickup and minutes in the car once matched, or the person's own
 * window ("07:30–09:00") while still searching - the same rule RideCard uses.
 */
export function rideTimeSummary(
  ride: Pick<RideCardProps, 'pickup' | 'etaMinutes' | 'timeWindow'>,
): { time: string; duration?: string } {
  return ride.timeWindow
    ? { time: `${ride.timeWindow.from}–${ride.timeWindow.to}` }
    : { time: ride.pickup.time, duration: `${ride.etaMinutes} min` };
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

  // One round of driver and trip lookups covering every matched request on
  // this screen.
  const [drivers, offers] = await Promise.all([
    fetchDrivers(
      requestRows
        .map((row) => row.data.matchedDriverId)
        .filter((uid): uid is string => Boolean(uid)),
    ),
    fetchOfferViews(
      requestRows
        .map((row) => row.data.matchedOfferId)
        .filter((id): id is string => Boolean(id)),
    ),
  ]);

  return {
    requests: requestRows.map(({ id, data }) => {
      const offer = data.matchedOfferId ? offers.get(data.matchedOfferId) : undefined;
      const record = asSearchingIfDropped(data, id, offer);
      return buildRideCard(
        record,
        'request',
        id,
        record.matchedDriverId ? drivers.get(record.matchedDriverId) : undefined,
        offer,
      );
    }),
    offers: offerRows.map(({ id, data }) => buildRideCard(data, 'offer', id)),
  };
}

export type { UserRideBundle };
