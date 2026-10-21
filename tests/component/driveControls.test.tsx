// Component tests for mobile/components/DriveControls.tsx - a driver's Seats
// and Lock buttons, now on the ride details page rather than the ride card -
// and the details page's Edit button for a booking still searching.

import * as React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import DriveControls from '../../mobile/components/DriveControls';
import RideDetailPage from '../../mobile/pages/RideDetailPage';
import { fetchRideDetails } from '../../mobile/services/rideData';
import { renderWithThemedAlerts } from '../themedRender';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../mobile/services/rideData', () => ({
  ...jest.requireActual('../../mobile/services/rideData'),
  fetchRideDetails: jest.fn(),
}));
jest.useRealTimers();

describe('DriveControls', () => {
  it('says what the lock does, and locks the drive after confirming', async () => {
    const onSetLocked = jest.fn();
    await renderWithThemedAlerts(<DriveControls seats={{ filled: 1, total: 4, open: true, locked: false }} onSetLocked={onSetLocked} />);

    expect(screen.getByText('Lock · No More Passengers')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Stop taking passengers'));
    await fireEvent.press(screen.getByText('Lock Drive'));

    expect(onSetLocked).toHaveBeenCalledWith(true);
  });

  it('offers Seats until the drive is locked, then takes it away', async () => {
    const onChangeSeats = jest.fn();
    await renderWithThemedAlerts(<DriveControls seats={{ filled: 1, total: 4, open: true, locked: false }} onChangeSeats={onChangeSeats} />);
    expect(screen.getByText('Seats (4)')).toBeTruthy();

    await renderWithThemedAlerts(<DriveControls seats={{ filled: 1, total: 4, open: false, locked: true }} onChangeSeats={onChangeSeats} />);
    expect(screen.queryByLabelText('Change number of seats')).toBeNull();
  });

  it('unlocks a locked drive, but offers nothing for a car that is simply full', async () => {
    const onSetLocked = jest.fn();
    const { rerender } = await renderWithThemedAlerts(
      <DriveControls seats={{ filled: 2, total: 4, open: false, locked: true }} onSetLocked={onSetLocked} />,
    );

    expect(screen.getByText('Unlock · Take More')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Take more passengers'));
    await fireEvent.press(screen.getByText('Unlock'));
    expect(onSetLocked).toHaveBeenCalledWith(false);

    await rerender(<DriveControls seats={{ filled: 4, total: 4, open: false, locked: false }} onSetLocked={onSetLocked} />);
    expect(screen.queryByLabelText('Take more passengers')).toBeNull();
  });

  it('changes the number of seats, never below the riders aboard and the one deciding', async () => {
    const onChangeSeats = jest.fn();
    await renderWithThemedAlerts(
      <DriveControls seats={{ filled: 2, total: 5, open: true, locked: false }} riderDeciding onChangeSeats={onChangeSeats} />,
    );

    await fireEvent.press(screen.getByLabelText('Change number of seats'));
    expect(screen.getByText('3 already taken, so at least 3.')).toBeTruthy();
    for (let i = 0; i < 4; i++) await fireEvent.press(screen.getByLabelText('Decrease')); // stops at 3
    await fireEvent.press(screen.getByText('Save'));

    expect(onChangeSeats).toHaveBeenCalledWith(3);
  });
});

describe('on the ride details page', () => {
  const offer = {
    rideId: 'offer-1', kind: 'offer' as const, status: 'confirmed' as const, time: '07:20', duration: '30 min',
    start: '1 Home St', destination: 'Monash University', driver: 'You', vehicle: 'Toyota Corolla',
    seats: { filled: 1, total: 3, open: true, locked: false },
  };
  const show = async (ride: typeof offer | Record<string, unknown>, props: Record<string, unknown> = {}) => {
    (fetchRideDetails as jest.Mock).mockResolvedValue({ passengers: [{ name: 'Ben' }], journey: [], mapPoints: [] });
    await renderWithThemedAlerts(<RideDetailPage ride={ride as never} date={new Date()} onBack={() => {}} {...props} />);
    await screen.findByText('Ben');
  };

  it("gives a driver their drive's Seats and Lock buttons", async () => {
    await show(offer, { onSetLocked: jest.fn(), onChangeSeats: jest.fn() });

    expect(screen.getByText('Seats (3)')).toBeTruthy();
    expect(screen.getByText('Lock · No More Passengers')).toBeTruthy();
  });

  it('offers Edit for a booking still searching, beside cancelling it', async () => {
    const onEdit = jest.fn();
    await show({ ...offer, status: 'pending', seats: { filled: 0, total: 3, open: true, locked: false } }, { onEdit, onCancel: jest.fn() });

    await fireEvent.press(screen.getByText('Edit Offer'));
    expect(onEdit).toHaveBeenCalled();
    expect(screen.getByText('Remove Offer')).toBeTruthy();
  });

  it('has no Edit once the ride is confirmed', async () => {
    await show(offer, { onEdit: jest.fn() });
    expect(screen.queryByText('Edit Offer')).toBeNull();
  });
});
