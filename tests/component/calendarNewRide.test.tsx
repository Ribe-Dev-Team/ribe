// Component tests for the New Ride button on mobile/pages/CalendarPage.tsx:
// shown only for future dates within the booking horizon; hidden for today,
// past days, and dates beyond the horizon.

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../mobile/auth/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'user-1' } }),
}));
jest.mock('../../mobile/services/rideData', () => ({
  ...jest.requireActual('../../mobile/services/rideData'),
  fetchUserRides: async () => ({ requests: [], offers: [] }),
  watchUserRides: () => () => {},
}));

// Only the clock is faked - the page loads with real timers. Set before the
// page is loaded, since it works out today when the module loads.
jest.useFakeTimers({
  now: new Date(2026, 9, 15, 12),
  doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame'],
});
afterAll(() => jest.useRealTimers());

const { default: CalendarPage } = require('../../mobile/pages/CalendarPage') as typeof import('../../mobile/pages/CalendarPage');

const selectOctober = (day: number) => fireEvent.press(screen.getByLabelText(`Select October ${day}`));

it('hides New Ride for today and past days, and offers it for future dates', async () => {
  const onNewRide = jest.fn();
  await render(<CalendarPage onOpenRide={() => {}} onNewRide={onNewRide} />);
  expect(screen.queryByText('New Ride')).toBeNull(); // today, 15 October

  await selectOctober(14);
  expect(screen.queryByText('New Ride')).toBeNull();

  await selectOctober(16);
  await fireEvent.press(screen.getByText('New Ride'));
  expect(onNewRide.mock.calls[0][0].getDate()).toBe(16);
});

it('takes New Ride away past the booking horizon', async () => {
  await render(<CalendarPage onOpenRide={() => {}} onNewRide={() => {}} />);

  await selectOctober(29); // 14 days after the 15th
  expect(screen.getByText('New Ride')).toBeTruthy();

  await selectOctober(30);
  expect(screen.queryByText('New Ride')).toBeNull();
});
