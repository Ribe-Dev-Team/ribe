// Component tests for what a dashboard ride card (mobile/components/RideCard.tsx)
// shows: only the essentials - the date, the time to be ready by (largest), the
// two ends of the trip by street, the price, a rider's driver and car, a
// driver's riders as icons. Stops on the way, CO2, full addresses and every
// control but a rider's Accept are left to the details page.

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import RideCard, { RideCardProps, shortAddress } from '../../mobile/components/RideCard';

// A View carrying the icon's testID, so the rider icons can be counted.
jest.mock('@expo/vector-icons', () => ({
  Ionicons: (props: { testID?: string }) => {
    const { View } = jest.requireActual('react-native');
    return <View testID={props.testID} />;
  },
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

/** The buttons of the most recent Alert.alert call. */
function lastAlertButtons(spy: jest.SpyInstance) {
  return spy.mock.calls[spy.mock.calls.length - 1][2] as Array<{ text: string; onPress?: () => void }>;
}

describe('the essentials', () => {
  it("puts a rider's ready-by time first, with the date, price, trip ends and their driver's car", async () => {
    await render(<RideCard {...base} kind="request" readyBy="~08:35" />);

    expect(screen.getByText('Be ready by')).toBeTruthy();
    expect(screen.getByText('~08:35')).toBeTruthy();
    expect(screen.getByText('Mon, October 5th 2026')).toBeTruthy();
    expect(screen.getByText('$8.50')).toBeTruthy();
    expect(screen.getByText('~08:40')).toBeTruthy();
    expect(screen.getByText('ETA ~08:50')).toBeTruthy();
    expect(screen.getByText('Sam')).toBeTruthy();
    expect(screen.getByText('Mazda 3')).toBeTruthy();
    expect(screen.getByText('ABC123')).toBeTruthy();
  });

  it('falls back to the pickup time to be ready by before a buffer is planned', async () => {
    await render(<RideCard {...base} kind="request" />);
    expect(screen.getByText('Be ready by')).toBeTruthy();
    expect(screen.getAllByText('~08:40')).toHaveLength(2); // the headline, and the pickup row
  });

  it('leaves CO2, the trip length and the stops on the way to the details page', async () => {
    const stops = [{ label: 'Ann · 1 First St', time: '~08:22' }];
    await render(<RideCard {...base} kind="offer" stops={stops} />);

    expect(screen.queryByText(/CO2/)).toBeNull();
    expect(screen.queryByText('10 min')).toBeNull();
    expect(screen.queryByText('Ann · 1 First St')).toBeNull();
    expect(screen.queryByText('~08:22')).toBeNull();
  });

  it('shortens each end to its street', async () => {
    await render(
      <RideCard
        {...base}
        kind="request"
        pickup={{ address: 'Unit 3, 12 Example St, Clayton VIC 3168, Australia', time: '~08:40' }}
        destination={{ address: 'Monash University Clayton, Wellington Rd, Clayton VIC', eta: '~08:50' }}
      />,
    );

    expect(screen.getByText('12 Example St')).toBeTruthy();
    // No street number on campus: its name, not the road it's on.
    expect(screen.getByText('Monash University Clayton')).toBeTruthy();
    expect(screen.queryByText(/Clayton VIC/)).toBeNull();
  });
});

describe('shortAddress', () => {
  it.each([
    ['12 Example St, Clayton VIC 3168, Australia', '12 Example St'],
    ['Unit 3, 12 Example St, Clayton VIC 3168', '12 Example St'],
    ['12A High St, Kew', '12A High St'],
    ['Monash University Clayton', 'Monash University Clayton'],
    ['Box Hill', 'Box Hill'],
  ])('shortens %s to %s', (address, expected) => {
    expect(shortAddress(address)).toBe(expected);
  });
});

describe('rider view', () => {
  it("doesn't show the car's seats or any driver controls", async () => {
    await render(<RideCard {...base} kind="request" seats={{ filled: 2, total: 4, open: true, locked: false }} />);

    expect(screen.queryByTestId('rider-icon')).toBeNull();
    expect(screen.queryByLabelText('Stop taking passengers')).toBeNull();
    expect(screen.queryByLabelText('Change number of seats')).toBeNull();
  });
});

describe('driver view', () => {
  it('shows when to leave, and their riders as one icon each - not their own car', async () => {
    await render(<RideCard {...base} kind="offer" pickup={{ address: 'Box Hill', time: '08:10' }} seats={{ filled: 2, total: 4, open: true, locked: false }} />);

    expect(screen.getByText('Leave at')).toBeTruthy();
    expect(screen.getAllByText('08:10')).toHaveLength(2);
    expect(screen.getAllByTestId('rider-icon')).toHaveLength(2); // 2 riders, whatever the 4 seats
    expect(screen.getByText('2 riders')).toBeTruthy();
    expect(screen.getByText('Still looking')).toBeTruthy();
    expect(screen.queryByText('ABC123')).toBeNull();
  });

  it('says so when no one has joined yet', async () => {
    await render(<RideCard {...base} kind="offer" seats={{ filled: 0, total: 3, open: true, locked: false }} />);

    expect(screen.queryByTestId('rider-icon')).toBeNull();
    expect(screen.getByText('No riders yet')).toBeTruthy();
  });

  it('has no Seats, Lock, Edit or Cancel buttons - those are on the details page', async () => {
    await render(<RideCard {...base} kind="offer" seats={{ filled: 1, total: 4, open: true, locked: false }} />);
    expect(screen.queryByLabelText('Change number of seats')).toBeNull();
    expect(screen.queryByLabelText('Stop taking passengers')).toBeNull();

    await render(<RideCard {...base} kind="offer" status="pending" timeWindow={{ from: '07:00', to: '09:00' }} />);
    expect(screen.queryByLabelText('Edit ride request')).toBeNull();
    expect(screen.queryByLabelText('Remove drive offer')).toBeNull();
    expect(screen.queryByText('Remove Offer')).toBeNull();
  });

  it('shows a locked or full drive as such', async () => {
    await render(<RideCard {...base} kind="offer" seats={{ filled: 2, total: 4, open: false, locked: true }} />);
    expect(screen.getByText('Locked')).toBeTruthy();

    await render(<RideCard {...base} kind="offer" seats={{ filled: 4, total: 4, open: false, locked: false }} />);
    expect(screen.getByText('Full')).toBeTruthy();
  });
});

describe('times', () => {
  it('shows the window they gave while still searching, not planned times', async () => {
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

    expect(screen.getByText('Your window')).toBeTruthy();
    expect(screen.getByText('07:30–09:00')).toBeTruthy();
    expect(screen.getByText('from 07:30')).toBeTruthy();
    expect(screen.getByText('by 09:00')).toBeTruthy();
  });
});

describe('layout', () => {
  it.each(['confirmed', 'awaiting', 'pending'] as const)('ends a %s card with "See More Information"', async (status) => {
    const onSeeDetails = jest.fn();
    await render(<RideCard {...base} kind="request" status={status} matchedAt={new Date()} onAccept={jest.fn()} onSeeDetails={onSeeDetails} />);

    const rendered = JSON.stringify(screen.toJSON());
    const last = ['ABC123', 'Accept', 'Searching for driver...'].map((t) => rendered.indexOf(t)).filter((i) => i >= 0);
    expect(rendered.indexOf('See More Information')).toBeGreaterThan(Math.max(...last));

    await fireEvent.press(screen.getByText('See More Information'));
    expect(onSeeDetails).toHaveBeenCalled();
  });
});
