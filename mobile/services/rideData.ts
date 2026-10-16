import {
  collection,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { RideCardProps, RideStatus, RideStop } from '../components/RideCard';
import { db } from '../firebaseConfig';
import { Coord } from '../pages/schema/booking.schema';
import { BookingStatus, DisplayableBookingStatus, isDisplayable } from '../pages/schema/matchStatus';

interface FirestoreRideRecord {
  userId: string;
  status: BookingStatus;
  toUni: boolean;
  address: string;
  coord?: Coord;
  date: Timestamp | Date | string;
  departureTime: string;
  arrivalTime: string;
  maxDetourTime?: number;
  seatCapacity?: number;
  requestID?: string;
  offerID?: string;
  matchedOfferId?: string;
  matchedDriverId?: string;
  matchedAt?: Timestamp | Date | string;
  acceptDeadline?: Timestamp | Date | string;
  riderDetourMinutes?: number;
  pendingRequestId?: string | null;
  confirmedRequestIds?: string[];
  acceptingMore?: boolean;
  pickupAt?: StoredTime;
  arriveAt?: StoredTime;
  schedule?: StoredSchedule;
  pendingSchedule?: StoredSchedule;
  matchedRequestId?: string;
  cancelledAt?: Timestamp | Date | string;
  cancelledBy?: string;
  cancelReason?: string;
  emissionsSavedKg?: number;
  driverEmissionsKg?: number;
}

type StoredTime = Timestamp | Date | string;

interface StoredSchedule {
  departAt: StoredTime;
  arriveAt: StoredTime;
  stops: { requestId: string; pickupAt: StoredTime; arriveAt: StoredTime }[];
}

type OfferView = Pick<
  FirestoreRideRecord,
  'status' | 'schedule' | 'pendingSchedule' | 'pendingRequestId' | 'confirmedRequestIds' | 'seatCapacity' | 'acceptingMore'
>;

interface SeatState {
  filled: number;
  total: number;
  open: boolean;
  locked: boolean;
}

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

const READY_BUFFER_MINUTES = 10;
type DisplayableRideRecord = FirestoreRideRecord & { status: DisplayableBookingStatus };

function toDate(value: Timestamp | Date | string | undefined): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  return value.toDate();
}

function toDateOrUndefined(value: Timestamp | Date | string | undefined): Date | undefined {
  return value === undefined || value === null ? undefined : toDate(value);
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatClock(date: Date): string {
  const rounded = new Date(Math.round(date.getTime() / 60_000) * 60_000);
  return `${String(rounded.getHours()).padStart(2, '0')}:${String(rounded.getMinutes()).padStart(2, '0')}`;
}

function fromMinutes(total: number): string {
  const m = Math.max(0, Math.min(total, 24 * 60 - 1));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

interface TripTimes {
  startAt: Date;
  endAt: Date;
}

function seatStateOf(offer: OfferView): SeatState | undefined {
  if (!offer.seatCapacity) return undefined;
  const filled = (offer.confirmedRequestIds ?? []).length;
  const locked = offer.acceptingMore === false;
  return { filled, total: offer.seatCapacity, open: !locked && filled < offer.seatCapacity, locked };
}

function scheduleFor(
  record: DisplayableRideRecord,
  kind: 'request' | 'offer',
  docId: string,
  offer?: OfferView,
): StoredSchedule | undefined {
  if (kind === 'offer') {
    return record.pendingRequestId && record.pendingSchedule ? record.pendingSchedule : record.schedule;
  }
  return offer?.pendingRequestId === docId ? offer.pendingSchedule : offer?.schedule;
}

function plannedTimes(
  record: DisplayableRideRecord,
  kind: 'request' | 'offer',
  docId: string,
  offer?: OfferView,
): TripTimes | undefined {
  const schedule = scheduleFor(record, kind, docId, offer);
  if (kind === 'offer') {
    return schedule ? { startAt: toDate(schedule.departAt), endAt: toDate(schedule.arriveAt) } : undefined;
  }

  const stop = schedule?.stops.find((s) => s.requestId === docId);
  if (stop) return { startAt: toDate(stop.pickupAt), endAt: toDate(stop.arriveAt) };
  if (record.pickupAt && record.arriveAt) return { startAt: toDate(record.pickupAt), endAt: toDate(record.arriveAt) };
  return undefined;
}

interface StopPerson {
  name?: string;
  address?: string;
  emissionsSavedKg?: number;
}

function middleStops(
  record: DisplayableRideRecord,
  kind: 'request' | 'offer',
  docId: string,
  offer?: OfferView,
  people?: Map<string, StopPerson>,
): RideStop[] | undefined {
  const schedule = scheduleFor(record, kind, docId, offer);
  if (!record.toUni || !schedule) return undefined;

  if (kind === 'request') {
    const own = schedule.stops.findIndex((s) => s.requestId === docId);
    if (own < 0) return undefined;
    return schedule.stops.slice(own + 1).map((s) => ({
      label: 'Pickup · another passenger',
      time: '~' + formatClock(toDate(s.pickupAt)),
    }));
  }

  return schedule.stops.map((s, index) => {
    const person = people?.get(s.requestId);
    const name = person?.name && s.requestId === record.pendingRequestId
      ? `${person.name} (awaiting)`
      : person?.name;
    return {
      label: [name, person?.address].filter(Boolean).join(' · ') || `Passenger ${index + 1}`,
      time: '~' + formatClock(toDate(s.pickupAt)),
    };
  });
}

async function fetchStopPeople(requestIds: string[]): Promise<Map<string, StopPerson>> {
  const unique = [...new Set(requestIds)];
  const out = new Map<string, StopPerson>();

  await Promise.all(unique.map(async (id) => {
    try {
      const snap = await getDoc(doc(db, 'rideRequests', id));
      if (!snap.exists()) return;
      const request = snap.data() as FirestoreRideRecord;
      let name: string | undefined;
      try {
        const user = request.userId ? await getDoc(doc(db, 'users', request.userId)) : undefined;
        const fullName = user?.exists() ? (user.data()['name'] as string | undefined) : undefined;
        name = fullName?.trim().split(/\s+/)[0] || undefined;
      } catch (error) {
        console.warn('Failed to load a passenger name', id, error);
      }
      out.set(id, {
        name,
        address: request.address || undefined,
        emissionsSavedKg: request.emissionsSavedKg,
      });
    } catch (error) {
      console.warn('Failed to load a passenger on this trip', id, error);
    }
  }));

  return out;
}

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

function buildRideCard(
  record: DisplayableRideRecord,
  kind: 'request' | 'offer',
  docId: string,
  driver?: DriverSummary,
  offer?: OfferView,
  stopPeople?: Map<string, StopPerson>,
): RideCardProps {
  const date = toDate(record.date);
  const departureTime = record.departureTime ?? '09:00';
  const arrivalTime = record.arrivalTime ?? '10:00';

  const planned = plannedTimes(record, kind, docId, offer);
  const durationMinutes = planned
    ? Math.max(1, Math.round((planned.endAt.getTime() - planned.startAt.getTime()) / 60_000))
    : Math.max(15, Math.abs(toMinutes(arrivalTime) - toMinutes(departureTime)) || 30);
  const estimated = (d: Date) => (kind === 'request' ? '~' : '') + formatClock(d);
  const readyBy = planned && kind === 'request'
    ? fromMinutes(Math.max(
      toMinutes(formatClock(planned.startAt)) - READY_BUFFER_MINUTES,
      toMinutes(departureTime),
    ))
    : undefined;

  const resolved: DriverSummary = kind === 'offer'
    ? { name: 'Your driving offer', vehicle: 'Your vehicle', plate: 'Your plate' }
    : driver ?? (record.matchedDriverId
      ? { name: 'Your driver', vehicle: 'Vehicle details coming soon', plate: 'Plate not shared' }
      : { name: 'Searching for a driver', vehicle: 'Vehicle pending', plate: 'Pending' });

  const seats = kind === 'offer'
    ? seatStateOf(record)
    : record.status === 'confirmed' && offer ? seatStateOf(offer) : undefined;

  const status = kind === 'offer' && record.status === 'pending' && (seats?.filled ?? 0) > 0
    ? 'confirmed'
    : record.status;

  return {
    rideId: docId,
    id: docId,
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
    timeWindow: planned ? undefined : { from: departureTime, to: arrivalTime },
    bookingWindow: { from: departureTime, to: arrivalTime },
    seats,
    arriveBy: arrivalTime,
    stops: middleStops(record, kind, docId, offer, stopPeople),
    cost: '$8.50',
    co2SavedKg: (() => {
      if (kind === 'request') {
        return record.emissionsSavedKg ?? 0;
      }
      const confirmedIds = record.confirmedRequestIds ?? [];
      if (confirmedIds.length === 0) {
        return 0;
      }
      const totalRiderEmissions = confirmedIds.reduce(
        (sum, id) => sum + (stopPeople?.get(id)?.emissionsSavedKg ?? 0),
        0,
      );
      return Math.round(totalRiderEmissions * 10) / 10;
    })(),
    driver: {
      uid: kind === 'request' ? record.matchedDriverId : record.userId,
      name: resolved.name,
      vehicle: resolved.vehicle,
    },
    plate: resolved.plate,
    driverPhone: resolved.phone,
    matchedAt: toDateOrUndefined(record.matchedAt),
    acceptDeadline: toDateOrUndefined(record.acceptDeadline),
    pickupDateTime: planned?.startAt ?? date,
  };
}

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

  const narrow = (docs: { id: string; data: () => unknown }[]) =>
    docs
      .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() as FirestoreRideRecord }))
      .map(({ id, data }) => ({ id, data: { ...data, status: data.status ?? 'pending' } }))
      .filter((row): row is { id: string; data: DisplayableRideRecord } => isDisplayable(row.data.status));

  const requestRows = narrow(requestsSnap.docs);
  const offerRows = narrow(offersSnap.docs);

  const [drivers, offers, stopPeople] = await Promise.all([
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
    fetchStopPeople(
      offerRows
        .flatMap((row) => [
          ...(row.data.confirmedRequestIds ?? []),
          ...(scheduleFor(row.data, 'offer', row.id)?.stops.map((stop) => stop.requestId) ?? []),
        ]),
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
    offers: offerRows.map(({ id, data }) => buildRideCard(data, 'offer', id, undefined, undefined, stopPeople)),
  };
}

export async function cancelRideRequest(requestId: string, userId: string, reason?: string): Promise<void> {
  const requestRef = doc(db, 'rideRequests', requestId);
  await updateDoc(requestRef, {
    status: 'cancelled' as RideStatus,
    cancelledAt: serverTimestamp(),
    cancelledBy: userId,
    ...(reason ? { cancelReason: reason } : {}),
  });
}

export async function cancelRideOffer(offerId: string, userId: string, reason?: string): Promise<void> {
  const offerRef = doc(db, 'rideOffers', offerId);
  await updateDoc(offerRef, {
    status: 'cancelled' as RideStatus,
    cancelledAt: serverTimestamp(),
    cancelledBy: userId,
    ...(reason ? { cancelReason: reason } : {}),
  });
}

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
