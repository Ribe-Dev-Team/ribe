import {
  Coord, DEFAULT_CONFIG, Direction, MatchingConfig, MatchOffer, MatchRequest,
  OnBoardRider, TravelTimeMatrix,
} from './types';
import { evaluateRoute } from './route';
import { deriveRiderMaxDetour } from './riderPolicy';
import {
  CalendarDate, CAMPUS_TIME_ZONE, calendarDateIn, dateKey, isHhMm, zonedDateTime,
} from './melbourneTime';

/**
 * Firestore bookings -> matcher inputs.
 *
 * The shapes below are the stored `rideRequests` / `rideOffers` documents
 * (mobile/pages/schema/firebaseBooking.schema.ts) with Timestamps already turned
 * into Dates. They are declared structurally, not imported, for the same reason
 * matchStatus.ts duplicates its status union: neither package should bundle the
 * other. Everything here is pure; runner/firestore.ts does the reading.
 */

/** Same point as MONASH_CLAYTON_LOCATION in mobile/services/googlePlaces.ts. */
export const MONASH_CLAYTON: Coord = { lat: -37.9106, lon: 145.1361 };

/** The only stored status the matcher may pick up. The app's 'pending' means
 *  "not matched yet" (the matcher's 'unassigned') - see matchStatus.ts. */
export const MATCHABLE_APP_STATUS = 'pending';

export interface RequestDoc {
  id: string;
  userId: string;
  status: string;
  toUni: boolean;
  coord?: Coord;
  /** The stored date: the phone's local midnight, as an instant. */
  date: Date;
  /** "HH:mm" - earliest departure. */
  departureTime: string;
  /** "HH:mm" - latest arrival. */
  arrivalTime: string;
}

export interface OfferDoc extends RequestDoc {
  maxDetourTime: number;
  seatCapacity: number;
  pendingRequestId?: string | null;
  /** Riders who accepted in earlier runs, in pickup order. */
  confirmedRequestIds?: string[];
}

export type SkipReason =
  | 'NOT_MATCHABLE'            // status is not 'pending'
  | 'NO_COORD'                 // address never resolved to a point
  | 'BAD_TIME'                 // missing date or a malformed HH:mm
  | 'DEPARTED'                 // the trip is already over or under way
  | 'SLOT_TAKEN'               // offer already holds a rider awaiting approval
  | 'CONFIRMED_RIDER_UNKNOWN'; // a confirmed rider's request can't be read back

export interface Skipped {
  kind: 'request' | 'offer';
  id: string;
  reason: SkipReason;
}

/** One day's trips in one direction - the unit a matching run works on. */
export interface DocBatch {
  /** e.g. "2026-10-05_TO_CAMPUS". Derived from the stored date and toUni, neither
   *  of which changes after submission, so it is stable without being stored. */
  batchKey: string;
  date: CalendarDate;
  direction: Direction;
  requests: RequestDoc[];
  offers: OfferDoc[];
}

const directionOf = (doc: RequestDoc): Direction => (doc.toUni ? 'TO_CAMPUS' : 'FROM_CAMPUS');

/** Rider or driver: [own start, own end]. One end is always campus. */
function endpoints(doc: RequestDoc & { coord: Coord }, campus: Coord): [Coord, Coord] {
  return doc.toUni ? [doc.coord, campus] : [campus, doc.coord];
}

function hasValidTimes(doc: RequestDoc): boolean {
  return !Number.isNaN(doc.date.getTime()) && isHhMm(doc.departureTime) && isHhMm(doc.arrivalTime);
}

/**
 * Sort matchable bookings into batches by date and direction, and report every
 * booking left out with the reason.
 *
 * Needs no travel times, so the runner can size each batch's Google matrix to
 * that batch alone rather than paying for legs between different days.
 */
export function groupIntoBatches(
  requestDocs: RequestDoc[],
  offerDocs: OfferDoc[],
  now: Date,
  timeZone = CAMPUS_TIME_ZONE,
): { batches: DocBatch[]; skipped: Skipped[] } {
  const skipped: Skipped[] = [];
  const byKey = new Map<string, DocBatch>();

  const place = (doc: RequestDoc, kind: 'request' | 'offer'): DocBatch | null => {
    const skip = (reason: SkipReason) => { skipped.push({ kind, id: doc.id, reason }); return null; };

    if (doc.status !== MATCHABLE_APP_STATUS) return skip('NOT_MATCHABLE');
    if (kind === 'offer' && (doc as OfferDoc).pendingRequestId) return skip('SLOT_TAKEN');
    if (!doc.coord) return skip('NO_COORD');
    if (!hasValidTimes(doc)) return skip('BAD_TIME');

    const date = calendarDateIn(doc.date, timeZone);
    // A driver is gone once they leave; a rider's request is dead once the time
    // they needed to arrive by has passed.
    const endsAt = zonedDateTime(date, kind === 'offer' ? doc.departureTime : doc.arrivalTime, timeZone);
    if (endsAt <= now) return skip('DEPARTED');

    const direction = directionOf(doc);
    const batchKey = `${dateKey(date)}_${direction}`;
    let batch = byKey.get(batchKey);
    if (!batch) {
      batch = { batchKey, date, direction, requests: [], offers: [] };
      byKey.set(batchKey, batch);
    }
    return batch;
  };

  for (const doc of requestDocs) place(doc, 'request')?.requests.push(doc);
  for (const doc of offerDocs) place(doc, 'offer')?.offers.push(doc);

  const batches = [...byKey.values()].sort((a, b) => a.batchKey.localeCompare(b.batchKey));
  return { batches, skipped };
}

/**
 * Every point a run over `batch` could look up a travel time between: campus,
 * each booking's own point, and each already-confirmed rider's. Feed this to the
 * travel-time matrix builder once per batch.
 */
export function batchPoints(
  batch: DocBatch,
  confirmedById: Map<string, RequestDoc>,
  campus: Coord = MONASH_CLAYTON,
): Coord[] {
  const points: Coord[] = [campus];
  for (const r of batch.requests) if (r.coord) points.push(r.coord);
  for (const o of batch.offers) {
    if (o.coord) points.push(o.coord);
    for (const id of o.confirmedRequestIds ?? []) {
      const coord = confirmedById.get(id)?.coord;
      if (coord) points.push(coord);
    }
  }
  return points;
}

export interface AdapterOptions {
  campus?: Coord;
  cfg?: MatchingConfig;
  timeZone?: string;
}

/**
 * Convert one batch into the matcher's types.
 *
 * `confirmedById` must hold the stored request of every rider listed in any
 * offer's `confirmedRequestIds` - they are rebuilt as that trip's fixed
 * `onBoard` riders. An offer whose confirmed riders can't all be rebuilt is left
 * out rather than matched against a route missing a real passenger.
 */
export function toMatchInputs(
  batch: DocBatch,
  confirmedById: Map<string, RequestDoc>,
  t: TravelTimeMatrix,
  opts: AdapterOptions = {},
): { requests: MatchRequest[]; offers: MatchOffer[]; skipped: Skipped[] } {
  const campus = opts.campus ?? MONASH_CLAYTON;
  const cfg = opts.cfg ?? DEFAULT_CONFIG;
  const timeZone = opts.timeZone ?? CAMPUS_TIME_ZONE;
  const skipped: Skipped[] = [];

  const requests = batch.requests
    .filter((doc): doc is RequestDoc & { coord: Coord } => Boolean(doc.coord))
    .map((doc) => toMatchRequest(doc, campus, t, cfg, timeZone));

  const offers: MatchOffer[] = [];
  for (const doc of batch.offers) {
    const offer = doc.coord
      ? toMatchOffer(doc as OfferDoc & { coord: Coord }, confirmedById, campus, t, cfg, timeZone)
      : null;
    if (offer) offers.push(offer);
    else skipped.push({ kind: 'offer', id: doc.id, reason: doc.coord ? 'CONFIRMED_RIDER_UNKNOWN' : 'NO_COORD' });
  }

  return { requests, offers, skipped };
}

/** The departure lookup to pass as `runMatchingProvisional`'s `departAt`: each
 *  driver is routed from their own stated departure time. */
export const offerDeparture = (offer: MatchOffer): Date => offer.travelWindow.start;

/**
 * A rider's window is the span they could LEAVE in: from their stated earliest
 * departure to the latest start that still reaches their destination by their
 * stated arrival time, going direct. Their detour cap is derived from that same
 * direct trip (riderPolicy.ts) because the app never asks for one.
 */
function toMatchRequest(
  doc: RequestDoc & { coord: Coord },
  campus: Coord,
  t: TravelTimeMatrix,
  cfg: MatchingConfig,
  timeZone: string,
): MatchRequest {
  const [start, end] = endpoints(doc, campus);
  const date = calendarDateIn(doc.date, timeZone);
  const earliest = zonedDateTime(date, doc.departureTime, timeZone);
  const arriveBy = zonedDateTime(date, doc.arrivalTime, timeZone);
  const direct = t.minutes(start, end);
  const latest = new Date(Math.max(earliest.getTime(), arriveBy.getTime() - direct * 60_000));

  return {
    reqId: doc.id,
    riderId: doc.userId,
    direction: directionOf(doc),
    start,
    end,
    travelWindow: { start: earliest, end: latest },
    arriveBy,
    maxDetour: deriveRiderMaxDetour(direct, cfg),
    status: 'unassigned',
  };
}

/**
 * A driver leaves at their stated departure time. Two things follow from their
 * stated arrival time as well:
 *
 *  - Their detour cap is the smaller of what they offered and what their own
 *    window leaves after the direct drive. The form only checks the offer
 *    against the whole window, so a driver with a 30-minute drive in a 40-minute
 *    window who offered 15 minutes of detour can really only give 10.
 *
 *  - Their `travelWindow` (what the time filter compares against a rider's) is
 *    when the car could be at a rider's door. Leaving campus, every passenger
 *    boards at departure, so it is exactly the departure time. Heading to
 *    campus, pickups happen somewhere along the drive, so it spans departure to
 *    the latest the car could still be on the road - generous on purpose, like
 *    the corridor test, because a pair wrongly rejected here is never seen again.
 *    Arrival times are then checked precisely by `bestInsertion`.
 */
function toMatchOffer(
  doc: OfferDoc & { coord: Coord },
  confirmedById: Map<string, RequestDoc>,
  campus: Coord,
  t: TravelTimeMatrix,
  cfg: MatchingConfig,
  timeZone: string,
): MatchOffer | null {
  const [start, end] = endpoints(doc, campus);
  const date = calendarDateIn(doc.date, timeZone);
  const departAt = zonedDateTime(date, doc.departureTime, timeZone);
  const driverArriveBy = zonedDateTime(date, doc.arrivalTime, timeZone);
  const direct = t.minutes(start, end);
  const windowMinutes = (driverArriveBy.getTime() - departAt.getTime()) / 60_000;
  const maxDetour = Math.max(0, Math.min(doc.maxDetourTime, windowMinutes - direct));

  const onBoard = rebuildOnBoard(doc.confirmedRequestIds ?? [], confirmedById, campus, t, cfg, timeZone);
  if (!onBoard) return null;

  let currTripDuration = 0;
  if (onBoard.length > 0) {
    const ev = evaluateRoute(start, onBoard.map((r) => r.waypoint), end, departAt, t);
    ev.riderDetours.forEach((d, i) => { onBoard[i].currentDetour = d; });
    currTripDuration = ev.totalMinutes;
  }

  const lastPickup = doc.toUni
    ? new Date(departAt.getTime() + (direct + maxDetour) * 60_000)
    : departAt;

  return {
    offerId: doc.id,
    driverId: doc.userId,
    direction: directionOf(doc),
    start,
    end,
    travelWindow: { start: departAt, end: lastPickup },
    maxDetour,
    seatsOffered: doc.seatCapacity,
    seatsFilled: onBoard.length,
    acceptingMore: true,
    status: onBoard.length >= doc.seatCapacity ? 'closed' : 'open',
    onBoard,
    currTripDuration,
  };
}

/** Confirmed riders in stored pickup order, or null if any can't be rebuilt. */
function rebuildOnBoard(
  ids: string[],
  confirmedById: Map<string, RequestDoc>,
  campus: Coord,
  t: TravelTimeMatrix,
  cfg: MatchingConfig,
  timeZone: string,
): OnBoardRider[] | null {
  const onBoard: OnBoardRider[] = [];
  for (const id of ids) {
    const r = confirmedById.get(id);
    if (!r || !r.coord || !hasValidTimes(r)) return null;
    const [start, end] = endpoints(r as RequestDoc & { coord: Coord }, campus);
    onBoard.push({
      reqId: r.id,
      riderId: r.userId,
      waypoint: r.coord,
      arriveBy: zonedDateTime(calendarDateIn(r.date, timeZone), r.arrivalTime, timeZone),
      maxDetour: deriveRiderMaxDetour(t.minutes(start, end), cfg),
      currentDetour: 0, // restated from the evaluated route by the caller
    });
  }
  return onBoard;
}
