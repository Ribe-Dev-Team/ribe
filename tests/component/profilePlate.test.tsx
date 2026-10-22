// Component tests for the driver row on mobile/pages/ProfilePage.tsx: a
// driver's number plate in place of the old green "Driver" pill, which looked
// like a button but did nothing.

import * as React from 'react';
import { screen } from '@testing-library/react-native';
import ProfilePage from '../../mobile/pages/ProfilePage';
import { renderWithThemedAlerts } from '../themedRender';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

let mockProfile: Record<string, unknown> = {};
jest.mock('../../mobile/auth/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profileData: mockProfile, submitting: false, updateProfileDetails: async () => {} }),
}));

const show = () => renderWithThemedAlerts(<ProfilePage onLogout={() => {}} onOpenDriverRegistration={() => {}} />);

it("shows a driver's number plate next to their car, and no Driver pill", async () => {
  mockProfile = { name: 'Dana', isDriver: true, vehicleColor: 'Blue', vehicleMake: 'Toyota', vehicleModel: 'Corolla', licensePlate: 'abc123' };
  await show();

  expect(screen.getByText('Blue Toyota Corolla')).toBeTruthy();
  expect(screen.getByLabelText('Number plate abc123')).toBeTruthy();
  expect(screen.getByText('abc123')).toBeTruthy(); // as typed, as on the ride card
  expect(screen.queryByText('Driver')).toBeNull();
});

it('shows no plate for someone who is not a driver', async () => {
  mockProfile = { name: 'Ana', isDriver: false };
  await show();

  expect(screen.getByText('Add your vehicle details to start giving rides')).toBeTruthy();
  expect(screen.queryByLabelText(/Number plate/)).toBeNull();
});
