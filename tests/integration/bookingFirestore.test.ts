// Integration tests for the Firestore-facing half of the booking process
// (mobile/pages/schema/firebaseBookingMethods.ts), run against the shared
// in-memory Firestore mock (__mocks__/firebase/firestore.ts) so no real
// network calls or Firebase usage are involved.

import { addRideRequest, addRideOffer } from '../../mobile/pages/schema/firebaseBookingMethods';
import { db } from '../../mobile/firebaseConfig';
import { collection, doc, getDoc, getDocs, query } from 'firebase/firestore';
import { Booking, Coord } from '../../mobile/pages/schema/booking.schema';

// The mocked Firestore/AsyncStorage use real setTimeout delays internally;
// jest.setup.js switches the suite to fake timers by default, which would
// hang these awaits forever.
jest.useRealTimers();

function futureDateStr(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${d.getFullYear()}`;
}

/*
`userId` is required: both write methods reject a booking without a signed-in
user before any other validation runs. Omitting it here made every test in this
file fail on that check rather than on the behaviour it meant to exercise.
*/
const baseRiderBooking: Booking = {
  userId: 'test-user-123',
  isDriving: false,
  toUni: true,
  address: '123 Main St',
  travelDate: futureDateStr(7),
  depTime: '08:00',
  arrTime: '09:00',
};

const baseDriverBooking: Booking = {
  ...baseRiderBooking,
  isDriving: true,
  detourTime: 15,
  capacity: 3,
};

describe('addRideRequest', () => {
  test('persists a valid ride request to Firestore', async () => {
    const id = await addRideRequest(baseRiderBooking);

    const snapshot = await getDoc(doc(db, 'rideRequests', id));
    expect(snapshot.exists()).toBe(true);
    const data = snapshot.data();
    expect(data.address).toBe('123 Main St');
    expect(data.toUni).toBe(true);
    expect(data.departureTime).toBe('08:00');
    expect(data.arrivalTime).toBe('09:00');
    // the doc is stamped with its own generated id after creation
    expect(data.requestID).toBe(id);
  });

  test('trims whitespace from the address before saving', async () => {
    const id = await addRideRequest({ ...baseRiderBooking, address: '  123 Main St  ' });
    const snapshot = await getDoc(doc(db, 'rideRequests', id));
    expect(snapshot.data().address).toBe('123 Main St');
  });

  test('rejects a past travel date', async () => {
    await expect(addRideRequest({ ...baseRiderBooking, travelDate: '01-01-2020' })).rejects.toThrow(
      /future date/,
    );
  });

  test('rejects a malformed departure time', async () => {
    await expect(addRideRequest({ ...baseRiderBooking, depTime: '8am' })).rejects.toThrow(
      /departureTime must be in 'HH:mm'/,
    );
  });

  test('rejects a malformed arrival time', async () => {
    await expect(addRideRequest({ ...baseRiderBooking, arrTime: '25:00' })).rejects.toThrow(
      /arrivalTime must be in 'HH:mm'/,
    );
  });

  test('rejects an arrival time at or before the departure time', async () => {
    await expect(
      addRideRequest({ ...baseRiderBooking, depTime: '09:00', arrTime: '09:00' }),
    ).rejects.toThrow(/arrivalTime must be later than departureTime/);
  });

  test('does not create a document when validation fails', async () => {
    await expect(addRideRequest({ ...baseRiderBooking, travelDate: '01-01-2020' })).rejects.toThrow();

    const snapshot = await getDocs(query(collection(db, 'rideRequests')));
    expect(snapshot.size).toBe(0);
  });
});

describe('addRideOffer', () => {
  test('persists a valid ride offer to Firestore', async () => {
    const id = await addRideOffer(baseDriverBooking);

    const snapshot = await getDoc(doc(db, 'rideOffers', id));
    expect(snapshot.exists()).toBe(true);
    const data = snapshot.data();
    expect(data.maxDetourTime).toBe(15);
    expect(data.seatCapacity).toBe(3);
    expect(data.offerID).toBe(id);
  });

  test('requires a detour time', async () => {
    const { detourTime, ...withoutDetour } = baseDriverBooking;
    await expect(addRideOffer(withoutDetour as Booking)).rejects.toThrow(/Max detour time is required/);
  });

  test('requires a seat capacity', async () => {
    const { capacity, ...withoutCapacity } = baseDriverBooking;
    await expect(addRideOffer(withoutCapacity as Booking)).rejects.toThrow(
      /Number of available seats needs to be specified/,
    );
  });

  test('rejects a seat capacity below 1', async () => {
    await expect(addRideOffer({ ...baseDriverBooking, capacity: 0 })).rejects.toThrow(
      /require 1 to 12 seats/,
    );
  });

  test('rejects a seat capacity above 12', async () => {
    await expect(addRideOffer({ ...baseDriverBooking, capacity: 13 })).rejects.toThrow(
      /require 1 to 12 seats/,
    );
  });

  test('rejects a detour that exceeds the travel window', async () => {
    await expect(
      addRideOffer({ ...baseDriverBooking, depTime: '08:00', arrTime: '08:10', detourTime: 15 }),
    ).rejects.toThrow(/exceeds travel window/);
  });

  test('does not create a document when validation fails', async () => {
    await expect(addRideOffer({ ...baseDriverBooking, capacity: 0 })).rejects.toThrow();

    const snapshot = await getDocs(query(collection(db, 'rideOffers')));
    expect(snapshot.size).toBe(0);
  });
});

/*
Coordinates are what make a booking matchable (matching/src/types.ts consumes
{ lat, lon } directly). They are optional by design: Places/Geocoding can be
unavailable, and a booking without a point is still accepted - it just can't be
matched until backfilled. Anything present but malformed is rejected.
*/
describe('booking coordinates', () => {
  const MELBOURNE: Coord = { lat: -37.8136, lon: 144.9631 };

  test('persists a resolved coordinate on a ride request', async () => {
    const id = await addRideRequest({ ...baseRiderBooking, coord: MELBOURNE });

    const data = (await getDoc(doc(db, 'rideRequests', id))).data();
    expect(data.coord).toEqual(MELBOURNE);
  });

  test('persists a resolved coordinate on a ride offer', async () => {
    const id = await addRideOffer({ ...baseDriverBooking, coord: MELBOURNE });

    const data = (await getDoc(doc(db, 'rideOffers', id))).data();
    expect(data.coord).toEqual(MELBOURNE);
  });

  test('omits the key entirely when no coordinate was resolved', async () => {
    const id = await addRideRequest(baseRiderBooking);

    const data = (await getDoc(doc(db, 'rideRequests', id))).data();
    // Not merely undefined - Firestore rejects an explicit undefined value,
    // so the field has to be absent from the written object altogether.
    expect('coord' in data).toBe(false);
  });

  test('drops extra keys rather than writing them to Firestore', async () => {
    // A caller passing a ResolvedPlace-shaped object would otherwise leak
    // Google's `lng` and `description` into the document.
    const leaky = { ...MELBOURNE, lng: 144.9631, description: '123 Main St' };
    const id = await addRideRequest({ ...baseRiderBooking, coord: leaky as Coord });

    const data = (await getDoc(doc(db, 'rideRequests', id))).data();
    expect(data.coord).toEqual(MELBOURNE);
  });

  test('rejects a latitude outside -90..90', async () => {
    await expect(
      addRideRequest({ ...baseRiderBooking, coord: { lat: 91, lon: 144.9631 } }),
    ).rejects.toThrow(/latitude must be between -90 and 90/);
  });

  test('rejects a longitude outside -180..180', async () => {
    await expect(
      addRideRequest({ ...baseRiderBooking, coord: { lat: -37.8136, lon: 181 } }),
    ).rejects.toThrow(/longitude must be between -180 and 180/);
  });

  test('rejects a non-finite coordinate', async () => {
    await expect(
      addRideRequest({ ...baseRiderBooking, coord: { lat: Number.NaN, lon: 144.9631 } }),
    ).rejects.toThrow(/latitude must be a finite number/);
  });

  test('does not create a document when the coordinate is invalid', async () => {
    await expect(
      addRideOffer({ ...baseDriverBooking, coord: { lat: 91, lon: 144.9631 } }),
    ).rejects.toThrow();

    const snapshot = await getDocs(query(collection(db, 'rideOffers')));
    expect(snapshot.size).toBe(0);
  });
});
