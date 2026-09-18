// Integration tests that drive the real BookingPage screen end-to-end
// (trip -> details -> confirm -> submit), backed by the in-memory Firestore
// and AsyncStorage mocks. The Google Places service is fully mocked so the
// suite never makes a real (billed) network call to the Google Maps API.

import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, getDocs, query } from 'firebase/firestore';
import * as firestoreMock from 'firebase/firestore';
import { db } from '../../mobile/firebaseConfig';
import BookingPage from '../../mobile/pages/BookingPage';

// Ionicons tries to load real font assets on mount, which isn't available
// under Jest and isn't relevant to the booking flow being tested here.
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

// Plain functions rather than jest.fn(): nothing here asserts on calls, and jest.config.js's
// resetMocks strips a jest.fn()'s mockResolvedValue before every test (including the first),
// so a jest.fn() default set here would silently return undefined instead of resolving.
jest.mock('../../mobile/services/googlePlaces', () => ({
  GOOGLE_MAPS_API_KEY: '',
  isPlacesConfigured: () => false,
  MONASH_CLAYTON_LOCATION: { label: 'Monash University Clayton', lat: -37.9106, lng: 145.1361 },
  createSessionToken: () => 'test-session-token',
  fetchPlacePredictions: async () => [],
  fetchPlaceDetails: async () => null,
  geocodeAddress: async () => null,
}));

// The Firestore/AsyncStorage mocks use real setTimeout delays internally;
// jest.setup.js switches the suite to fake timers by default, which would
// hang these awaits forever.
jest.useRealTimers();

const BOOKING_DRAFT_KEY = 'ribe:bookingDraftV1';

function futureDateStr(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${d.getFullYear()}`;
}

async function seedDraft(draft: Record<string, unknown>) {
  await AsyncStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(draft));
}

beforeEach(() => {
  (global as any).alert = jest.fn();
});

describe('BookingPage - rider requesting a ride', () => {
  test('submits a ride request end-to-end and persists it to Firestore', async () => {
    await seedDraft({
      isDriving: false,
      toUni: true,
      address: '123 Main St',
      travelDate: futureDateStr(7),
      depTime: '08:00',
      arrTime: '09:00',
    });

    const onDone = jest.fn();
    await render(<BookingPage onDone={onDone} />);

    // wait for the draft restore effect to hydrate the address field
    await screen.findByDisplayValue('123 Main St');

    fireEvent.press(screen.getByText('Next')); // trip -> details
    await screen.findByText('Trip details');

    fireEvent.press(screen.getByText('Next')); // details -> confirm
    await screen.findByText('Confirm your request');

    fireEvent.press(screen.getByText('Submit request'));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(global.alert).toHaveBeenCalledWith('Ride request successfully created!');

    const snapshot = await getDocs(query(collection(db, 'rideRequests')));
    expect(snapshot.size).toBe(1);
    expect(snapshot.docs[0].data().address).toBe('123 Main St');

    // the in-progress draft is cleared once the booking is submitted
    expect(await AsyncStorage.getItem(BOOKING_DRAFT_KEY)).toBeNull();
  });
});

describe('BookingPage - driver offering a ride', () => {
  test('submits a ride offer end-to-end and persists it to Firestore', async () => {
    await seedDraft({
      isDriving: true,
      toUni: true,
      address: '456 Example Ave',
      travelDate: futureDateStr(7),
      depTime: '08:00',
      arrTime: '09:00',
      detourTime: 15,
      capacity: 3,
    });

    const onDone = jest.fn();
    await render(<BookingPage onDone={onDone} />);

    await screen.findByDisplayValue('456 Example Ave');

    fireEvent.press(screen.getByText('Next')); // trip -> details
    await screen.findByText('Trip details');

    fireEvent.press(screen.getByText('Next')); // details -> confirm
    await screen.findByText('Confirm your request');

    fireEvent.press(screen.getByText('Submit request'));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(global.alert).toHaveBeenCalledWith('Ride offer successfully created!');

    const snapshot = await getDocs(query(collection(db, 'rideOffers')));
    expect(snapshot.size).toBe(1);
    expect(snapshot.docs[0].data().maxDetourTime).toBe(15);
    expect(snapshot.docs[0].data().seatCapacity).toBe(3);
  });
});

describe('BookingPage - trip step validation blocks incomplete submissions', () => {
  test('does not advance past the trip step without an address', async () => {
    const onDone = jest.fn();
    await render(<BookingPage onDone={onDone} />);

    await screen.findByText('Request a ride');
    fireEvent.press(screen.getByText('Next'));

    expect(await screen.findByText('Address is required.')).toBeTruthy();
    // still on the trip step
    expect(screen.queryByText('Trip details')).toBeNull();
  });
});

describe('BookingPage - Firestore write failure', () => {
  test('surfaces an error and does not clear the draft when the write fails', async () => {
    const addDocSpy = jest.spyOn(firestoreMock, 'addDoc').mockRejectedValueOnce(new Error('network down'));

    await seedDraft({
      isDriving: false,
      toUni: true,
      address: '123 Main St',
      travelDate: futureDateStr(7),
      depTime: '08:00',
      arrTime: '09:00',
    });

    const onDone = jest.fn();
    await render(<BookingPage onDone={onDone} />);

    await screen.findByDisplayValue('123 Main St');
    fireEvent.press(screen.getByText('Next'));
    await screen.findByText('Trip details');
    fireEvent.press(screen.getByText('Next'));
    await screen.findByText('Confirm your request');
    fireEvent.press(screen.getByText('Submit request'));

    await waitFor(() =>
      expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('Error submitting booking')),
    );
    expect(onDone).not.toHaveBeenCalled();
    // the draft survives so the user doesn't lose their in-progress booking
    expect(await AsyncStorage.getItem(BOOKING_DRAFT_KEY)).not.toBeNull();

    addDocSpy.mockRestore();
  });
});
