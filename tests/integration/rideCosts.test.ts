// Integration tests for the cost split ride cards read from Firestore
// (mobile/services/rideData.ts). The app works nothing out itself: the
// matching runner prices each car onto its stored timetable
// (backend/server/costSplitting/tripCosts.ts), and these check the cards pick
// the right figures off it. Run against the shared in-memory Firestore mock.

import { fetchUserRides } from '../../mobile/services/rideData';
import { db } from '../../mobile/firebaseConfig';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

// The mocked Firestore uses real setTimeout delays internally.
jest.useRealTimers();

const day = Timestamp.fromDate(new Date('2026-10-04T13:00:00Z')); // Mon 5 Oct, Melbourne
const at = Timestamp.fromDate(new Date('2026-10-04T21:30:00Z'));
const booking = { toUni: true, address: 'Somewhere', date: day, departureTime: '07:00', arrivalTime: '09:00' };

/** A car's priced timetable for these riders, as the runner stores it. */
function priced(stops: Array<{ id: string; contribution: number; detourKm: number }>) {
  return {
    departAt: at,
    arriveAt: at,
    costs: {
      medianFuelPrice: 200, fuelType: 'U91', fuelSource: 'fallback', vehicleEconomy: 10,
      tripDistanceKm: 30, tripParticipants: stops.length + 1, fuelCost: 6,
      baseTripContribution: 6 / (stops.length + 1), calculatedAt: at,
    },
    stops: stops.map((s) => ({
      requestId: s.id, pickupAt: at, arriveAt: at,
      cost: { detourDistanceKm: s.detourKm, detourCost: s.detourKm * 0.2, passengerContribution: s.contribution },
    })),
  };
}

async function seedRider(id: string, offerId: string, status: string) {
  await setDoc(doc(db, 'rideRequests', id), {
    ...booking, userId: `${id}-uid`, status, matchedOfferId: offerId, matchedDriverId: 'driver-uid',
  });
}

describe('ride cards read the stored cost split', () => {
  it("shows a confirmed rider their own contribution, with its breakdown", async () => {
    await setDoc(doc(db, 'rideOffers', 'car-a'), {
      ...booking, userId: 'driver-uid', status: 'pending', seatCapacity: 4, confirmedRequestIds: ['a1', 'a2'],
      schedule: priced([{ id: 'a1', contribution: 3, detourKm: 5 }, { id: 'a2', contribution: 2, detourKm: 0 }]),
    });
    await seedRider('a1', 'car-a', 'confirmed');

    const [card] = (await fetchUserRides('a1-uid')).requests;

    expect(card.cost).toBe('$3.00');
    expect(card.costSplit).toEqual({
      viewer: 'rider',
      medianFuelPrice: 200, fuelType: 'U91', fuelSource: 'fallback', vehicleEconomy: 10,
      tripDistanceKm: 30, tripParticipants: 3, fuelCost: 6, baseTripContribution: 2,
      detourDistanceKm: 5, detourCost: 1, passengerContribution: 3,
    });
  });

  it('shows a rider deciding on a match the proposed split, with them in the car', async () => {
    await setDoc(doc(db, 'rideOffers', 'car-b'), {
      ...booking, userId: 'driver-uid', status: 'awaiting', seatCapacity: 4,
      confirmedRequestIds: ['b1'], pendingRequestId: 'b2',
      schedule: priced([{ id: 'b1', contribution: 3, detourKm: 0 }]),
      pendingSchedule: priced([{ id: 'b1', contribution: 2, detourKm: 0 }, { id: 'b2', contribution: 2.5, detourKm: 2.5 }]),
    });
    await seedRider('b2', 'car-b', 'awaiting');

    const [card] = (await fetchUserRides('b2-uid')).requests;

    expect(card.cost).toBe('$2.50');
    expect(card.costSplit).toMatchObject({ viewer: 'rider', tripParticipants: 3, passengerContribution: 2.5 });
  });

  it("shows a driver what their passengers contribute in total", async () => {
    await setDoc(doc(db, 'rideOffers', 'car-c'), {
      ...booking, userId: 'driver-c', status: 'pending', seatCapacity: 4, confirmedRequestIds: ['c1', 'c2'],
      schedule: priced([{ id: 'c1', contribution: 3, detourKm: 5 }, { id: 'c2', contribution: 2.25, detourKm: 1 }]),
    });

    const [card] = (await fetchUserRides('driver-c')).offers;

    expect(card.cost).toBe('$5.25');
    expect(card.costSplit).toMatchObject({ viewer: 'driver', passengersTotal: 5.25, tripParticipants: 3 });
  });

  it("says TBC, with no breakdown, until the runner has priced the car", async () => {
    await setDoc(doc(db, 'rideOffers', 'car-d'), {
      ...booking, userId: 'driver-d', status: 'pending', seatCapacity: 4, confirmedRequestIds: ['d1'],
      schedule: { departAt: at, arriveAt: at, stops: [{ requestId: 'd1', pickupAt: at, arriveAt: at }] },
    });
    await seedRider('d1', 'car-d', 'confirmed');
    await setDoc(doc(db, 'rideRequests', 'd2'), { ...booking, userId: 'd2-uid', status: 'pending' });

    for (const card of [
      (await fetchUserRides('d1-uid')).requests[0], // matched, car not priced yet
      (await fetchUserRides('driver-d')).offers[0],
      (await fetchUserRides('d2-uid')).requests[0], // still searching
    ]) {
      expect(card.cost).toBe('TBC');
      expect(card.costSplit).toBeUndefined();
    }
  });
});
