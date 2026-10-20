// Component tests for mobile/pages/RideDetailPage.tsx with its data mocked:
// the title for a rider or a driver, the journey stop by stop with its map
// markers, the driver and other riders shown with their photos (initials
// without one), the car described in full, the driver's number masked until
// 12 hours before pickup, and a driver seeing their passengers rather than a
// driver.

import * as React from 'react';
import { render, screen } from '@testing-library/react-native';
import RideDetailPage from '../../mobile/pages/RideDetailPage';
import { Ride } from '../../mobile/pages/CalendarPage';
import { fetchRideDetails, RideDetails } from '../../mobile/services/rideData';

jest.mock('../../mobile/services/rideData', () => ({
  ...jest.requireActual('../../mobile/services/rideData'),
  fetchRideDetails: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: (props: { accessibilityLabel?: string }) => {
    const { View } = jest.requireActual('react-native');
    return <View accessibilityLabel={props.accessibilityLabel} />;
  },
}));
jest.useRealTimers();

const fetchDetails = fetchRideDetails as jest.MockedFunction<typeof fetchRideDetails>;

const ride: Ride = {
  rideId: 'req-1', kind: 'request', status: 'confirmed', time: '~07:41', duration: '25 min',
  start: '2 Ana Rd', destination: 'Monash University', driver: 'Dana Driver', vehicle: 'Toyota Corolla',
};

const details = (overrides: Partial<RideDetails> = {}): RideDetails => ({
  driver: {
    name: 'Dana Driver', photoUrl: 'data:image/jpeg;base64,DANA', bio: 'Drives in most days.',
    degree: 'Engineering', phone: '0412345678',
  },
  car: { make: 'Toyota', model: 'Corolla', colour: 'Blue', plate: 'ABC123' },
  passengers: [
    { name: 'Ben', photoUrl: 'data:image/png;base64,BEN', degree: 'Law', bio: 'Quiet rides please.' },
    { name: 'Cal' },
  ],
  journey: [
    { kind: 'start', title: 'Your pickup', address: '2 Ana Rd', time: '~07:41', marker: 'A' },
    { kind: 'stop', title: 'Pickup · another passenger', time: '~07:50' },
    { kind: 'end', title: 'Drop-off', address: 'Monash University Clayton', time: '~08:20', marker: 'B' },
  ],
  mapPoints: [],
  startsAt: new Date(Date.now() + 2 * 24 * 3_600_000),
  ...overrides,
});

/** Render the page and wait for its details to load - shown by `loadedText`. */
const show = async (r: Ride, d: RideDetails, loadedText: RegExp = /Plate/) => {
  fetchDetails.mockResolvedValue(d);
  await render(<RideDetailPage ride={r} date={new Date('2026-10-05T00:00:00+11:00')} onBack={() => {}} />);
  await screen.findByText(loadedText);
};

it('shows the driver and other riders with their photos, initials where there is none', async () => {
  await show(ride, details());

  expect(fetchDetails).toHaveBeenCalledWith('req-1', 'request');
  expect(screen.getByLabelText("Dana Driver's profile photo")).toBeTruthy();
  expect(screen.getByText('Drives in most days.')).toBeTruthy();
  expect(screen.getByLabelText("Ben's profile photo")).toBeTruthy();
  expect(screen.getByText('Law  ·  Quiet rides please.')).toBeTruthy();
  expect(screen.getByText('C')).toBeTruthy(); // Cal has no photo
  expect(screen.queryByText('Elena Park')).toBeNull();
});

it("titles a rider's page Ride details, with no car icon", async () => {
  await show(ride, details());

  expect(screen.getByText('Ride details')).toBeTruthy();
  expect(screen.queryByText('Drive details')).toBeNull();
  expect(screen.queryByLabelText('Driving')).toBeNull();
});

it('lists the journey stop by stop under the map, with each stop marked as on the map', async () => {
  await show(ride, details());

  expect(screen.getByText('Your pickup')).toBeTruthy();
  expect(screen.getByText('2 Ana Rd')).toBeTruthy();
  expect(screen.getAllByText('~07:41')).toHaveLength(2); // the status row's time, and this stop's
  expect(screen.getByText('A')).toBeTruthy();
  // Another rider's pickup: a time, but no marker - it isn't on their map.
  expect(screen.getByText('Pickup · another passenger')).toBeTruthy();
  expect(screen.getByLabelText('Not shown on the map')).toBeTruthy();
  expect(screen.getByText('Monash University Clayton')).toBeTruthy();
  expect(screen.getByText('B')).toBeTruthy();
});

it('shows the booking window on a trip not planned yet', async () => {
  await show({ ...ride, status: 'pending', time: '07:00–09:00' }, details({
    driver: undefined, passengers: [],
    journey: [
      { kind: 'start', title: 'Your pickup', address: '2 Ana Rd', marker: 'A' },
      { kind: 'end', title: 'Drop-off', address: 'Monash University Clayton', marker: 'B' },
    ],
  }), /A driver will appear here/);

  // The status row's time, and the journey's first stop.
  expect(screen.getAllByText('07:00–09:00')).toHaveLength(2);
});

it("labels the time at the top: a rider's pick-up, a driver's leave time, or the window booked", async () => {
  await show(ride, details());
  expect(screen.getByText('pick-up time')).toBeTruthy();

  await show({ ...ride, kind: 'offer', rideId: 'offer-1', time: '07:20' }, details({ driver: undefined }));
  expect(screen.getByText('leave time')).toBeTruthy();

  await show({ ...ride, status: 'pending', time: '07:00–09:00', duration: undefined }, details({ driver: undefined }), /A driver will appear here/);
  expect(screen.getByText('travel window')).toBeTruthy();
});

it('describes the car in full', async () => {
  await show(ride, details());

  expect(screen.getByText('Blue Toyota Corolla')).toBeTruthy();
  expect(screen.getByText('Plate  ·  ABC123')).toBeTruthy();
});

it("masks the driver's number until 12 hours before pickup, as the ride card does", async () => {
  await show(ride, details());
  expect(screen.getByText(/0412 •• •• ••/)).toBeTruthy();

  await show(ride, details({ startsAt: new Date(Date.now() + 3_600_000) }));
  expect(screen.getByText('Contact  ·  0412 345 678')).toBeTruthy();
});

it('shows a driver their passengers and their own car, not a driver', async () => {
  await show(
    { ...ride, kind: 'offer', rideId: 'offer-1' },
    details({ driver: undefined, passengers: [{ name: 'Ben' }, { name: 'Cal', awaiting: true }] }),
  );

  expect(screen.getByText('Drive details')).toBeTruthy();
  expect(screen.getByLabelText('Driving')).toBeTruthy();
  expect(screen.getByText('Your passengers')).toBeTruthy();
  expect(screen.getByText('Cal  ·  awaiting')).toBeTruthy();
  expect(screen.getByText('Your car')).toBeTruthy();
  expect(screen.queryByText('Your driver')).toBeNull();
});
