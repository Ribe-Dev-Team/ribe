// Component tests for the driver row of mobile/components/RideCard.tsx: the
// driver's photo, their car with its colour, and - on a driver's own card -
// the row opening the drive's details rather than a profile of themselves.

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import RideCard, { RideCardProps } from '../../mobile/components/RideCard';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

const base: RideCardProps = {
  status: 'confirmed',
  date: new Date('2026-10-05T00:00:00+11:00'),
  pickup: { address: 'Box Hill', time: '~08:40' },
  destination: { address: 'Monash University', eta: '~08:50' },
  etaMinutes: 10,
  cost: '$4.00',
  co2SavedKg: 2.4,
  driver: { name: 'Dana Driver', vehicle: 'Toyota Corolla', colour: 'Blue', avatarUri: 'data:image/jpeg;base64,DANA' },
  plate: 'ABC123',
};

it("shows the driver's photo, and their car with its colour", async () => {
  await render(<RideCard {...base} kind="request" />);

  expect(screen.getByText('Dana Driver')).toBeTruthy();
  expect(screen.getByText('Toyota Corolla · Blue')).toBeTruthy();
  expect(screen.getByText('ABC123')).toBeTruthy();
  expect(screen.getByLabelText("Dana Driver's profile photo").props.source).toEqual({ uri: 'data:image/jpeg;base64,DANA' });
});

it("leaves the colour off when the driver hasn't added one", async () => {
  await render(<RideCard {...base} kind="request" driver={{ ...base.driver, colour: undefined }} />);

  expect(screen.getByText('Toyota Corolla')).toBeTruthy();
});

it("opens a rider's driver's profile from the row", async () => {
  const onOpenDriverProfile = jest.fn();
  const onSeeDetails = jest.fn();
  await render(<RideCard {...base} kind="request" onOpenDriverProfile={onOpenDriverProfile} onSeeDetails={onSeeDetails} />);

  await fireEvent.press(screen.getByLabelText('View driver profile'));

  expect(onOpenDriverProfile).toHaveBeenCalledTimes(1);
  expect(onSeeDetails).not.toHaveBeenCalled();
});

it("doesn't show a driver their own name and car - their riders instead", async () => {
  await render(
    <RideCard
      {...base}
      kind="offer"
      driver={{ ...base.driver, name: "You're driving" }}
      seats={{ filled: 1, total: 3, open: true, locked: false }}
    />,
  );

  expect(screen.queryByText("You're driving")).toBeNull();
  expect(screen.queryByLabelText('View driver profile')).toBeNull();
  expect(screen.getByText('1 rider')).toBeTruthy();
});
