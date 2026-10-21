import * as React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import ProfilePage from '../../mobile/pages/ProfilePage';
import { renderWithThemedAlerts } from '../themedRender';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../mobile/auth/useAuth', () => ({
  useAuth: () => ({
    user: { displayName: 'Ribe User', email: 'ribe@example.com' },
    profileData: { name: 'Ribe User', email: 'ribe@example.com' },
    submitting: false,
    updateProfileDetails: jest.fn(),
  }),
}));

describe('profile sign out', () => {
  it('asks for confirmation and only signs out after confirmation', async () => {
    const onLogout = jest.fn();
    await renderWithThemedAlerts(<ProfilePage onLogout={onLogout} onOpenDriverRegistration={jest.fn()} />);

    await fireEvent.press(screen.getByText('Sign Out'));

    expect(onLogout).not.toHaveBeenCalled();
    expect(screen.getByText('Sign out?')).toBeTruthy();
    expect(screen.getByText('Are you sure you want to sign out of Ribe?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Cancel'));
    expect(onLogout).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Sign Out'));
    await fireEvent.press(screen.getByText('Sign out'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});