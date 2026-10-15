// Component test for the Dashboard's Rider/Driver toggle being held by the
// parent (App): the page is remounted after every write - Lock, Seats,
// Accept... - and must come back in the view the user was in.

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import DashboardPage from '../../mobile/pages/DashboardPage';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// Plain functions, not jest.fn(): resetMocks would strip a jest.fn()'s value.
jest.mock('../../mobile/auth/useAuth', () => ({ useAuth: () => ({ user: { uid: 'u' } }) }));
jest.mock('../../mobile/services/rideData', () => ({
  fetchUserRides: async () => ({ requests: [], offers: [] }),
}));

const props = {
  onSeeRideDetails: () => {},
  onOpenDriverProfile: () => {},
  rideActions: () => ({}),
};

it('stays in the driver view when remounted, as App does after locking a drive', async () => {
  const { rerender } = await render(<DashboardPage key={1} {...props} mode="driver" onModeChange={() => {}} />);
  expect(screen.getByText('Upcoming Drives')).toBeTruthy();

  await rerender(<DashboardPage key={2} {...props} mode="driver" onModeChange={() => {}} />);
  expect(screen.getByText('Upcoming Drives')).toBeTruthy();
  expect(screen.queryByText('Upcoming Rides')).toBeNull();
});

it('reports a toggle to the parent so the choice is kept', async () => {
  const onModeChange = jest.fn();
  await render(<DashboardPage {...props} mode="rider" onModeChange={onModeChange} />);

  await fireEvent.press(screen.getByLabelText('Switch to driver view'));

  expect(onModeChange).toHaveBeenCalledWith('driver');
});
