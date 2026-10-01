// Integration tests for the seat information ride cards get from
// mobile/services/rideData.ts: how full a car is, whether it's still taking
// passengers, and which lane a driver's partly-filled trip belongs in. Run
// against the shared in-memory Firestore mock.

import { fetchUserRides, rideTimeSummary } from '../../mobile/services/rideData';
import { db } from '../../mobile/firebaseConfig';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

// The mocked Firestore uses real setTimeout delays internally.
jest.useRealTimers();

const day = Timestamp.fromDate(new Date('2026-10-04T13:00:00Z')); // Mon 5 Oct, Melbourne
const booking = { toUni: true, address: 'Somewhere', date: day, departureTime: '07:00', arrivalTime: '09:00' };

/** A driver's offer and, if `riders` > 0, that many confirmed riders on it. */
async function seedCar(opts: { riders?: number; seats?: number; locked?: boolean } = {}) {
  const riders = Array.from({ length: opts.riders ?? 1 }, (_, i) => `req-${i + 1}`);
  await setDoc(doc(db, 'rideOffers', 'offer-1'), {
    ...booking,
    userId: 'driver-uid',
    status: riders.length === 0 ? 'pending' : opts.locked || riders.length >= (opts.seats ?? 4) ? 'confirmed' : 'pending',
    seatCapacity: opts.seats ?? 4,
    confirmedRequestIds: riders,
    ...(opts.locked ? { acceptingMore: false } : {}),
  });
  for (const id of riders) {
    await setDoc(doc(db, 'rideRequests', id), {
      ...booking,
      userId: `${id}-uid`,
      status: 'confirmed',
      matchedOfferId: 'offer-1',
      matchedDriverId: 'driver-uid',
    });
  }
}

describe("a confirmed rider's card", () => {
  it('shows how full the car is, still taking passengers, and their own arrival time', async () => {
    await seedCar({ riders: 1 });

    const [card] = (await fetchUserRides('req-1-uid')).requests;

    expect(card.status).toBe('confirmed');
    expect(card.seats).toEqual({ filled: 1, total: 4, open: true, locked: false });
    expect(card.arriveBy).toBe('09:00');
  });

  it('shows a locked car as no longer taking passengers', async () => {
    await seedCar({ riders: 2, locked: true });

    const [card] = (await fetchUserRides('req-1-uid')).requests;

    expect(card.seats).toEqual({ filled: 2, total: 4, open: false, locked: true });
  });

  it('shows a full car as full, not locked', async () => {
    await seedCar({ riders: 2, seats: 2 });

    const [card] = (await fetchUserRides('req-2-uid')).requests;

    expect(card.seats).toEqual({ filled: 2, total: 2, open: false, locked: false });
  });
});

describe("a driver's card", () => {
  it('counts a trip with a passenger aboard as an upcoming drive while it still takes more', async () => {
    await seedCar({ riders: 1 });

    const [card] = (await fetchUserRides('driver-uid')).offers;

    // Firestore keeps it 'pending' so the matcher can add riders...
    // ...but on the driver's screen it's a confirmed, upcoming drive.
    expect(card.status).toBe('confirmed');
    expect(card.seats).toEqual({ filled: 1, total: 4, open: true, locked: false });
  });

  it('stays an open offer until someone is aboard', async () => {
    await seedCar({ riders: 0 });

    const [card] = (await fetchUserRides('driver-uid')).offers;

    expect(card.status).toBe('pending');
    expect(card.seats).toEqual({ filled: 0, total: 4, open: true, locked: false });
  });
});

describe('times on cards still searching', () => {
  it("gives an unmatched request and an open offer their own window, not a trip length", async () => {
    await seedCar({ riders: 0 });
    await setDoc(doc(db, 'rideRequests', 'lonely'), { ...booking, userId: 'lonely-uid', status: 'pending' });

    const [offer] = (await fetchUserRides('driver-uid')).offers;
    const [request] = (await fetchUserRides('lonely-uid')).requests;

    expect(offer.timeWindow).toEqual({ from: '07:00', to: '09:00' });
    expect(request.timeWindow).toEqual({ from: '07:00', to: '09:00' });
    expect(rideTimeSummary(request)).toEqual({ time: '07:00–09:00' });
  });

  it('drops the window once the matcher has planned the trip', async () => {
    await seedCar({ riders: 1 });
    await setDoc(doc(db, 'rideRequests', 'req-1'), {
      ...booking,
      userId: 'req-1-uid',
      status: 'confirmed',
      matchedOfferId: 'offer-1',
      matchedDriverId: 'driver-uid',
      pickupAt: Timestamp.fromDate(new Date('2026-10-04T21:40:00Z')), // 08:40 Melbourne
      arriveAt: Timestamp.fromDate(new Date('2026-10-04T21:50:00Z')), // 08:50
    });

    const [card] = (await fetchUserRides('req-1-uid')).requests;

    expect(card.timeWindow).toBeUndefined();
    expect(rideTimeSummary(card)).toEqual({ time: card.pickup.time, duration: '10 min' });
  });
});

describe("the driver on a matched rider's card", () => {
  it('comes from their account profile when they never finished driver registration', async () => {
    await seedCar({ riders: 1 }); // unlocked, still taking passengers
    await setDoc(doc(db, 'users', 'driver-uid'), {
      name: 'Sam Lee', vehicleMake: 'Mazda', vehicleModel: '3', licensePlate: 'ABC123', phoneNumber: '0400 000 000',
    });

    const [card] = (await fetchUserRides('req-1-uid')).requests;

    expect(card.status).toBe('confirmed');
    expect(card.seats?.open).toBe(true);
    expect(card.driver.name).toBe('Sam Lee');
    expect(card.driver.vehicle).toBe('Mazda 3');
    expect(card.plate).toBe('ABC123');
    expect(card.driverPhone).toBe('0400 000 000');
  });

  it('prefers the driver profile, filling gaps such as the phone from the account', async () => {
    await seedCar({ riders: 1 });
    await setDoc(doc(db, 'drivers', 'driver-uid'), { name: 'Sam (driver)', vehicleMake: 'Toyota', vehicleModel: 'Corolla', licensePlate: 'XYZ789' });
    await setDoc(doc(db, 'users', 'driver-uid'), { name: 'Sam (account)', phoneNumber: '0400 000 000' });

    const [card] = (await fetchUserRides('req-1-uid')).requests;

    expect(card.driver.name).toBe('Sam (driver)');
    expect(card.driver.vehicle).toBe('Toyota Corolla');
    expect(card.driverPhone).toBe('0400 000 000');
  });

  it('never says "Searching for a driver" once matched, even with no profile at all', async () => {
    await seedCar({ riders: 1 });

    const [card] = (await fetchUserRides('req-1-uid')).requests;

    expect(card.driver.name).toBe('Your driver');
  });

  it('says "Searching for a driver" while unmatched', async () => {
    await setDoc(doc(db, 'rideRequests', 'lonely'), { ...booking, userId: 'lonely-uid', status: 'pending' });

    const [card] = (await fetchUserRides('lonely-uid')).requests;

    expect(card.driver.name).toBe('Searching for a driver');
  });
});
