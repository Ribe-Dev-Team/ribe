// Integration tests for how a rider answers a match (acceptMatch / declineMatch in
// mobile/pages/schema/firebaseBookingMethods.ts) and a driver removes an offer
// (cancelOffer), against the shared in-memory
// Firestore mock. Matches themselves are written by the matching runner
// (matching/runner/); these cover the app's half of the round trip.

import {
  acceptMatch, cancelOffer, declineMatch, setOfferLocked, updateOfferSeats,
} from '../../mobile/pages/schema/firebaseBookingMethods';
import { db } from '../../mobile/firebaseConfig';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

// The mocked Firestore uses real setTimeout delays internally; jest.setup.js
// switches the suite to fake timers by default, which would hang these awaits.
jest.useRealTimers();

const HOUR = 3_600_000;
let n = 0;

const departAt = new Date('2026-10-05T20:45:00Z');
const at = (min: number) => Timestamp.fromDate(new Date(departAt.getTime() + min * 60_000));

/** A car's timetable for these riders, in pickup order, as the runner stores it. */
const timetable = (ids: string[]) => ({
  departAt: at(0),
  arriveAt: at(30),
  stops: ids.map((requestId, i) => ({ requestId, pickupAt: at(5 + 5 * i), arriveAt: at(30) })),
});

/** Seeds one driver's offer and one rider matched to it, under fresh ids. */
async function seedMatch(opts: {
  confirmed?: string[];
  seatCapacity?: number;
  routeIndex?: number;
  deadlineFromNow?: number;
  /** False for a match written before the runner stored timetables. */
  timetables?: boolean;
} = {}) {
  n += 1;
  const reqId = `req-${n}`;
  const offerId = `offer-${n}`;
  const matchedAt = Timestamp.fromDate(new Date());
  const acceptDeadline = Timestamp.fromDate(new Date(Date.now() + (opts.deadlineFromNow ?? HOUR)));
  const confirmed = opts.confirmed ?? [];
  const withTimes = opts.timetables ?? true;
  // The runner's proposal: the confirmed riders with this one at their position.
  const position = opts.routeIndex ?? confirmed.length;
  const proposed = timetable([...confirmed.slice(0, position), reqId, ...confirmed.slice(position)]);

  await setDoc(doc(db, 'rideRequests', reqId), {
    status: 'awaiting',
    matchedOfferId: offerId,
    matchedDriverId: 'driver-uid',
    matchedAt,
    acceptDeadline,
    riderDetourMinutes: 4,
    ...(opts.routeIndex === undefined ? {} : { routeIndex: opts.routeIndex }),
    ...(withTimes ? { pickupAt: at(10), arriveAt: at(30) } : {}),
  });
  await setDoc(doc(db, 'rideOffers', offerId), {
    status: 'awaiting',
    seatCapacity: opts.seatCapacity ?? 4,
    pendingRequestId: reqId,
    // What lets the rider update this offer under the published Firestore rules.
    matchedRiderId: 'rider-uid',
    confirmedRequestIds: confirmed,
    matchedAt,
    acceptDeadline,
    ...(confirmed.length > 0 ? { schedule: timetable(confirmed) } : {}),
    ...(withTimes ? { pendingSchedule: proposed } : {}),
  });
  return { reqId, offerId, proposed };
}

const read = async (collection: string, id: string) => (await getDoc(doc(db, collection, id))).data();

describe('acceptMatch', () => {
  it("inserts the rider at their pickup position, not at the end", async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a', 'b'], routeIndex: 1 });

    await acceptMatch(reqId);

    expect((await read('rideRequests', reqId)).status).toBe('confirmed');
    expect(await read('rideOffers', offerId)).toMatchObject({
      confirmedRequestIds: ['a', reqId, 'b'],
      pendingRequestId: null,
      // Seats left, so the trip goes back into the matcher's pool.
      status: 'pending',
    });
    // Once answered, the rider loses their permission to edit the driver's offer.
    expect(await read('rideOffers', offerId)).not.toHaveProperty('matchedRiderId');
  });

  it("puts the re-planned timetable in place of the car's old one", async () => {
    const { reqId, offerId, proposed } = await seedMatch({ confirmed: ['a', 'b'], routeIndex: 1 });

    await acceptMatch(reqId);

    const offer = await read('rideOffers', offerId);
    expect(offer.schedule).toEqual(proposed);
    expect(offer.schedule.stops.map((s: { requestId: string }) => s.requestId)).toEqual(['a', reqId, 'b']);
    expect(offer).not.toHaveProperty('pendingSchedule');
  });

  it('drops a timetable the new rider is missing from, for a match made before timetables', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], timetables: false });

    await acceptMatch(reqId);

    expect(await read('rideOffers', offerId)).not.toHaveProperty('schedule');
  });

  it('confirms the trip once the last seat is taken', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], seatCapacity: 2, routeIndex: 0 });

    await acceptMatch(reqId);

    expect(await read('rideOffers', offerId)).toMatchObject({
      confirmedRequestIds: [reqId, 'a'],
      status: 'confirmed',
    });
  });

  it('appends when the match carries no stored position', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'] });

    await acceptMatch(reqId);

    expect((await read('rideOffers', offerId)).confirmedRequestIds).toEqual(['a', reqId]);
  });

  it('refuses once the accept deadline has passed, and writes nothing', async () => {
    const { reqId, offerId } = await seedMatch({ deadlineFromNow: -60_000 });

    await expect(acceptMatch(reqId)).rejects.toThrow(/expired/);

    expect((await read('rideRequests', reqId)).status).toBe('awaiting');
    expect((await read('rideOffers', offerId)).pendingRequestId).toBe(reqId);
  });

  it('refuses once the driver has removed the offer', async () => {
    const { reqId, offerId } = await seedMatch();
    await cancelOffer(offerId);

    await expect(acceptMatch(reqId)).rejects.toThrow(/removed this offer/);
    expect((await read('rideRequests', reqId)).status).toBe('awaiting');
  });

  it('refuses a request that is not awaiting approval', async () => {
    const { reqId } = await seedMatch();
    await acceptMatch(reqId);

    await expect(acceptMatch(reqId)).rejects.toThrow(/not awaiting approval/);
  });
});

describe('declineMatch', () => {
  it('cancels the request with every match field removed, and frees the slot', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], routeIndex: 0 });

    await declineMatch(reqId);

    // Cancelled, not back in the pool: the rider books again if they still want a ride.
    const request = await read('rideRequests', reqId);
    expect(request.status).toBe('cancelled');
    for (const field of [
      'matchedOfferId', 'matchedDriverId', 'matchedAt', 'acceptDeadline', 'riderDetourMinutes', 'routeIndex',
      'pickupAt', 'arriveAt',
    ]) {
      expect(request).not.toHaveProperty(field);
    }

    const offer = await read('rideOffers', offerId);
    expect(offer).toMatchObject({ status: 'pending', pendingRequestId: null, confirmedRequestIds: ['a'] });
    expect(offer).not.toHaveProperty('acceptDeadline');
    expect(offer).not.toHaveProperty('matchedRiderId');
    // The proposal is gone; the confirmed riders' timetable is untouched.
    expect(offer).not.toHaveProperty('pendingSchedule');
    expect(offer.schedule).toEqual(timetable(['a']));
  });
});

describe('cancelOffer', () => {
  it('removes the offer and clears the slot, leaving the riders for the runner to return', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'] });

    await cancelOffer(offerId);

    const offer = await read('rideOffers', offerId);
    expect(offer).toMatchObject({ status: 'cancelled', pendingRequestId: null });
    for (const field of ['matchedRiderId', 'matchedAt', 'acceptDeadline', 'pendingSchedule']) {
      expect(offer).not.toHaveProperty(field);
    }
    // The driver can't write the riders' bookings; the runner's planSettle does.
    expect((await read('rideRequests', reqId)).status).toBe('awaiting');
  });
});

describe('locking a drive (setOfferLocked)', () => {
  it('finishes a car with passengers aboard, taking it out of matching', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'] });
    await acceptMatch(reqId); // 2 of 4 aboard, back in the pool

    await setOfferLocked(offerId, true);

    expect(await read('rideOffers', offerId)).toMatchObject({ acceptingMore: false, status: 'confirmed' });
  });

  it('puts a locked car with free seats back into matching when unlocked', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'] });
    await acceptMatch(reqId);
    await setOfferLocked(offerId, true);

    await setOfferLocked(offerId, false);

    expect(await read('rideOffers', offerId)).toMatchObject({ acceptingMore: true, status: 'pending' });
  });

  it("lets a rider already deciding keep their seat, and closes the car once they accept", async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'] });

    await setOfferLocked(offerId, true);
    expect((await read('rideOffers', offerId)).status).toBe('awaiting');

    await acceptMatch(reqId);
    // Seats free, but locked - so done rather than back in the pool.
    expect(await read('rideOffers', offerId)).toMatchObject({ status: 'confirmed', confirmedRequestIds: ['a', reqId] });
  });

  it('keeps a locked car done when the deciding rider declines', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'] });
    await setOfferLocked(offerId, true);

    await declineMatch(reqId);

    expect(await read('rideOffers', offerId)).toMatchObject({ status: 'confirmed', confirmedRequestIds: ['a'] });
  });

  it('refuses on a removed offer', async () => {
    const { offerId } = await seedMatch();
    await cancelOffer(offerId);
    await expect(setOfferLocked(offerId, true)).rejects.toThrow(/removed/);
  });
});

describe('changing seats (updateOfferSeats)', () => {
  it('fills the car when seats drop to the passengers aboard', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'] });
    await acceptMatch(reqId); // 2 of 4

    await updateOfferSeats(offerId, 2);

    expect(await read('rideOffers', offerId)).toMatchObject({ seatCapacity: 2, status: 'confirmed' });
  });

  it('reopens a full car when seats are added', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], seatCapacity: 2 });
    await acceptMatch(reqId); // 2 of 2, full

    await updateOfferSeats(offerId, 4);

    expect(await read('rideOffers', offerId)).toMatchObject({ seatCapacity: 4, status: 'pending' });
  });

  it('never goes below the seats taken, counting a rider still deciding', async () => {
    const { offerId } = await seedMatch({ confirmed: ['a', 'b'] }); // 2 aboard + 1 deciding

    await expect(updateOfferSeats(offerId, 2)).rejects.toThrow(/at least 3/);
    expect((await read('rideOffers', offerId)).seatCapacity).toBe(4);
  });

  it('stays within the 1-12 the booking form allows', async () => {
    const { offerId } = await seedMatch();
    await expect(updateOfferSeats(offerId, 13)).rejects.toThrow(/1 to 12/);
    await expect(updateOfferSeats(offerId, 0)).rejects.toThrow(/1 to 12/);
  });
});
