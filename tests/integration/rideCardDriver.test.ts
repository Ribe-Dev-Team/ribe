// Integration tests for the driver details ride cards get from
// mobile/services/rideData.ts: a rider's card shows their matched driver's
// name, photo, car and plate; a driver's own card shows their own, not
// placeholders. Run against the shared in-memory Firestore mock.

import { fetchUserRides } from '../../mobile/services/rideData';
import { db } from '../../mobile/firebaseConfig';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

// The mocked Firestore uses real setTimeout delays internally.
jest.useRealTimers();

const day = Timestamp.fromDate(new Date('2026-10-04T13:00:00Z')); // Mon 5 Oct, Melbourne
const booking = { toUni: true, address: 'Somewhere', date: day, departureTime: '07:00', arrivalTime: '09:00' };
const dana = {
  name: 'Dana Driver', profilePhotoUrl: 'data:image/jpeg;base64,DANA', phoneNumber: '0412345678',
  vehicleMake: 'Toyota', vehicleModel: 'Corolla', vehicleColor: 'Blue', licensePlate: 'ABC123',
};

beforeEach(async () => {
  await setDoc(doc(db, 'users', 'driver-uid'), dana);
  await setDoc(doc(db, 'rideOffers', 'car'), {
    ...booking, userId: 'driver-uid', status: 'pending', seatCapacity: 4, confirmedRequestIds: ['r1'],
  });
  await setDoc(doc(db, 'rideRequests', 'r1'), {
    ...booking, userId: 'rider-uid', status: 'confirmed', matchedOfferId: 'car', matchedDriverId: 'driver-uid',
  });
});

it("shows a rider their driver's name, photo, car with its colour, and plate", async () => {
  const [card] = (await fetchUserRides('rider-uid')).requests;

  expect(card.driver).toEqual({
    uid: 'driver-uid', name: 'Dana Driver', vehicle: 'Toyota Corolla', colour: 'Blue', avatarUri: 'data:image/jpeg;base64,DANA',
  });
  expect(card.plate).toBe('ABC123');
  expect(card.driverPhone).toBe('0412345678');
});

it('shows a driver their own photo, car and plate on their drive, not placeholders', async () => {
  const [card] = (await fetchUserRides('driver-uid')).offers;

  expect(card.driver).toEqual({
    uid: 'driver-uid', name: "You're driving", vehicle: 'Toyota Corolla', colour: 'Blue', avatarUri: 'data:image/jpeg;base64,DANA',
  });
  expect(card.plate).toBe('ABC123');
});

it('takes the car from driver registration when the account has none', async () => {
  await setDoc(doc(db, 'users', 'driver-uid'), { name: 'Dana Driver' });
  await setDoc(doc(db, 'drivers', 'driver-uid'), { vehicleMake: 'Mazda', vehicleModel: '3', vehicleColor: 'Red', licensePlate: 'XYZ789' });

  const [card] = (await fetchUserRides('rider-uid')).requests;

  expect(card.driver).toMatchObject({ name: 'Dana Driver', vehicle: 'Mazda 3', colour: 'Red' });
  expect(card.plate).toBe('XYZ789');
});

it("tells a driver who hasn't added a car where to do it", async () => {
  await setDoc(doc(db, 'users', 'driver-uid'), { name: 'Dana Driver' });

  const [card] = (await fetchUserRides('driver-uid')).offers;

  expect(card.driver.vehicle).toBe('Add your vehicle in your profile');
  expect(card.plate).toBe('No plate');
});
