// Component tests for My Rides and My Drives - one DashboardPage each, picked
// by its navigation tab (mobile/components/AppNavigation.tsx), with no
// Rider/Driver toggle of its own. Remounting it (App does after every write)
// keeps it on the same view, since the view is a prop, not page state.

import * as React from 'react';
import { render, screen } from '@testing-library/react-native';
import DashboardPage from '../../mobile/pages/DashboardPage';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// Plain functions, not jest.fn(): resetMocks would strip a jest.fn()'s value.
jest.mock('../../mobile/auth/useAuth', () => ({ useAuth: () => ({ user: { uid: 'u' } }) }));
jest.mock('../../mobile/services/rideData', () => ({
  fetchUserRides: async () => ({ requests: [], offers: [] }),
  // Loads once, as the real one does when its listeners start.
  watchUserRides: (_uid: string, onChange: () => void) => { onChange(); return () => {}; },
}));

const props = {
  onSeeRideDetails: () => {},
  onOpenDriverProfile: () => {},
  rideActions: () => ({}),
};

it('is My Rides for the rider view, with only the rider lanes', async () => {
  await render(<DashboardPage {...props} mode="rider" />);

  expect(screen.getByText('My Rides')).toBeTruthy();
  expect(await screen.findByText('Upcoming Rides')).toBeTruthy();
  expect(screen.getByText('Pending Requests')).toBeTruthy();
  expect(screen.queryByText('Upcoming Drives')).toBeNull();
});

it('is My Drives for the driver view, with only the driver lanes', async () => {
  await render(<DashboardPage {...props} mode="driver" />);

  expect(screen.getByText('My Drives')).toBeTruthy();
  expect(await screen.findByText('Upcoming Drives')).toBeTruthy();
  expect(screen.getByText('Open Driving Offers')).toBeTruthy();
  expect(screen.queryByText('Upcoming Rides')).toBeNull();
});

it('has no Rider/Driver toggle - the navigation tabs replace it', async () => {
  await render(<DashboardPage {...props} mode="driver" />);
  await screen.findByText('Upcoming Drives');

  expect(screen.queryByLabelText('Switch to rider view')).toBeNull();
  expect(screen.queryByLabelText('Switch to driver view')).toBeNull();
});

it('stays on My Drives when remounted, as App does after locking a drive', async () => {
  const { rerender } = await render(<DashboardPage key={1} {...props} mode="driver" />);
  await rerender(<DashboardPage key={2} {...props} mode="driver" />);

  expect(await screen.findByText('Upcoming Drives')).toBeTruthy();
  expect(screen.queryByText('Upcoming Rides')).toBeNull();
});
