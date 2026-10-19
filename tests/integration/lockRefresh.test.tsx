// Integration test for the Dashboard staying current after a driver locks a
// drive or changes its seats on the details page (mobile/pages/DashboardPage.tsx). It used to read
// the rides once, on mount, and so showed the drive as it was until the user
// changed pages. It now rebuilds its cards whenever the user's rides change
// (watchUserRides in mobile/services/rideData.ts).
//
// Nothing here remounts the page, so only that live refresh can update it.
// Real rideData and booking methods, against the in-memory Firestore mock.

import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import DashboardPage from '../../mobile/pages/DashboardPage';
import { setOfferLocked, updateOfferSeats } from '../../mobile/pages/schema/firebaseBookingMethods';
import { db } from '../../mobile/firebaseConfig';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// Plain function, not jest.fn(): resetMocks would strip a jest.fn()'s value.
jest.mock('../../mobile/auth/useAuth', () => ({ useAuth: () => ({ user: { uid: 'driver-uid' } }) }));
// The mocked Firestore uses real setTimeout delays internally.
jest.useRealTimers();

// The card has no actions of its own here: locking and seats are on the
// details page now, so the tests write them as it would.
const rideActions = () => ({});

beforeEach(async () => {
  const day = Timestamp.fromDate(new Date(Date.now() + 3 * 24 * 3_600_000));
  const booking = { toUni: true, date: day, departureTime: '07:00', arrivalTime: '09:00' };
  await setDoc(doc(db, 'rideOffers', 'car'), {
    ...booking, address: 'Home', userId: 'driver-uid', status: 'pending', seatCapacity: 3, confirmedRequestIds: ['r1'],
  });
  await setDoc(doc(db, 'rideRequests', 'r1'), {
    ...booking, address: 'Rider', userId: 'rider-uid', status: 'confirmed', matchedOfferId: 'car', matchedDriverId: 'driver-uid',
  });
});

const show = () => render(
  <DashboardPage onSeeRideDetails={() => {}} onOpenDriverProfile={() => {}} rideActions={rideActions} mode="driver" />,
);

it('shows a drive as locked as soon as the lock is written', async () => {
  await show();
  await screen.findAllByText('Still looking');

  await setOfferLocked('car', true);

  await waitFor(() => expect(screen.getByText('Locked')).toBeTruthy());
  expect(screen.queryByText('Still looking')).toBeNull();
});

it('shows it taking passengers again as soon as it is unlocked', async () => {
  await setOfferLocked('car', true);
  await show();
  await screen.findByText('Locked');

  await setOfferLocked('car', false);

  await waitFor(() => expect(screen.getAllByText('Still looking').length).toBeGreaterThan(0));
});

it('shows a change of seats as soon as it is written', async () => {
  await show();
  await screen.findAllByText('Still looking');

  await updateOfferSeats('car', 1); // one rider aboard fills a one-seat car

  await waitFor(() => expect(screen.getByText('Full')).toBeTruthy());
});
