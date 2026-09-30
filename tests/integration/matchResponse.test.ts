// Integration tests for how a rider answers a match (acceptMatch / declineMatch in
// mobile/pages/schema/firebaseBookingMethods.ts), against the shared in-memory
// Firestore mock. Matches themselves are written by the matching runner
// (matching/runner/); these cover the app's half of the round trip.

import { acceptMatch, declineMatch } from '../../mobile/pages/schema/firebaseBookingMethods';
import { db } from '../../mobile/firebaseConfig';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

// The mocked Firestore uses real setTimeout delays internally; jest.setup.js
// switches the suite to fake timers by default, which would hang these awaits.
jest.useRealTimers();

const HOUR = 3_600_000;
let n = 0;

/** Seeds one driver's offer and one rider matched to it, under fresh ids. */
async function seedMatch(opts: {
  confirmed?: string[];
  seatCapacity?: number;
  routeIndex?: number;
  deadlineFromNow?: number;
} = {}) {
  n += 1;
  const reqId = `req-${n}`;
  const offerId = `offer-${n}`;
  const matchedAt = Timestamp.fromDate(new Date());
  const acceptDeadline = Timestamp.fromDate(new Date(Date.now() + (opts.deadlineFromNow ?? HOUR)));

  await setDoc(doc(db, 'rideRequests', reqId), {
    status: 'awaiting',
    matchedOfferId: offerId,
    matchedDriverId: 'driver-uid',
    matchedAt,
    acceptDeadline,
    riderDetourMinutes: 4,
    ...(opts.routeIndex === undefined ? {} : { routeIndex: opts.routeIndex }),
  });
  await setDoc(doc(db, 'rideOffers', offerId), {
    status: 'awaiting',
    seatCapacity: opts.seatCapacity ?? 4,
    pendingRequestId: reqId,
    confirmedRequestIds: opts.confirmed ?? [],
    matchedAt,
    acceptDeadline,
  });
  return { reqId, offerId };
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

  it('refuses a request that is not awaiting approval', async () => {
    const { reqId } = await seedMatch();
    await acceptMatch(reqId);

    await expect(acceptMatch(reqId)).rejects.toThrow(/not awaiting approval/);
  });
});

describe('declineMatch', () => {
  it('returns the rider to the pool with every match field removed, and frees the slot', async () => {
    const { reqId, offerId } = await seedMatch({ confirmed: ['a'], routeIndex: 0 });

    await declineMatch(reqId);

    const request = await read('rideRequests', reqId);
    expect(request.status).toBe('pending');
    for (const field of ['matchedOfferId', 'matchedDriverId', 'matchedAt', 'acceptDeadline', 'riderDetourMinutes', 'routeIndex']) {
      expect(request).not.toHaveProperty(field);
    }

    const offer = await read('rideOffers', offerId);
    expect(offer).toMatchObject({ status: 'pending', pendingRequestId: null, confirmedRequestIds: ['a'] });
    expect(offer).not.toHaveProperty('acceptDeadline');
  });
});
