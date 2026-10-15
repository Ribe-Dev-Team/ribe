// Integration test for the Dashboard staying current after a driver locks a
// drive or changes its seats (mobile/pages/DashboardPage.tsx). It used to read
// the rides once, on mount, and so showed the drive as it was until the user
// changed pages. It now rebuilds its cards whenever the user's rides change
// (watchUserRides in mobile/services/rideData.ts).
//
// Nothing here remounts the page, so only that live refresh can update it.
// Real rideData and booking methods, against the in-memory Firestore mock.

import * as React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import DashboardPage from '../../mobile/pages/DashboardPage';
import { RideCardProps } from '../../mobile/components/RideCard';
import { setOfferLocked, updateOfferSeats } from '../../mobile/pages/schema/firebaseBookingMethods';
import { db } from '../../mobile/firebaseConfig';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// Plain function, not jest.fn(): resetMocks would strip a jest.fn()'s value.
jest.mock('../../mobile/auth/useAuth', () => ({ useAuth: () => ({ user: { uid: 'driver-uid' } }) }));
// The mocked Firestore uses real setTimeout delays internally.
jest.useRealTimers();

// The write handlers, without App's remount afterwards.
const rideActions = (ride: RideCardProps) => ({
  onSetLocked: (locked: boolean) => setOfferLocked(ride.rideId!, locked),
  onChangeSeats: (seats: number) => updateOfferSeats(ride.rideId!, seats),
});

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

/** Press a control on the first card showing it, and confirm its dialog. */
async function pressAndConfirm(label: string, confirm: string) {
  const alert = jest.spyOn(Alert, 'alert');
  await fireEvent.press(screen.getAllByLabelText(label)[0]);
  const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] as Array<{ text: string; onPress?: () => void }>;
  await buttons.find((b) => b.text === confirm)!.onPress!();
}

const show = () => render(
  <DashboardPage onSeeRideDetails={() => {}} onOpenDriverProfile={() => {}} rideActions={rideActions} mode="driver" onModeChange={() => {}} />,
);

it('shows a drive as locked as soon as the lock is written, and takes the Seats button away', async () => {
  await show();
  await screen.findAllByText('1/3 seats');
  expect(screen.getAllByLabelText('Change number of seats').length).toBeGreaterThan(0);

  await pressAndConfirm('Stop taking passengers', 'Lock Drive');

  await waitFor(() => expect(screen.getByText('1/1 seats')).toBeTruthy());
  expect(screen.getByText('Locked')).toBeTruthy();
  expect(screen.queryByText('1/3 seats')).toBeNull();
  expect(screen.queryByLabelText('Change number of seats')).toBeNull();
});

it('shows it taking passengers again as soon as it is unlocked, Seats button back', async () => {
  await setOfferLocked('car', true);
  await show();
  await screen.findByText('1/1 seats');

  await pressAndConfirm('Take more passengers', 'Unlock');

  await waitFor(() => expect(screen.getAllByText('1/3 seats').length).toBeGreaterThan(0));
  expect(screen.getAllByLabelText('Change number of seats').length).toBeGreaterThan(0);
});

it('shows a change of seats as soon as it is written', async () => {
  await show();
  await screen.findAllByText('1/3 seats');

  await fireEvent.press(screen.getAllByLabelText('Change number of seats')[0]);
  await fireEvent.press(screen.getByLabelText('Increase'));
  await fireEvent.press(screen.getByText('Save'));

  await waitFor(() => expect(screen.getAllByText('1/4 seats').length).toBeGreaterThan(0));
});
