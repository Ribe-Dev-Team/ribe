/*
The app and the matching module both use the word `pending`, for different
things. These tests pin the translation down, because getting it wrong would
feed already-matched requests back into the matcher as if they were still
looking - silently double-booking riders.
*/

import {
  BOOKING_STATUSES,
  BookingStatus,
  MatchRequestStatus,
  fromMatchRequestStatus,
  isBookingStatus,
  isDisplayable,
  isMatchable,
  isTerminal,
  toMatchRequestStatus,
} from '../../mobile/pages/schema/matchStatus';

describe('toMatchRequestStatus', () => {
  test("app 'pending' means NOT yet matched, so it maps to 'unassigned'", () => {
    expect(toMatchRequestStatus('pending')).toBe('unassigned');
  });

  test("app 'awaiting' means matched-and-waiting, so it maps to 'pending'", () => {
    // The collision this whole module exists for: the same word, opposite side.
    expect(toMatchRequestStatus('awaiting')).toBe('pending');
  });

  test('confirmed, cancelled and expired carry across unchanged', () => {
    expect(toMatchRequestStatus('confirmed')).toBe('confirmed');
    expect(toMatchRequestStatus('cancelled')).toBe('cancelled');
    expect(toMatchRequestStatus('expired')).toBe('expired');
  });

  test('every stored status maps to something', () => {
    for (const s of BOOKING_STATUSES) {
      expect(toMatchRequestStatus(s)).toBeDefined();
    }
  });
});

describe('round trip', () => {
  test('booking -> match -> booking is the identity for every status', () => {
    for (const s of BOOKING_STATUSES) {
      expect(fromMatchRequestStatus(toMatchRequestStatus(s))).toBe(s);
    }
  });

  test('match -> booking -> match is the identity for every status', () => {
    const all: MatchRequestStatus[] = ['unassigned', 'pending', 'confirmed', 'cancelled', 'expired'];
    for (const s of all) {
      expect(toMatchRequestStatus(fromMatchRequestStatus(s))).toBe(s);
    }
  });
});

describe('isMatchable', () => {
  test('only a freshly created booking is matchable', () => {
    expect(isMatchable('pending')).toBe(true);
  });

  test('a booking already matched or finished is not matchable', () => {
    // 'awaiting' is the dangerous one: it reads like "still waiting to be
    // matched" but actually means "matched, waiting on a human".
    expect(isMatchable('awaiting')).toBe(false);
    expect(isMatchable('confirmed')).toBe(false);
    expect(isMatchable('cancelled')).toBe(false);
    expect(isMatchable('expired')).toBe(false);
  });
});

describe('isTerminal / isDisplayable', () => {
  test('cancelled and expired are terminal', () => {
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('expired')).toBe(true);
  });

  test('in-play statuses are not terminal', () => {
    expect(isTerminal('pending')).toBe(false);
    expect(isTerminal('awaiting')).toBe(false);
    expect(isTerminal('confirmed')).toBe(false);
  });

  test('isDisplayable is the complement of isTerminal', () => {
    for (const s of BOOKING_STATUSES) {
      expect(isDisplayable(s)).toBe(!isTerminal(s));
    }
  });
});

describe('isBookingStatus', () => {
  test('accepts every known status', () => {
    for (const s of BOOKING_STATUSES) expect(isBookingStatus(s)).toBe(true);
  });

  test('rejects matcher-side vocabulary that is not stored', () => {
    // 'unassigned' is a matcher status, never a Firestore one.
    expect(isBookingStatus('unassigned')).toBe(false);
  });

  test('rejects junk', () => {
    expect(isBookingStatus('')).toBe(false);
    expect(isBookingStatus(undefined)).toBe(false);
    expect(isBookingStatus(null)).toBe(false);
    expect(isBookingStatus(7)).toBe(false);
  });
});

describe('vocabulary drift guard', () => {
  test('BOOKING_STATUSES lists exactly the BookingStatus union', () => {
    // If someone adds a status to the type without adding it here, the
    // assignment below stops compiling.
    const exhaustive: Record<BookingStatus, true> = {
      pending: true, awaiting: true, confirmed: true, cancelled: true, expired: true,
    };
    expect(Object.keys(exhaustive).sort()).toEqual([...BOOKING_STATUSES].sort());
  });
});
