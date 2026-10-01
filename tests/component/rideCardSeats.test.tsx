// Component tests for the seat section of mobile/components/RideCard.tsx: the
// seat count, the green / green-and-orange bar, the rider's reassurance note,
// and the driver's Lock / Seats controls.

import * as React from 'react';
import { Alert, StyleSheet } from 'react-native';
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

/** A bar segment's flex share. */
const flexOf = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style).flex;

/** The buttons of the most recent Alert.alert call. */
function lastAlertButtons(spy: jest.SpyInstance) {
  return spy.mock.calls[spy.mock.calls.length - 1][2] as Array<{ text: string; onPress?: () => void }>;
}

describe('rider view', () => {
  it('shows a car still taking passengers, and that they will still arrive on time', async () => {
    await render(<RideCard {...base} kind="request" seats={{ filled: 2, total: 4, open: true, locked: false }} />);

    expect(screen.getByText('2/4 seats')).toBeTruthy();
    expect(screen.getByText('Driver may add passengers')).toBeTruthy();
    expect(screen.getByLabelText('Confirmed, still taking passengers')).toBeTruthy();
    expect(screen.getByText(/You'll still arrive by 09:00/)).toBeTruthy();
  });

  it('shows a locked car as full - 2/2, all green, no more passengers', async () => {
    await render(<RideCard {...base} kind="request" seats={{ filled: 2, total: 4, open: false, locked: true }} />);

    // The two empty seats aren't on offer any more, so they aren't counted.
    expect(screen.getByText('2/2 seats')).toBeTruthy();
    expect(screen.getByText('No more passengers will be added')).toBeTruthy();
    expect(screen.getByLabelText('Confirmed, no more passengers')).toBeTruthy();
    expect(screen.queryByTestId('seat-bar-free')).toBeNull();
    expect(screen.queryByText(/You'll still arrive by/)).toBeNull();
  });

  it('says the same once the car is simply full', async () => {
    await render(<RideCard {...base} kind="request" seats={{ filled: 3, total: 3, open: false, locked: false }} />);

    expect(screen.getByText('3/3 seats')).toBeTruthy();
    expect(screen.getByText('No more passengers will be added')).toBeTruthy();
  });

  it('has no driver controls', async () => {
    await render(<RideCard {...base} kind="request" seats={{ filled: 1, total: 4, open: true, locked: false }} />);

    expect(screen.queryByLabelText('Stop taking passengers')).toBeNull();
    expect(screen.queryByLabelText('Change number of seats')).toBeNull();
  });
});

describe('driver view', () => {
  it('locks the drive after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const onSetLocked = jest.fn();
    await render(
      <RideCard
        {...base}
        kind="offer"
        seats={{ filled: 1, total: 4, open: true, locked: false }}
        onSetLocked={onSetLocked}
      />,
    );

    expect(screen.getByText('Still looking for passengers')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Stop taking passengers'));
    lastAlertButtons(alert).find((b) => b.text === 'Lock Drive')!.onPress!();

    expect(onSetLocked).toHaveBeenCalledWith(true);
  });

  it('unlocks a locked drive, but offers nothing for a car that is simply full', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const onSetLocked = jest.fn();
    const { rerender } = await render(
      <RideCard {...base} kind="offer" seats={{ filled: 2, total: 4, open: false, locked: true }} onSetLocked={onSetLocked} />,
    );

    await fireEvent.press(screen.getByLabelText('Take more passengers'));
    lastAlertButtons(alert).find((b) => b.text === 'Unlock')!.onPress!();
    expect(onSetLocked).toHaveBeenCalledWith(false);

    await rerender(<RideCard {...base} kind="offer" seats={{ filled: 4, total: 4, open: false, locked: false }} onSetLocked={onSetLocked} />);
    expect(screen.getByText('Full')).toBeTruthy();
    expect(screen.queryByLabelText('Take more passengers')).toBeNull();
  });

  it('changes the number of seats, never below the riders aboard', async () => {
    const onChangeSeats = jest.fn();
    await render(
      <RideCard {...base} kind="offer" seats={{ filled: 2, total: 4, open: true, locked: false }} onChangeSeats={onChangeSeats} />,
    );

    await fireEvent.press(screen.getByLabelText('Change number of seats'));
    expect(screen.getByText('2 already taken, so at least 2.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Decrease'));
    await fireEvent.press(screen.getByLabelText('Decrease'));
    await fireEvent.press(screen.getByLabelText('Decrease')); // stops at 2
    await fireEvent.press(screen.getByText('Save'));

    expect(onChangeSeats).toHaveBeenCalledWith(2);
  });
});

describe('seat bar', () => {
  it('fills like a progress bar: 1 of 3 taken is one third green, two thirds orange', async () => {
    await render(<RideCard {...base} kind="request" seats={{ filled: 1, total: 3, open: true, locked: false }} />);

    expect(flexOf('seat-bar-taken')).toBe(1);
    expect(flexOf('seat-bar-free')).toBe(2);
  });

  it('is all green once nothing more is on offer', async () => {
    await render(<RideCard {...base} kind="offer" seats={{ filled: 1, total: 3, open: false, locked: true }} />);

    expect(screen.getByText('1/1 seats')).toBeTruthy();
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.queryByTestId('seat-bar-free')).toBeNull();
  });
});

describe('times', () => {
  it('shows the window they gave while still searching, not a trip length', async () => {
    await render(
      <RideCard
        {...base}
        kind="request"
        status="pending"
        etaMinutes={90}
        pickup={{ address: 'Box Hill', time: '07:30' }}
        destination={{ address: 'Monash University', eta: '09:00' }}
        timeWindow={{ from: '07:30', to: '09:00' }}
      />,
    );

    expect(screen.getByText('07:30–09:00')).toBeTruthy();
    expect(screen.getByText('from 07:30')).toBeTruthy();
    expect(screen.getByText('by 09:00')).toBeTruthy();
    expect(screen.queryByText('90 min')).toBeNull();
  });

  it('shows the planned trip once matched', async () => {
    await render(<RideCard {...base} kind="request" />);

    expect(screen.getByText('10 min')).toBeTruthy();
    expect(screen.getByText('~08:40')).toBeTruthy();
    expect(screen.getByText('ETA ~08:50')).toBeTruthy();
  });
});

describe('layout', () => {
  it('puts "See more information" at the bottom of an upcoming ride, below the seats', async () => {
    const onSeeDetails = jest.fn();
    await render(
      <RideCard {...base} kind="request" seats={{ filled: 1, total: 3, open: true, locked: false }} onSeeDetails={onSeeDetails} />,
    );

    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered.indexOf('See more information')).toBeGreaterThan(rendered.indexOf("You'll still arrive by"));
    expect(rendered.indexOf('See more information')).toBeGreaterThan(rendered.indexOf('seat-bar-taken'));

    await fireEvent.press(screen.getByText('See more information'));
    expect(onSeeDetails).toHaveBeenCalled();
  });

  it("gives a driver's buttons their own row, after the seat status", async () => {
    await render(
      <RideCard {...base} kind="offer" seats={{ filled: 1, total: 2, open: true, locked: false }} onSetLocked={jest.fn()} onChangeSeats={jest.fn()} />,
    );

    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered.indexOf('Still looking for passengers')).toBeLessThan(rendered.indexOf('Stop taking passengers'));
    expect(rendered.indexOf('seat-bar-taken')).toBeLessThan(rendered.indexOf('Change number of seats'));
  });
});
