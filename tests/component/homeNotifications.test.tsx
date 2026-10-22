import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import HomePage from '../../mobile/pages/HomePage';
import { NotificationItem } from '../../mobile/App';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// Plain functions, not jest.fn(impl): resetMocks (jest.config.js) would strip
// those implementations, and HomePage needs watchUserRides to return its stop.
jest.mock('../../mobile/services/rideData', () => ({
  fetchUserRides: async () => ({ requests: [], offers: [] }),
  watchUserRides: () => () => {},
}));

jest.mock('../../mobile/auth/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profileData: { name: 'Alex' } }),
}));

describe('HomePage notifications badge dot', () => {
  const sampleNotifications: NotificationItem[] = [
    { id: 'notif-1', text: 'Upcoming ride today', type: 'upcoming' },
    { id: 'notif-2', text: 'New passenger joined', type: 'passenger' },
  ];

  it('shows the badge dot when there are unread notifications, and hides it when clicked', async () => {
    const onMarkNotificationsRead = jest.fn();

    await render(
      <HomePage
        notificationsList={sampleNotifications}
        onMarkNotificationsRead={onMarkNotificationsRead}
        onOpenProfile={jest.fn()}
        onNewRide={jest.fn()}
        onSeeRideDetails={jest.fn()}
        onOpenDriverProfile={jest.fn()}
        rideActions={() => ({})}
      />,
    );

    // Badge dot should be visible initially
    expect(screen.getByTestId('notification-badge-dot')).toBeTruthy();

    // Clicking the notifications bell opens the dropdown and marks them read
    await fireEvent.press(screen.getByLabelText('Notifications'));

    expect(onMarkNotificationsRead).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('notification-badge-dot')).toBeNull();

    // Closing the dropdown should keep the badge dot hidden
    await fireEvent.press(screen.getByLabelText('Notifications'));
    expect(screen.queryByTestId('notification-badge-dot')).toBeNull();
  });

  it('does not show the badge dot if all notifications are already read', async () => {
    await render(
      <HomePage
        notificationsList={sampleNotifications}
        readNotificationIds={['notif-1', 'notif-2']}
        onOpenProfile={jest.fn()}
        onNewRide={jest.fn()}
        onSeeRideDetails={jest.fn()}
        onOpenDriverProfile={jest.fn()}
        rideActions={() => ({})}
      />,
    );

    expect(screen.queryByTestId('notification-badge-dot')).toBeNull();
  });
});

