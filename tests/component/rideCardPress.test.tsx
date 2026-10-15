// Component tests for tapping a ride card (mobile/components/RideCard.tsx):
// anywhere on the card opens its details, as "See more information" does,
// while the buttons inside it still do only their own job.

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
  cost: '$8.50',
  co2SavedKg: 2.4,
  driver: { name: 'Sam', vehicle: 'Mazda 3' },
  plate: 'ABC123',
  arriveBy: '09:00',
};

it.each(['confirmed', 'awaiting', 'pending'] as const)('opens the details when a %s card is tapped anywhere', async (status) => {
  const onSeeDetails = jest.fn();
  await render(<RideCard {...base} status={status} matchedAt={new Date()} onSeeDetails={onSeeDetails} />);

  await fireEvent.press(screen.getByText('Box Hill'));
  await fireEvent.press(screen.getByTestId('ride-card'));

  expect(onSeeDetails).toHaveBeenCalledTimes(2);
});

it('still opens the details from the "See more information" link', async () => {
  const onSeeDetails = jest.fn();
  await render(<RideCard {...base} onSeeDetails={onSeeDetails} />);

  await fireEvent.press(screen.getByText('See more information'));

  expect(onSeeDetails).toHaveBeenCalledTimes(1);
});

it("lets the buttons inside do their own job, without also opening the details", async () => {
  const onSeeDetails = jest.fn();
  const onAccept = jest.fn();
  const onOpenDriverProfile = jest.fn();
  await render(
    <RideCard {...base} status="awaiting" matchedAt={new Date()} onSeeDetails={onSeeDetails} onAccept={onAccept} />,
  );
  await fireEvent.press(screen.getByText('Accept'));
  expect(onAccept).toHaveBeenCalledTimes(1);

  await render(<RideCard {...base} onSeeDetails={onSeeDetails} onOpenDriverProfile={onOpenDriverProfile} />);
  await fireEvent.press(screen.getByLabelText('View driver profile'));
  expect(onOpenDriverProfile).toHaveBeenCalledTimes(1);

  expect(onSeeDetails).not.toHaveBeenCalled();
});

it('opens its own details window when the screen gives it nowhere to go', async () => {
  await render(<RideCard {...base} />);

  await fireEvent.press(screen.getByText('Box Hill'));

  expect(await screen.findByText('Close')).toBeTruthy();
});
