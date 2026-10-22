// Component test for mobile/pages/HomePage.tsx's welcome: it greets the user by
// their profile's name, as the Profile page shows it, not the account's display
// name - that's only set at signup, so it can be an old one.

import * as React from 'react';
import { render, screen } from '@testing-library/react-native';
import HomePage from '../../mobile/pages/HomePage';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../mobile/services/rideData', () => ({
  fetchUserRides: jest.fn(async () => ({ requests: [], offers: [] })),
  watchUserRides: jest.fn(() => () => {}),
}));

let mockAuth: { user: unknown; profileData: unknown } = { user: null, profileData: null };
jest.mock('../../mobile/auth/useAuth', () => ({ useAuth: () => mockAuth }));

const renderHome = () => render(
  <HomePage
    notificationsList={[]}
    onOpenProfile={jest.fn()}
    onNewRide={jest.fn()}
    onSeeRideDetails={jest.fn()}
    onOpenDriverProfile={jest.fn()}
    rideActions={() => ({})}
  />,
);

it("welcomes the user by their profile's name, not an old display name", async () => {
  mockAuth = { user: { displayName: 'Old Name' }, profileData: { name: 'Jamie Lee' } };
  await renderHome();

  expect(screen.getByText('Welcome, Jamie')).toBeTruthy();
  expect(screen.queryByText(/Old/)).toBeNull();
});

it('falls back to the display name until the profile has loaded', async () => {
  mockAuth = { user: { displayName: 'Jamie Lee' }, profileData: null };
  await renderHome();

  expect(screen.getByText('Welcome, Jamie')).toBeTruthy();
});
