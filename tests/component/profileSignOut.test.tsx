import * as React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import ProfilePage from '../../mobile/pages/ProfilePage';

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
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onLogout = jest.fn();
    await render(<ProfilePage onLogout={onLogout} onOpenDriverRegistration={jest.fn()} />);

    await fireEvent.press(screen.getByText('Sign out'));

    expect(onLogout).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'Sign out?',
      'Are you sure you want to sign out of Ribe?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Sign out', style: 'destructive', onPress: onLogout }),
      ]),
    );

    const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((button) => button.text === 'Cancel')!.onPress?.();
    expect(onLogout).not.toHaveBeenCalled();
    buttons.find((button) => button.text === 'Sign out')!.onPress!();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});