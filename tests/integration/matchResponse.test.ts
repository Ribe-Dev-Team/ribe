// Integration tests for how a rider and a driver answer a match (acceptMatch /
// declineMatch and driverAcceptMatch / driverDeclineMatch in
// mobile/pages/schema/firebaseBookingMethods.ts) and a driver removes an offer
// (cancelOffer), against the shared in-memory
// Firestore mock. Matches themselves are written by the matching runner
// (backend/server/matching/runner/); these cover the app's half of the round trip.

import {
  acceptMatch, cancelConfirmedRequest, cancelOffer, declineMatch, driverAcceptMatch, driverDeclineMatch,
  setOfferLocked, updateOfferSeats,
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
  /** The driver has already accepted, so the rider accepting confirms it. */
  driverAccepted?: boolean;
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
    ...(opts.driverAccepted ? { driverAccepted: true } : {}),
  });
  return { reqId, offerId, proposed };
}

const read = async (collection: string, id: string) => (await getDoc(doc(db, collection, id))).data();

const MATCH_FIELDS = [
  'matchedOfferId', 'matchedDriverId', 'matchedAt', 'acceptDeadline', 'riderDetourMinutes', 'routeIndex',
  'pickupAt', 'arriveAt',
];
const SLOT_FIELDS = ['matchedRiderId', 'matchedAt', 'acceptDeadline', 'pendingSchedule', 'riderAccepted', 'driverAccepted'];

describe('both sides accept', () => {
  it('waits for the driver when the rider accepts first, then confirms on the driver accepting', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'] });

    await expect(acceptMatch(reqId)).resolves.toBe('waiting');
    // Nothing confirmed yet: the rider still holds the slot, with their answer on it.
    expect((await read('rideRequests', reqId)).status).toBe('awaiting');
    expect(await read('rideOffers', offerId)).toMatchObject({
      status: 'awaiting', pendingRequestId: reqId, riderAccepted: true, confirmedRequestIds: ['a'],
    });

    await expect(driverAcceptMatch(offerId)).resolves.toBe('confirmed');
    expect((await read('rideRequests', reqId)).status).toBe('confirmed');
    const offer = await read('rideOffers', offerId);
    expect(offer).toMatchObject({ confirmedRequestIds: ['a', reqId], pendingRequestId: null, status: 'pending' });
    for (const field of ['matchedRiderId', 'riderAccepted', 'driverAccepted', 'pendingSchedule']) {
      expect(offer).not.toHaveProperty(field);
    }
  });

  it('waits for the rider when the driver accepts first, then confirms on the rider accepting', async () => {
    const { reqId, offerId } = await seedMatch();

    await expect(driverAcceptMatch(offerId)).resolves.toBe('waiting');
    expect((await read('rideRequests', reqId)).status).toBe('awaiting');
    expect(await read('rideOffers', offerId)).toMatchObject({ pendingRequestId: reqId, driverAccepted: true });

    await expect(acceptMatch(reqId)).resolves.toBe('confirmed');
    expect((await read('rideRequests', reqId)).status).toBe('confirmed');
    expect((await read('rideOffers', offerId)).confirmedRequestIds).toEqual([reqId]);
  });

  it('never confirms on one side accepting twice', async () => {
    const { reqId, offerId } = await seedMatch();

    await acceptMatch(reqId);
    await expect(acceptMatch(reqId)).resolves.toBe('waiting');
    await expect(driverAcceptMatch(offerId)).resolves.toBe('confirmed');

    const { reqId: req2, offerId: offer2 } = await seedMatch();
    await driverAcceptMatch(offer2);
    await expect(driverAcceptMatch(offer2)).resolves.toBe('waiting');
    expect((await read('rideRequests', req2)).status).toBe('awaiting');
  });

  it("lets the rider still decline after accepting, clearing both answers", async () => {
    const { reqId, offerId } = await seedMatch();
    await acceptMatch(reqId);

    await declineMatch(reqId);

    expect((await read('rideRequests', reqId)).status).toBe('cancelled');
    const offer = await read('rideOffers', offerId);
    expect(offer).toMatchObject({ status: 'pending', pendingRequestId: null });
    expect(offer).not.toHaveProperty('riderAccepted');
  });
});

describe('driverAcceptMatch', () => {
  it('refuses once the accept deadline has passed, and writes nothing', async () => {
    const { offerId } = await seedMatch({ deadlineFromNow: -60_000 });

    await expect(driverAcceptMatch(offerId)).rejects.toThrow(/expired/);
    expect(await read('rideOffers', offerId)).not.toHaveProperty('driverAccepted');
  });

  it('refuses once the rider has declined', async () => {
    const { reqId, offerId } = await seedMatch();
    await declineMatch(reqId);

    await expect(driverAcceptMatch(offerId)).rejects.toThrow(/No rider is waiting/);
  });

  it('refuses on a removed offer', async () => {
    const { offerId } = await seedMatch();
    await cancelOffer(offerId);

    await expect(driverAcceptMatch(offerId)).rejects.toThrow(/removed/);
  });
});

describe('driverDeclineMatch', () => {
  it('returns the rider to the pool, not cancelled, and frees the slot', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], routeIndex: 0 });

    await driverDeclineMatch(offerId);

    // Back to looking: the next run can match them again.
    const request = await read('rideRequests', reqId);
    expect(request.status).toBe('pending');
    for (const field of MATCH_FIELDS) expect(request).not.toHaveProperty(field);

    const offer = await read('rideOffers', offerId);
    expect(offer).toMatchObject({ status: 'pending', pendingRequestId: null, confirmedRequestIds: ['a'] });
    for (const field of SLOT_FIELDS) expect(offer).not.toHaveProperty(field);
    // The confirmed riders' timetable is untouched.
    expect(offer.schedule).toEqual(timetable(['a']));
  });

  it('returns a rider who had already accepted to the pool too', async () => {
    const { reqId, offerId } = await seedMatch();
    await acceptMatch(reqId);

    await driverDeclineMatch(offerId);

    expect((await read('rideRequests', reqId)).status).toBe('pending');
    expect(await read('rideOffers', offerId)).not.toHaveProperty('riderAccepted');
  });

  it('keeps a locked car with passengers done', async () => {
    const { offerId } = await seedMatch({ confirmed: ['a'] });
    await setOfferLocked(offerId, true);

    await driverDeclineMatch(offerId);

    expect(await read('rideOffers', offerId)).toMatchObject({ status: 'confirmed', confirmedRequestIds: ['a'] });
  });

  it('refuses when no rider is waiting', async () => {
    const { reqId, offerId } = await seedMatch({ driverAccepted: true });
    await acceptMatch(reqId); // confirmed, slot empty

    await expect(driverDeclineMatch(offerId)).rejects.toThrow(/No rider is waiting/);
    expect((await read('rideRequests', reqId)).status).toBe('confirmed');
  });
});

describe('acceptMatch', () => {
  it("inserts the rider at their pickup position, not at the end", async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a', 'b'], routeIndex: 1, driverAccepted: true });

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
    const { reqId, offerId, proposed } = await seedMatch({ confirmed: ['a', 'b'], routeIndex: 1, driverAccepted: true });

    await acceptMatch(reqId);

    const offer = await read('rideOffers', offerId);
    expect(offer.schedule).toEqual(proposed);
    expect(offer.schedule.stops.map((s: { requestId: string }) => s.requestId)).toEqual(['a', reqId, 'b']);
    expect(offer).not.toHaveProperty('pendingSchedule');
  });

  it('drops a timetable the new rider is missing from, for a match made before timetables', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], timetables: false, driverAccepted: true });

    await acceptMatch(reqId);

    expect(await read('rideOffers', offerId)).not.toHaveProperty('schedule');
  });

  it('confirms the trip once the last seat is taken', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], seatCapacity: 2, routeIndex: 0, driverAccepted: true });

    await acceptMatch(reqId);

    expect(await read('rideOffers', offerId)).toMatchObject({
      confirmedRequestIds: [reqId, 'a'],
      status: 'confirmed',
    });
  });

  it('appends when the match carries no stored position', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], driverAccepted: true });

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
    const { reqId } = await seedMatch({ driverAccepted: true });
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

describe('cancelConfirmedRequest', () => {
  it("cancels the rider's request, keeping the offer id for the runner, and leaves the offer alone", async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], driverAccepted: true });
    await acceptMatch(reqId);
    const offerBefore = await read('rideOffers', offerId);

    await cancelConfirmedRequest(reqId);

    // Not deleted: the runner finds the car through matchedOfferId and frees the seat.
    expect(await read('rideRequests', reqId)).toMatchObject({ status: 'cancelled', matchedOfferId: offerId });
    // The rider's phone can't write the driver's offer once they've accepted.
    expect(await read('rideOffers', offerId)).toEqual(offerBefore);
  });

  it('refuses a request that is not confirmed', async () => {
    const { reqId } = await seedMatch();
    await expect(cancelConfirmedRequest(reqId)).rejects.toThrow("'awaiting', not confirmed");
    expect((await read('rideRequests', reqId)).status).toBe('awaiting');
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
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], driverAccepted: true });
    await acceptMatch(reqId); // 2 of 4 aboard, back in the pool

    await setOfferLocked(offerId, true);

    expect(await read('rideOffers', offerId)).toMatchObject({ acceptingMore: false, status: 'confirmed' });
  });

  it('puts a locked car with free seats back into matching when unlocked', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], driverAccepted: true });
    await acceptMatch(reqId);
    await setOfferLocked(offerId, true);

    await setOfferLocked(offerId, false);

    expect(await read('rideOffers', offerId)).toMatchObject({ acceptingMore: true, status: 'pending' });
  });

  it("lets a rider already deciding keep their seat, and closes the car once they accept", async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], driverAccepted: true });

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
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], driverAccepted: true });
    await acceptMatch(reqId); // 2 of 4

    await updateOfferSeats(offerId, 2);

    expect(await read('rideOffers', offerId)).toMatchObject({ seatCapacity: 2, status: 'confirmed' });
  });

  it('reopens a full car when seats are added', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], seatCapacity: 2, driverAccepted: true });
    await acceptMatch(reqId); // 2 of 2, full

    await updateOfferSeats(offerId, 4);

    expect(await read('rideOffers', offerId)).toMatchObject({ seatCapacity: 4, status: 'pending' });
  });

  it('never goes below the seats taken, counting a rider still deciding', async () => {
    const { offerId } = await seedMatch({ confirmed: ['a', 'b'] }); // 2 aboard + 1 deciding

    await expect(updateOfferSeats(offerId, 2)).rejects.toThrow(/at least 3/);
    expect((await read('rideOffers', offerId)).seatCapacity).toBe(4);
  });

  it("never adds more seats than the driver's car has, but always lets them come down", async () => {
    const { offerId } = await seedMatch({ confirmed: ['a'], seatCapacity: 2 });
    await setDoc(doc(db, 'rideOffers', offerId), { ...(await read('rideOffers', offerId)), userId: 'driver-uid' });
    await setDoc(doc(db, 'users', 'driver-uid'), { isDriver: true, licensePlate: 'ABC123', seatsAvailable: 3 });

    await expect(updateOfferSeats(offerId, 4)).rejects.toThrow('Your car has 3 passenger seats, so this drive can take 3 at most.');
    await updateOfferSeats(offerId, 3);
    expect((await read('rideOffers', offerId)).seatCapacity).toBe(3);
  });

  it("refuses on a locked drive - it takes nobody new, so seats would change nothing", async () => {
    const { offerId } = await seedMatch({ confirmed: ['a'], seatCapacity: 3 });
    await setDoc(doc(db, 'rideOffers', offerId), { ...(await read('rideOffers', offerId)), pendingRequestId: null, acceptingMore: false, status: 'confirmed' });

    await expect(updateOfferSeats(offerId, 4)).rejects.toThrow('Unlock this drive to change its seats.');
    expect((await read('rideOffers', offerId)).seatCapacity).toBe(3);
  });

  it('stays within the 1-7 the booking form allows', async () => {
    const { offerId } = await seedMatch();
    await expect(updateOfferSeats(offerId, 8)).rejects.toThrow(/1 to 7/);
    await expect(updateOfferSeats(offerId, 0)).rejects.toThrow(/1 to 7/);
  });
});
