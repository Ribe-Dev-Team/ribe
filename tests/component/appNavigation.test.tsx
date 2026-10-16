// Component tests for the navigation bar (mobile/components/AppNavigation.tsx):
// My Rides and My Drives are separate tabs, and My Drives only shows for
// drivers.

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import AppNavigation from '../../mobile/components/AppNavigation';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

it('shows My Rides and My Drives as separate tabs for a driver', async () => {
  await render(<AppNavigation activeTab="home" onChange={() => {}} showDrives />);

  expect(screen.getAllByRole('tab')).toHaveLength(5);
  for (const label of ['Home', 'My Rides', 'My Drives', 'Calendar', 'Profile']) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});

it('hides My Drives for someone who is not a driver', async () => {
  await render(<AppNavigation activeTab="home" onChange={() => {}} showDrives={false} />);

  expect(screen.getByText('My Rides')).toBeTruthy();
  expect(screen.queryByText('My Drives')).toBeNull();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
});

it('opens each one from its own tab', async () => {
  const onChange = jest.fn();
  await render(<AppNavigation activeTab="home" onChange={onChange} showDrives />);

  await fireEvent.press(screen.getByText('My Drives'));
  await fireEvent.press(screen.getByText('My Rides'));

  expect(onChange.mock.calls).toEqual([['drives'], ['rides']]);
});

it('marks the tab being viewed as selected', async () => {
  await render(<AppNavigation activeTab="drives" onChange={() => {}} showDrives />);

  const selected = screen.getAllByRole('tab').filter((tab) => tab.props.accessibilityState?.selected);
  expect(selected).toHaveLength(1);
  expect(screen.getByRole('tab', { selected: true, name: 'My Drives' })).toBeTruthy();
});
