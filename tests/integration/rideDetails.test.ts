// Integration tests for fetchRideDetails (mobile/services/rideData.ts) - what
// the ride details page shows beyond the card: the journey stop by stop and
// its map, the driver and their car, and the other people in the car with
// their photos. Run against the shared in-memory Firestore mock.
//
// Times are shown on the device's clock, so the expected ones are worked out
// on this machine's clock too (`clock`).

import { fetchRideDetails } from '../../mobile/services/rideData';
import { MONASH_CLAYTON_LOCATION } from '../../mobile/services/googlePlaces';
import { db } from '../../mobile/firebaseConfig';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

// The mocked Firestore uses real setTimeout delays internally.
jest.useRealTimers();

const day = Timestamp.fromDate(new Date('2026-10-04T13:00:00Z')); // Mon 5 Oct, Melbourne
const at = (iso: string) => Timestamp.fromDate(new Date(iso));
const booking = { toUni: true, date: day, departureTime: '07:00', arrivalTime: '09:00' };
const campus = { lat: MONASH_CLAYTON_LOCATION.lat, lng: MONASH_CLAYTON_LOCATION.lng };
/** "HH:mm" of an instant on this machine's clock, as the app shows it. */
const clock = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const HOME = { lat: -37.80, lon: 145.00 };
const ANA = { lat: -37.84, lon: 145.04 };
const BEN = { lat: -37.86, lon: 145.07 };
const CAL = { lat: -37.88, lon: 145.10 };

// jest.setup.js empties the mock after every test, so each one seeds afresh.
beforeEach(async () => {
  await setDoc(doc(db, 'users', 'driver-uid'), {
    name: 'Dana Driver', bio: 'Drives in most days.', degree: 'Engineering', phoneNumber: '0412345678',
    profilePhotoUrl: 'data:image/jpeg;base64,DANA',
    vehicleMake: 'Toyota', vehicleModel: 'Corolla', vehicleColor: 'Blue', licensePlate: 'ABC123',
  });
  await setDoc(doc(db, 'users', 'ana-uid'), { name: 'Ana Rider', degree: 'Law', profilePhotoUrl: 'data:image/png;base64,ANA', phoneNumber: '0411111111' });
  await setDoc(doc(db, 'users', 'ben-uid'), { name: 'Ben Rider', bio: 'Quiet rides please.', phoneNumber: '0422222222' });
  await setDoc(doc(db, 'users', 'cal-uid'), { name: 'Cal Rider', phoneNumber: '0433333333' });

  // Dana's car: Ana and Ben confirmed, Cal deciding on the third seat.
  const stop = (requestId: string, min: number) => ({ requestId, pickupAt: at(`2026-10-04T21:${min}:00Z`), arriveAt: at('2026-10-04T21:50:00Z') });
  await setDoc(doc(db, 'rideOffers', 'car'), {
    ...booking, userId: 'driver-uid', status: 'awaiting', coord: HOME, address: '1 Home St',
    seatCapacity: 4, confirmedRequestIds: ['ana', 'ben'], pendingRequestId: 'cal',
    schedule: { departAt: at('2026-10-04T21:10:00Z'), arriveAt: at('2026-10-04T21:50:00Z'), stops: [stop('ana', 20), stop('ben', 30)] },
    pendingSchedule: {
      departAt: at('2026-10-04T21:05:00Z'), arriveAt: at('2026-10-04T21:50:00Z'),
      stops: [stop('ana', 15), stop('ben', 25), stop('cal', 35)],
    },
  });
  const rider = (userId: string, coord: object, address: string, status: string) => ({
    ...booking, userId, coord, address, status, matchedOfferId: 'car', matchedDriverId: 'driver-uid',
  });
  await setDoc(doc(db, 'rideRequests', 'ana'), rider('ana-uid', ANA, '2 Ana Rd', 'confirmed'));
  await setDoc(doc(db, 'rideRequests', 'ben'), rider('ben-uid', BEN, '3 Ben Ave', 'confirmed'));
  await setDoc(doc(db, 'rideRequests', 'cal'), rider('cal-uid', CAL, '4 Cal Ct', 'awaiting'));
  await setDoc(doc(db, 'rideRequests', 'solo'), { ...booking, userId: 'solo-uid', coord: ANA, address: '9 Solo St', status: 'pending' });
});

describe("a rider's details", () => {
  it('shows their driver with photo and car, and the other confirmed riders with theirs', async () => {
    const details = await fetchRideDetails('ana', 'request');

    expect(details.driver).toEqual({
      name: 'Dana Driver', photoUrl: 'data:image/jpeg;base64,DANA', bio: 'Drives in most days.',
      degree: 'Engineering', phone: '0412345678',
    });
    expect(details.car).toEqual({ make: 'Toyota', model: 'Corolla', colour: 'Blue', plate: 'ABC123' });
    // Ben, not Ana herself - and not Cal, who hasn't accepted. Never Ben's number.
    expect(details.passengers).toEqual([{ name: 'Ben', photoUrl: undefined, bio: 'Quiet rides please.', degree: undefined }]);
    expect(details.passengers[0]).not.toHaveProperty('phone');
    expect(details.startsAt).toEqual(new Date('2026-10-04T21:20:00Z'));
  });

  it("lists their journey with the later pickups, but never another rider's name or address", async () => {
    const { journey, mapPoints } = await fetchRideDetails('ana', 'request');

    expect(journey).toEqual([
      { kind: 'start', title: 'Your pickup', address: '2 Ana Rd', time: '~' + clock('2026-10-04T21:20:00Z'), marker: 'A' },
      { kind: 'stop', title: 'Pickup · another passenger', time: '~' + clock('2026-10-04T21:30:00Z') },
      { kind: 'end', title: 'Drop-off', address: MONASH_CLAYTON_LOCATION.label, time: '~' + clock('2026-10-04T21:50:00Z'), marker: 'B' },
    ]);
    // Only their own two points go on the map.
    expect(mapPoints).toEqual([
      { lat: ANA.lat, lng: ANA.lon, label: 'Your pickup', kind: 'start' },
      { ...campus, label: 'Drop-off', kind: 'end' },
    ]);
  });

  it('shows a rider deciding on a match who they would share the car with', async () => {
    const details = await fetchRideDetails('cal', 'request');

    expect(details.driver?.name).toBe('Dana Driver');
    expect(details.passengers.map((p) => p.name)).toEqual(['Ana', 'Ben']);
    expect(details.passengers[0].photoUrl).toBe('data:image/png;base64,ANA');
  });

  it('has no driver or riders before a match, but still maps their trip', async () => {
    const details = await fetchRideDetails('solo', 'request');

    expect(details.driver).toBeUndefined();
    expect(details.passengers).toEqual([]);
    // Nothing planned yet, so no times - the page shows their booking window.
    expect(details.journey).toEqual([
      { kind: 'start', title: 'Your pickup', address: '9 Solo St', marker: 'A' },
      { kind: 'end', title: 'Drop-off', address: MONASH_CLAYTON_LOCATION.label, marker: 'B' },
    ]);
    expect(details.mapPoints.map((p) => p.kind)).toEqual(['start', 'end']);
  });
});

describe("a driver's details", () => {
  it('lists every passenger in pickup order, the one still deciding marked', async () => {
    const details = await fetchRideDetails('car', 'offer');

    expect(details.driver).toBeUndefined();
    expect(details.car).toMatchObject({ make: 'Toyota', plate: 'ABC123' });
    expect(details.passengers.map((p) => [p.name, p.awaiting ?? false])).toEqual([
      ['Ana', false], ['Ben', false], ['Cal', true],
    ]);
  });

  it("gives them their confirmed passengers' numbers, but not one still deciding", async () => {
    const details = await fetchRideDetails('car', 'offer');

    expect(details.passengers.map((p) => p.phone)).toEqual(['0411111111', '0422222222', undefined]);
  });

  it('lists and maps their whole route: departure, each pickup, drop-off', async () => {
    const { journey, mapPoints } = await fetchRideDetails('car', 'offer');

    // The proposal, since Cal is deciding: it includes them.
    expect(journey).toEqual([
      { kind: 'start', title: 'Departure', address: '1 Home St', time: clock('2026-10-04T21:05:00Z'), marker: 'A' },
      { kind: 'stop', title: 'Pickup · Ana', address: '2 Ana Rd', time: '~' + clock('2026-10-04T21:15:00Z'), marker: '1' },
      { kind: 'stop', title: 'Pickup · Ben', address: '3 Ben Ave', time: '~' + clock('2026-10-04T21:25:00Z'), marker: '2' },
      { kind: 'stop', title: 'Pickup · Cal', address: '4 Cal Ct', time: '~' + clock('2026-10-04T21:35:00Z'), marker: '3', awaiting: true },
      { kind: 'end', title: 'Drop-off', address: MONASH_CLAYTON_LOCATION.label, time: '~' + clock('2026-10-04T21:50:00Z'), marker: 'B' },
    ]);
    expect(mapPoints).toEqual([
      { lat: HOME.lat, lng: HOME.lon, label: 'Departure', kind: 'start' },
      { lat: ANA.lat, lng: ANA.lon, label: 'Pickup · Ana', kind: 'stop' },
      { lat: BEN.lat, lng: BEN.lon, label: 'Pickup · Ben', kind: 'stop' },
      { lat: CAL.lat, lng: CAL.lon, label: 'Pickup · Cal', kind: 'stop' },
      { ...campus, label: 'Drop-off', kind: 'end' },
    ]);
  });
});

it('returns nothing for a ride that no longer exists', async () => {
  await expect(fetchRideDetails('missing', 'request')).resolves.toEqual({ passengers: [], journey: [], mapPoints: [] });
});
