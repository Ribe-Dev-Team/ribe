import {
  collection, doc, DocumentData, getDoc, getDocs, onSnapshot, query, serverTimestamp, Timestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { RideCardProps, RideStatus, RideStop } from '../components/RideCard';
import { db } from '../firebaseConfig';
import { Coord } from '../pages/schema/booking.schema';
import { BookingStatus, DisplayableBookingStatus, isDisplayable } from '../pages/schema/matchStatus';
import { RiderCost, TripCosts } from '../pages/schema/firebaseBooking.schema';
import { formatDollars, headlineAmount, RideCostSplit } from '../utility/costDisplay';
import { MONASH_CLAYTON_LOCATION } from './googlePlaces';

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
  // Cancellation metadata (cancelRideRequest / cancelRideOffer / cancelConfirmedRide).
  matchedRequestId?: string;
  cancelledAt?: Timestamp | Date | string;
  cancelledBy?: string;
  cancelReason?: string;
}

type StoredTime = Timestamp | Date | string;

/** A car's timetable as the matcher stored it on the offer, with the car's
 *  cost split once the runner has priced it. */
interface StoredSchedule {
  departAt: StoredTime;
  arriveAt: StoredTime;
  stops: { requestId: string; pickupAt: StoredTime; arriveAt: StoredTime; cost?: RiderCost }[];
  costs?: Omit<TripCosts, 'calculatedAt'>;
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
  /** Make and model, "Toyota Corolla". */
  vehicle: string;
  colour?: string;
  plate: string;
  phone?: string;
  /** users/{uid}.profilePhotoUrl (or drivers/{uid}'s) - a data: URI. */
  photoUrl?: string;
}

/** A driver's profile as stored, before a card fills in what's missing - a
 *  rider's card and a driver's own card word a missing car differently. */
type StoredDriver = Partial<Omit<DriverSummary, 'name'>> & { name?: string };

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
 * The car timetable this card reads. A driver's: the proposal while a rider is
 * being asked (it includes them), else the confirmed one. A rider's: the
 * proposal while they're the one being asked, the confirmed one after.
 */
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

/**
 * The times the matcher actually planned, or undefined while there are none
 * (unmatched, or matched before timetables were stored). A rider's come from
 * their stop on the car's timetable, falling back to the snapshot on their own
 * request. A driver's are their departure and arrival.
 */
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

/**
 * The cost split this card shows, read from the same timetable as its times -
 * so a rider deciding on a match sees the split with them in the car. Worked
 * out by the matching runner; undefined until it has priced the car, and for a
 * rider still searching.
 */
function costSplitFor(
  record: DisplayableRideRecord,
  kind: 'request' | 'offer',
  docId: string,
  offer?: OfferView,
): RideCostSplit | undefined {
  if (kind === 'request' && record.status === 'pending') return undefined;
  const schedule = scheduleFor(record, kind, docId, offer);
  const trip = schedule?.costs;
  if (!schedule || !trip) return undefined;

  const shared = {
    medianFuelPrice: trip.medianFuelPrice,
    fuelType: trip.fuelType,
    fuelSource: trip.fuelSource,
    vehicleEconomy: trip.vehicleEconomy,
    tripDistanceKm: trip.tripDistanceKm,
    tripParticipants: trip.tripParticipants,
    fuelCost: trip.fuelCost,
    baseTripContribution: trip.baseTripContribution,
  };

  if (kind === 'offer') {
    const contributions = schedule.stops.map((s) => s.cost?.passengerContribution);
    if (contributions.some((c) => c === undefined)) return undefined;
    return {
      viewer: 'driver',
      ...shared,
      passengersTotal: (contributions as number[]).reduce((a, b) => a + b, 0),
    };
  }

  const own = schedule.stops.find((s) => s.requestId === docId)?.cost;
  if (!own) return undefined;
  return { viewer: 'rider', ...shared, ...own };
}

/** A passenger on a car: who they are, from users/{uid}, and where they're
 *  collected, from their request. */
interface StopPerson {
  name?: string;
  address?: string;
  coord?: Coord;
  photoUrl?: string;
  bio?: string;
  degree?: string;
}

/**
 * The pickups between where this card's trip starts and campus, in route
 * order, each at its estimated time. A driver's card lists every passenger,
 * by first name and address - they have to go there. A rider's lists only the
 * pickups after their own, and never another rider's name or address.
 *
 * Trips to campus only: on a trip home the stops are drop-offs, and the card
 * doesn't lay that direction out yet.
 */
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
    // The rider still deciding on this drive is on the proposal, not yet aboard.
    const name = person?.name && s.requestId === record.pendingRequestId
      ? `${person.name} (awaiting)`
      : person?.name;
    return {
      label: [name, person?.address].filter(Boolean).join(' · ') || `Passenger ${index + 1}`,
      time: '~' + formatClock(toDate(s.pickupAt)),
    };
  });
}

/**
 * The passengers at a car's stops: first name, photo, bio and degree from
 * users/{uid}, pickup address and point from their request. Once per request;
 * one that can't be read is left out, and the card labels that stop
 * "Passenger N" instead.
 */
async function fetchStopPeople(requestIds: string[]): Promise<Map<string, StopPerson>> {
  const unique = [...new Set(requestIds)];
  const out = new Map<string, StopPerson>();

  await Promise.all(unique.map(async (id) => {
    try {
      const snap = await getDoc(doc(db, 'rideRequests', id));
      if (!snap.exists()) return;
      const request = snap.data() as FirestoreRideRecord;
      let profile: DocumentData = {};
      try {
        const user = request.userId ? await getDoc(doc(db, 'users', request.userId)) : undefined;
        if (user?.exists()) profile = user.data();
      } catch (error) {
        console.warn('Failed to load a passenger name', id, error);
      }
      const text = (field: string) => (typeof profile[field] === 'string' && profile[field].trim()) || undefined;
      out.set(id, {
        name: text('name')?.split(/\s+/)[0],
        address: request.address || undefined,
        coord: request.coord,
        photoUrl: text('profilePhotoUrl'),
        bio: text('bio'),
        degree: text('degree'),
      });
    } catch (error) {
      console.warn('Failed to load a passenger on this trip', id, error);
    }
  }));

  return out;
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
async function fetchDrivers(uids: string[]): Promise<Map<string, StoredDriver>> {
  const unique = [...new Set(uids)];
  const out = new Map<string, StoredDriver>();

  await Promise.all(unique.map(async (uid) => {
    const profile = await fetchDriverProfile(uid);
    const field = (name: string) => (profile[name] || undefined) as string | undefined;

    const name = field('name');
    const vehicle = [field('vehicleMake'), field('vehicleModel')].filter(Boolean).join(' ');
    const plate = field('licensePlate');
    if (!name && !vehicle && !plate) return;

    out.set(uid, {
      name,
      vehicle: vehicle || undefined,
      colour: field('vehicleColor'),
      plate,
      phone: field('phoneNumber'),
      photoUrl: field('profilePhotoUrl'),
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
  driver?: StoredDriver,
  offer?: OfferView,
  stopPeople?: Map<string, StopPerson>,
): RideCardProps {
  const date = toDate(record.date);
  const departureTime = record.departureTime ?? '09:00';
  const arrivalTime = record.arrivalTime ?? '10:00';

  // Once matched, show the trip the matcher planned: real pickup and arrival,
  // and the time actually spent in the car. Until then all there is is the
  // user's own booking window, so show that.
  const planned = plannedTimes(record, kind, docId, offer);
  const costSplit = costSplitFor(record, kind, docId, offer);
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

  // On an offer the viewer IS the driver: their own photo, car and plate, from
  // the same profile lookup. On a request the matched driver's. A matched ride
  // whose driver profile can't be read still HAS a driver - only an unmatched
  // one is searching.
  const resolved: DriverSummary = kind === 'offer'
    ? {
      name: "You're driving",
      vehicle: driver?.vehicle ?? 'Add your vehicle in your profile',
      colour: driver?.colour,
      plate: driver?.plate ?? 'No plate',
      photoUrl: driver?.photoUrl,
    }
    : driver ? {
      ...driver,
      name: driver.name ?? 'Your driver',
      vehicle: driver.vehicle ?? 'Vehicle details coming soon',
      plate: driver.plate ?? 'Plate not shared',
    } : (record.matchedDriverId
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
    // Nothing planned yet: show the window they gave, not times that read as
    // a real pickup and arrival.
    timeWindow: planned ? undefined : { from: departureTime, to: arrivalTime },
    bookingWindow: { from: departureTime, to: arrivalTime },
    seats,
    // What they asked for, so a rider in a car still taking passengers can be
    // told they'll still arrive by it.
    arriveBy: arrivalTime,
    stops: middleStops(record, kind, docId, offer, stopPeople),
    cost: costLabel(costSplit),
    costSplit,
    // PLACEHOLDER: there is no distance-to-CO2 calculation in the codebase
    // yet, so this is a constant rather than data. It is NOT derived from the match.
    co2SavedKg: 2.4,
    driver: {
      uid: kind === 'request' ? record.matchedDriverId : record.userId,
      name: resolved.name,
      vehicle: resolved.vehicle,
      colour: resolved.colour,
      avatarUri: resolved.photoUrl,
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

/** The amount on a ride card, or 'TBC' until the runner has priced the car. */
function costLabel(split?: RideCostSplit): string {
  const amount = headlineAmount(split);
  return amount === undefined ? 'TBC' : formatDollars(amount);
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

/**
 * Call `onChange` whenever this user's ride requests or offers change, and
 * once each as the listeners start. Pages showing the user's rides rebuild
 * their cards from it, so they stay current without being remounted.
 *
 * It matters most after the app's own writes. Those are transactions
 * (setOfferLocked, acceptMatch...), which Firestore doesn't apply to its local
 * view straight away, and while a live listener is open on a query - App
 * keeps one on these two for notifications - a one-off read of the same query
 * is answered from that listener's view. A fetchUserRides right after a write
 * can therefore still see the old documents; the listener firing here is the
 * moment the change has really arrived.
 *
 * Returns the unsubscribe.
 */
export function watchUserRides(userId: string, onChange: () => void): () => void {
  const unsubscribeRequests = onSnapshot(
    query(collection(db, 'rideRequests'), where('userId', '==', userId)),
    () => onChange(),
  );
  const unsubscribeOffers = onSnapshot(
    query(collection(db, 'rideOffers'), where('userId', '==', userId)),
    () => onChange(),
  );
  return () => {
    unsubscribeRequests();
    unsubscribeOffers();
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

  // One round of driver, trip and passenger lookups covering every matched
  // request and every planned drive on this screen.
  const [drivers, offers, stopPeople] = await Promise.all([
    // Every matched driver, and the user themselves for their own drives' cards.
    fetchDrivers([
      ...requestRows
        .map((row) => row.data.matchedDriverId)
        .filter((uid): uid is string => Boolean(uid)),
      ...(offerRows.length > 0 ? [userId] : []),
    ]),
    fetchOfferViews(
      requestRows
        .map((row) => row.data.matchedOfferId)
        .filter((id): id is string => Boolean(id)),
    ),
    fetchStopPeople(
      offerRows
        .filter((row) => row.data.toUni)
        .flatMap((row) => scheduleFor(row.data, 'offer', row.id)?.stops ?? [])
        .map((stop) => stop.requestId),
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
    offers: offerRows.map(({ id, data }) => buildRideCard(data, 'offer', id, drivers.get(userId), undefined, stopPeople)),
  };
}

// ==========================================
// RIDE DETAILS PAGE
// ==========================================

/** One point on a ride's map, in route order. */
export interface RideMapPoint {
  lat: number;
  lng: number;
  label: string;
  kind: 'start' | 'stop' | 'end';
}

/** One stop on a ride's journey, in route order, as the details page lists it. */
export interface JourneyStop {
  kind: 'start' | 'stop' | 'end';
  /** "Departure", "Your pickup", "Pickup · Ana", "Drop-off"... */
  title: string;
  address?: string;
  /** The planned time, "~07:41"; absent until the matcher has planned the trip. */
  time?: string;
  /** Its marker on the map - A, 1, 2..., B - or absent when the stop isn't
   *  on the map (another rider's, on a rider's own journey). */
  marker?: string;
  /** A rider still deciding on a match to this car. */
  awaiting?: boolean;
}

/** Someone in the car, as the details page shows them. */
export interface RidePerson {
  name: string;
  /** users/{uid}.profilePhotoUrl - a data: URI from the profile photo picker. */
  photoUrl?: string;
  bio?: string;
  degree?: string;
  /** A rider still deciding on a match to this car - not aboard yet. */
  awaiting?: boolean;
}

export interface RideCar {
  make?: string;
  model?: string;
  colour?: string;
  plate?: string;
}

/** Everything the details page shows beyond the ride's own card. */
export interface RideDetails {
  /** A rider's driver, once matched. Absent for a driver's own offer. */
  driver?: RidePerson & { phone?: string };
  /** The car the ride is in: the matched driver's, or a driver's own. */
  car?: RideCar;
  /** Everyone else in the car, in pickup order. A rider sees the confirmed
   *  riders they share it with; a driver every passenger, the one still
   *  deciding included. */
  passengers: RidePerson[];
  /** Every stop, in order: where the trip starts, the stops along the way,
   *  where it ends. */
  journey: JourneyStop[];
  /** The journey's stops that go on the map, marked as `journey` names them. */
  mapPoints: RideMapPoint[];
  /** When this person's trip starts - pickup or departure - for revealing
   *  the driver's phone number. */
  startsAt?: Date;
}

const CAMPUS_STOP = { lat: MONASH_CLAYTON_LOCATION.lat, lng: MONASH_CLAYTON_LOCATION.lng, address: MONASH_CLAYTON_LOCATION.label };

const textField = (data: DocumentData, field: string) =>
  (typeof data[field] === 'string' && data[field].trim()) || undefined;

function carOf(profile: DocumentData): RideCar | undefined {
  const car = {
    make: textField(profile, 'vehicleMake'),
    model: textField(profile, 'vehicleModel'),
    colour: textField(profile, 'vehicleColor'),
    plate: textField(profile, 'licensePlate'),
  };
  return Object.values(car).some(Boolean) ? car : undefined;
}

/** A stop being built: a journey stop plus, if it goes on the map, where. */
type DraftStop = Omit<JourneyStop, 'marker'> & { at?: { lat: number; lng: number } };

const estimated = (time?: StoredTime) => (time ? '~' + formatClock(toDate(time)) : undefined);

/** This booking's own end of the trip - the other end is always campus. */
const ownPlace = (record: FirestoreRideRecord) => ({
  address: record.address || undefined,
  at: record.coord ? { lat: record.coord.lat, lng: record.coord.lon } : undefined,
});

/** Mark the stops that go on the map - A, numbered stops, B - and list them. */
function finishJourney(drafts: DraftStop[]): Pick<RideDetails, 'journey' | 'mapPoints'> {
  let stopNumber = 0;
  const journey: JourneyStop[] = [];
  const mapPoints: RideMapPoint[] = [];
  for (const { at, ...stop } of drafts) {
    if (!at) { journey.push(stop); continue; }
    const marker = stop.kind === 'start' ? 'A' : stop.kind === 'end' ? 'B' : String(++stopNumber);
    journey.push({ ...stop, marker });
    mapPoints.push({ ...at, label: stop.title, kind: stop.kind });
  }
  return { journey, mapPoints };
}

/**
 * Load a ride's details page: its journey and map, who's driving and in what,
 * and who else is in the car.
 *
 * A driver's journey is their whole route - departure, each passenger's stop
 * by name and address, the end. A rider's lists their own stop and campus, and
 * the other riders' stops only as "another passenger" with a time: as on their
 * card, a rider never sees another rider's name or address on the route, and
 * their map shows only their own two points. Anything that can't be read is
 * left out rather than failing the page.
 */
export async function fetchRideDetails(rideId: string, kind: 'request' | 'offer'): Promise<RideDetails> {
  const empty: RideDetails = { passengers: [], journey: [], mapPoints: [] };
  const snap = await getDoc(doc(db, kind === 'offer' ? 'rideOffers' : 'rideRequests', rideId));
  if (!snap.exists()) return empty;
  const data = snap.data() as FirestoreRideRecord;
  if (!isDisplayable(data.status ?? 'pending')) return empty;
  let record = { ...data, status: data.status ?? 'pending' } as DisplayableRideRecord;
  const own = ownPlace(record);
  const campus = { address: CAMPUS_STOP.address, at: { lat: CAMPUS_STOP.lat, lng: CAMPUS_STOP.lng } };

  const toPerson = (p: StopPerson | undefined, fallback: string, awaiting = false): RidePerson => ({
    name: p?.name ?? fallback,
    photoUrl: p?.photoUrl,
    bio: p?.bio,
    degree: p?.degree,
    ...(awaiting ? { awaiting } : {}),
  });

  if (kind === 'offer') {
    const schedule = scheduleFor(record, 'offer', rideId);
    const ids = schedule?.stops.map((s) => s.requestId)
      ?? [...(record.confirmedRequestIds ?? []), ...(record.pendingRequestId ? [record.pendingRequestId] : [])];
    const [people, profile] = await Promise.all([fetchStopPeople(ids), fetchDriverProfile(record.userId)]);

    // Going to campus a stop is a pickup; coming home, a drop-off.
    const stops: DraftStop[] = ids.map((id, i) => {
      const p = people.get(id);
      const stop = schedule?.stops.find((s) => s.requestId === id);
      return {
        kind: 'stop',
        title: `${record.toUni ? 'Pickup' : 'Drop-off'} · ${p?.name ?? `Passenger ${i + 1}`}`,
        address: p?.address,
        time: estimated(record.toUni ? stop?.pickupAt : stop?.arriveAt),
        at: p?.coord && { lat: p.coord.lat, lng: p.coord.lon },
        ...(id === record.pendingRequestId ? { awaiting: true } : {}),
      };
    });
    const [from, to] = record.toUni ? [own, campus] : [campus, own];

    return {
      car: carOf(profile),
      passengers: ids.map((id, i) => toPerson(people.get(id), `Passenger ${i + 1}`, id === record.pendingRequestId)),
      ...finishJourney([
        // The driver sets the departure, so it isn't an estimate.
        { kind: 'start', title: 'Departure', ...from, time: schedule ? formatClock(toDate(schedule.departAt)) : undefined },
        ...stops,
        { kind: 'end', title: record.toUni ? 'Drop-off' : 'Home', ...to, time: estimated(schedule?.arriveAt) },
      ]),
      startsAt: schedule ? toDate(schedule.departAt) : undefined,
    };
  }

  const offer = record.matchedOfferId ? (await fetchOfferViews([record.matchedOfferId])).get(record.matchedOfferId) : undefined;
  record = asSearchingIfDropped(record, rideId, offer);
  const matched = record.status !== 'pending' && offer && record.matchedDriverId;
  const schedule = matched ? scheduleFor(record, 'request', rideId, offer) : undefined;
  const ownIndex = schedule?.stops.findIndex((s) => s.requestId === rideId) ?? -1;
  const ownStop = ownIndex >= 0 ? schedule!.stops[ownIndex] : undefined;

  // The other riders' stops between this rider's two ends: pickups after
  // theirs going to campus, drop-offs before theirs coming home.
  const othersOnTheWay: DraftStop[] = !schedule || ownIndex < 0 ? [] : (record.toUni
    ? schedule.stops.slice(ownIndex + 1).map((s) => ({ kind: 'stop' as const, title: 'Pickup · another passenger', time: estimated(s.pickupAt) }))
    : schedule.stops.slice(0, ownIndex).map((s) => ({ kind: 'stop' as const, title: 'Drop-off · another passenger', time: estimated(s.arriveAt) })));

  const route = finishJourney(record.toUni
    ? [
      { kind: 'start', title: 'Your pickup', ...own, time: estimated(ownStop?.pickupAt ?? record.pickupAt) },
      ...othersOnTheWay,
      { kind: 'end', title: 'Drop-off', ...campus, time: estimated(ownStop?.arriveAt ?? record.arriveAt) },
    ]
    : [
      { kind: 'start', title: 'Pickup', ...campus, time: estimated(ownStop?.pickupAt ?? record.pickupAt) },
      ...othersOnTheWay,
      { kind: 'end', title: 'Your drop-off', ...own, time: estimated(ownStop?.arriveAt ?? record.arriveAt) },
    ]);
  if (!matched) return { ...empty, ...route };

  // The riders they'd share the car with: those already confirmed in it.
  const others = (offer.confirmedRequestIds ?? []).filter((id) => id !== rideId);
  const [people, profile] = await Promise.all([fetchStopPeople(others), fetchDriverProfile(record.matchedDriverId!)]);
  const planned = plannedTimes(record, 'request', rideId, offer);

  return {
    driver: {
      name: textField(profile, 'name') ?? 'Your driver',
      photoUrl: textField(profile, 'profilePhotoUrl'),
      bio: textField(profile, 'bio'),
      degree: textField(profile, 'degree'),
      phone: textField(profile, 'phoneNumber'),
    },
    car: carOf(profile),
    passengers: others.map((id) => toPerson(people.get(id), 'Another passenger')),
    ...route,
    startsAt: planned?.startAt,
  };
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
