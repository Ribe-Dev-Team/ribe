/*
Translation between the app's booking status vocabulary (what Firestore stores
and the UI renders) and the matching module's request status vocabulary
(matching/src/types.ts).

WHY THIS FILE EXISTS - the word `pending` means two different things:

    app 'pending'   = created, NOT yet matched      -> matcher 'unassigned'
    app 'awaiting'  = matched, awaiting approval    -> matcher 'pending'
    matcher 'pending' = matched, awaiting approval

Passing an app status straight into the matcher would therefore feed
already-matched requests back in as if they were still looking, quietly
double-booking riders. The mapping is deliberately explicit and total so that
collision has exactly one place to live, and adding a status to either side
fails the build here rather than silently falling through.

The app vocabulary was kept rather than renamed to match the matcher: it is
load-bearing across RideCard, CalendarPage, DashboardPage and RideDetailPage
(colours, approval countdowns, Accept/Decline wiring), and renaming would have
flipped the meaning of `pending` mid-codebase.

NOTE: when the matching run moves server-side, this belongs next to the adapter
rather than under mobile/. It is deliberately dependency-free so it can move.
*/

/** What Firestore stores on a rideRequest/rideOffer document. */
export type BookingStatus = 'pending' | 'awaiting' | 'confirmed' | 'cancelled' | 'expired';

/** matching/src/types.ts -> MatchRequest['status']. Duplicated rather than
 *  imported so this module stays free of a dependency on the matching package,
 *  which mobile does not (and should not) bundle. */
export type MatchRequestStatus = 'unassigned' | 'pending' | 'confirmed' | 'cancelled' | 'expired';

/** Statuses the matcher should consider. Anything else is already spoken for. */
export const MATCHABLE_BOOKING_STATUSES: readonly BookingStatus[] = ['pending'];

/** Every valid stored status, for runtime validation of untrusted input. */
export const BOOKING_STATUSES: readonly BookingStatus[] = [
  'pending', 'awaiting', 'confirmed', 'cancelled', 'expired',
];

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && (BOOKING_STATUSES as readonly string[]).includes(value);
}

/*
Total maps, written as Records so TypeScript rejects an unhandled status the
moment either union gains a member.
*/
const TO_MATCH: Record<BookingStatus, MatchRequestStatus> = {
  pending: 'unassigned',
  awaiting: 'pending',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
  expired: 'expired',
};

const FROM_MATCH: Record<MatchRequestStatus, BookingStatus> = {
  unassigned: 'pending',
  pending: 'awaiting',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
  expired: 'expired',
};

/** Firestore status -> matching module status. */
export function toMatchRequestStatus(status: BookingStatus): MatchRequestStatus {
  return TO_MATCH[status];
}

/** Matching module status -> Firestore status. */
export function fromMatchRequestStatus(status: MatchRequestStatus): BookingStatus {
  return FROM_MATCH[status];
}

/** Whether a stored booking is still looking for a match. */
export function isMatchable(status: BookingStatus): boolean {
  return toMatchRequestStatus(status) === 'unassigned';
}

/** Whether a booking has reached an end state and should drop out of the
 *  active ride lists the UI renders. */
export function isTerminal(status: BookingStatus): boolean {
  return status === 'cancelled' || status === 'expired';
}

/*
The subset RideCard can actually render. Kept as a derived type rather than a
hand-written union so it cannot drift from BookingStatus, and structurally
identical to RideCard's own RideStatus - which is why filtering on the guard
below is enough to satisfy the compiler at that boundary.
*/
export type DisplayableBookingStatus = Exclude<BookingStatus, 'cancelled' | 'expired'>;

export function isDisplayable(status: BookingStatus): status is DisplayableBookingStatus {
  return !isTerminal(status);
}
