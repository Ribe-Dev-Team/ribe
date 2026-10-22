// Integration tests that drive the real BookingPage screen end-to-end
// (trip -> details -> confirm -> submit), backed by the in-memory Firestore
// and AsyncStorage mocks. The Google Places service is fully mocked so the
// suite never makes a real (billed) network call to the Google Maps API.

import * as React from 'react';
import { screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, doc, getDocs, query, setDoc } from 'firebase/firestore';
import * as firestoreMock from 'firebase/firestore';
import { db } from '../../mobile/firebaseConfig';
import BookingPage, { draftHasProgress } from '../../mobile/pages/BookingPage';
import { renderWithThemedAlerts as render } from '../themedRender';

// Ionicons tries to load real font assets on mount, which isn't available
// under Jest and isn't relevant to the booking flow being tested here.
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../mobile/auth/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'mock-test-uid' } }),
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

jest.mock('../../mobile/utility/emissions', () => ({
  estimateEmissionsSaved: async () => 2.4,
}));
// BookingPage reads the signed-in user's uid from useAuth to stamp bookings, and the real hook
// throws outside an AuthProvider. Stub it with a fixed signed-in user instead of standing up
// Firebase Auth. A plain function (not jest.fn()) so resetMocks doesn't wipe the return value.
// The profile is a registered driver with a 4-seat car unless a test sets
// mockProfile - jest.mock factories may only use variables named mock*.
const DRIVER_PROFILE = {
  isDriver: true, licensePlate: 'ABC123', seatsAvailable: 4,
  name: 'Dana Driver', phoneNumber: '0412345678', vehicleColor: 'Blue', vehicleMake: 'Toyota', vehicleModel: 'Corolla',
};
let mockProfile: Record<string, unknown> = DRIVER_PROFILE;
jest.mock('../../mobile/auth/useAuth', () => {
  const useAuth = () => ({ user: { uid: 'test-user-123' }, profileData: mockProfile });
  return { __esModule: true, useAuth, default: useAuth };
});

// The Firestore/AsyncStorage mocks use real setTimeout delays internally;
// jest.setup.js switches the suite to fake timers by default, which would
// hang these awaits forever.
jest.useRealTimers();

const TEST_USER_ID = 'test-user-123';
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

// BookingPage restores its draft via an async AsyncStorage read with no visible loading state,
// so there's nothing for findBy*/waitFor to key off while it's in flight. A short act()-wrapped
// real delay (AsyncStorage's mock resolves in ~1ms) lets that resolve - and the resulting
// setHydrated(true) update flush - before assertions run, avoiding an "outside of act()" warning.
async function flushHydration() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

// Submitting chains several mocked Firestore/AsyncStorage calls (each a few ms of real
// setTimeout). fireEvent only wraps the synchronous part of the press handler in act(), so the
// handler's final state update (setIsSubmitting(false)) lands outside it. Wrap the whole press in
// an outer act() and keep it open until the submit has settled.
async function pressSubmit(label = 'Submit request') {
  await act(async () => {
    await fireEvent.press(screen.getByText(new RegExp(`^${label}$`, 'i')));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}


beforeEach(async () => {
  mockProfile = DRIVER_PROFILE;
  // addRideOffer checks the driver's registered car in Firestore, too.
  await setDoc(doc(db, 'users', TEST_USER_ID), DRIVER_PROFILE);
  answerDraftPrompt('Yes');
  // BookingPage logs each booking it creates; not something to print here.
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

/** Select the response used by the saved-draft dialog. */
let draftPromptAnswer: 'Yes' | 'No' = 'Yes';
function answerDraftPrompt(answer: 'Yes' | 'No') {
  draftPromptAnswer = answer;
}

async function respondToDraftPrompt() {
  await screen.findByText('Continue where you left off?');
  await fireEvent.press(screen.getByText(draftPromptAnswer === 'Yes' ? 'Continue' : 'Start Fresh'));
  await flushHydration();
}

/** The draft as last saved - the form's state once the user has answered. */
async function savedDraft() {
  await flushHydration();
  return JSON.parse((await AsyncStorage.getItem(BOOKING_DRAFT_KEY)) ?? 'null');
}

describe('BookingPage - continuing a saved draft', () => {
  const draft = {
    isDriving: false, toUni: false, address: '123 Main St', travelDate: futureDateStr(7),
    depTime: '08:00', arrTime: '09:00', detourTime: 0, capacity: 1,
  };

  test('asks whether to continue, and restores the draft on Yes', async () => {
    await seedDraft(draft);
    await render(<BookingPage onDone={() => {}} />);
    await flushHydration();

    await respondToDraftPrompt();
    await screen.findByDisplayValue('123 Main St');
    expect(await savedDraft()).toMatchObject(draft);
  });

  test('starts a blank form on No, keeping the day picked on the calendar', async () => {
    answerDraftPrompt('No');
    await seedDraft(draft);
    const calendarDay = new Date();
    calendarDay.setDate(calendarDay.getDate() + 3);
    await render(<BookingPage onDone={() => {}} initialDate={calendarDay} />);
    await flushHydration();

    await respondToDraftPrompt();
    expect(screen.queryByDisplayValue('123 Main St')).toBeNull();
    // The old draft is saved over with the fresh form.
    expect(await savedDraft()).toEqual({
      isDriving: false, toUni: true, address: '', travelDate: futureDateStr(3),
      detourTime: 0, capacity: 1, depTime: '', arrTime: '',
    });
  });

  test("keeps the calendar day on Yes when the draft hadn't picked one", async () => {
    await seedDraft({ ...draft, travelDate: '' });
    const calendarDay = new Date();
    calendarDay.setDate(calendarDay.getDate() + 3);
    await render(<BookingPage onDone={() => {}} initialDate={calendarDay} />);
    await respondToDraftPrompt();

    expect(await savedDraft()).toMatchObject({ address: '123 Main St', travelDate: futureDateStr(3) });
  });

  test("doesn't ask when there's nothing to continue", async () => {
    await render(<BookingPage onDone={() => {}} />);
    await flushHydration();
    expect(screen.queryByText('Continue where you left off?')).toBeNull();

    // The blank form it saved - just a date at most - doesn't bring it up next time.
    await seedDraft({ isDriving: false, toUni: true, address: '', travelDate: futureDateStr(2), detourTime: 0, capacity: 1, depTime: '', arrTime: '' });
    await render(<BookingPage onDone={() => {}} />);
    await flushHydration();
    expect(screen.queryByText('Continue where you left off?')).toBeNull();
  });
});

describe('draftHasProgress', () => {
  const blank = { isDriving: false, toUni: true, address: '', travelDate: '', detourTime: 0, capacity: 1, depTime: '', arrTime: '' };

  it('is false for a blank form, or one with just a date', () => {
    expect(draftHasProgress(blank)).toBe(false);
    expect(draftHasProgress({ ...blank, travelDate: futureDateStr(1) })).toBe(false);
    expect(draftHasProgress({ ...blank, address: '   ' })).toBe(false);
  });

  it.each([
    ['an address', { address: '1 Home St' }],
    ['a time', { depTime: '08:00' }],
    ['offering a ride', { isDriving: true }],
    ['going home', { toUni: false }],
    ['a detour', { detourTime: 10 }],
    ['seats', { capacity: 2 }],
  ])('is true once the form has %s', (_label, change) => {
    expect(draftHasProgress({ ...blank, ...change })).toBe(true);
  });
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
    await flushHydration();
    await respondToDraftPrompt();

    await screen.findByText('Request a Ride');
    // the draft restore effect should have hydrated the address field
    await screen.findByDisplayValue('123 Main St');

    await fireEvent.press(screen.getByText('Next')); // trip -> details
    await screen.findByText('Trip Details');

    await fireEvent.press(screen.getByText('Next')); // details -> confirm
    await screen.findByText('Confirm Your Request');
    await screen.findByText('Submit Request');

    // A card with what their driver will see of them, in place of a "Role" row.
    expect(screen.getByText("You're Requesting a Ride")).toBeTruthy();
    expect(screen.getByText('Dana Driver  ·  0412 345 678')).toBeTruthy();
    expect(screen.getByText(/Your driver will see your first name/)).toBeTruthy();
    expect(screen.queryByText('Role')).toBeNull();

    await pressSubmit();

    await screen.findByText('Ride request created');
    expect(onDone).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Done'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    const snapshot = await getDocs(query(collection(db, 'rideRequests')));
    expect(snapshot.size).toBe(1);
    expect(snapshot.docs[0].data().address).toBe('123 Main St');
    expect(snapshot.docs[0].data().userId).toBe(TEST_USER_ID);

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
    await flushHydration();
    await respondToDraftPrompt();

    await screen.findByText('Offer a Ride');
    await screen.findByDisplayValue('456 Example Ave');

    await fireEvent.press(screen.getByText('Next')); // trip -> details
    await screen.findByText('Trip Details');

    await fireEvent.press(screen.getByText('Next')); // details -> confirm
    await screen.findByText('Confirm Your Offer');
    await screen.findByText('Submit Offer');

    // A card for the car they're offering, in place of a "Role" row.
    expect(screen.getByText("You're Offering a Ride")).toBeTruthy();
    expect(screen.getByText('Blue Toyota Corolla')).toBeTruthy();
    expect(screen.getByText('ABC123')).toBeTruthy();
    expect(screen.getByText('Dana Driver  ·  0412 345 678')).toBeTruthy(); // shared with riders too
    expect(screen.getByText(/Riders matched to you will see your car and plate/)).toBeTruthy();
    expect(screen.queryByText('Role')).toBeNull();
    // The travel date with its day of the week.
    const day = new Date();
    day.setDate(day.getDate() + 7);
    const weekday = day.toLocaleDateString('en-AU', { weekday: 'long' });
    expect(screen.getByText(`${weekday} ${futureDateStr(7).replace(/-/g, '/')}`)).toBeTruthy();

    await pressSubmit('Submit Offer');

    await screen.findByText('Ride offer created');
    expect(onDone).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Done'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    const snapshot = await getDocs(query(collection(db, 'rideOffers')));
    expect(snapshot.size).toBe(1);
    expect(snapshot.docs[0].data().maxDetourTime).toBe(15);
    expect(snapshot.docs[0].data().seatCapacity).toBe(3);
    expect(snapshot.docs[0].data().userId).toBe(TEST_USER_ID);
  });
});

describe('BookingPage - offering a ride needs a registered car', () => {
  test("doesn't let someone with no car registered switch to offering a ride", async () => {
    mockProfile = { isDriver: false };
    await render(<BookingPage onDone={() => {}} />);
    await flushHydration();

    await fireEvent.press(screen.getByText('Offering a Ride'));

    expect(screen.getByText(/register as a driver with your car in your Profile/)).toBeTruthy();
    expect(screen.queryByText('Driver Details')).toBeNull();
  });

  test('turns a saved draft offer back into a request for someone with no car registered', async () => {
    mockProfile = { isDriver: false };
    await seedDraft({
      isDriving: true, toUni: true, address: '456 Example Ave', travelDate: futureDateStr(7),
      depTime: '08:00', arrTime: '09:00', detourTime: 15, capacity: 3,
    });
    await render(<BookingPage onDone={() => {}} />);
    await flushHydration();
    await respondToDraftPrompt();
    await screen.findByDisplayValue('456 Example Ave');

    await fireEvent.press(screen.getByText('Next'));
    await screen.findByText('Trip Details');

    expect(screen.queryByText('Driver Details')).toBeNull();
  });

  test("caps the seats at the car's passenger seats", async () => {
    mockProfile = { ...DRIVER_PROFILE, seatsAvailable: 2 };
    await seedDraft({
      isDriving: true, toUni: true, address: '456 Example Ave', travelDate: futureDateStr(7),
      depTime: '08:00', arrTime: '09:00', detourTime: 15, capacity: 3,
    });
    await render(<BookingPage onDone={() => {}} />);
    await flushHydration();
    await respondToDraftPrompt();
    await screen.findByDisplayValue('456 Example Ave');
    await fireEvent.press(screen.getByText('Next'));
    await screen.findByText('Trip Details');

    expect(screen.getByText('Up to 2 - the passenger seats in your car.')).toBeTruthy();
    // The draft's 3 is brought down to the car's 2.
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('3')).toBeNull();
  });
});

describe('BookingPage - trip step validation blocks incomplete submissions', () => {
  test('does not advance past the trip step without an address', async () => {
    const onDone = jest.fn();
    await render(<BookingPage onDone={onDone} />);
    await flushHydration();

    await screen.findByText('Request a Ride');
    await fireEvent.press(screen.getByText('Next'));

    expect(await screen.findByText('Address is required.')).toBeTruthy();
    // still on the trip step
    expect(screen.queryByText('Trip Details')).toBeNull();
  });
});

describe('BookingPage - Firestore write failure', () => {
  test('surfaces an error and does not clear the draft when the write fails', async () => {
    const addDocSpy = jest.spyOn(firestoreMock, 'addDoc').mockRejectedValueOnce(new Error('network down'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

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
    await flushHydration();
    await respondToDraftPrompt();

    await screen.findByDisplayValue('123 Main St');
    await fireEvent.press(screen.getByText('Next'));
    await screen.findByText('Trip Details');
    await fireEvent.press(screen.getByText('Next'));
    await screen.findByText('Confirm Your Request');
    await pressSubmit();

    await screen.findByText('Could not create ride');
    expect(screen.getByText('network down')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    // the draft survives so the user doesn't lose their in-progress booking
    expect(await AsyncStorage.getItem(BOOKING_DRAFT_KEY)).not.toBeNull();
    // and the failure is logged for debugging
    expect(consoleError).toHaveBeenCalledWith('Failed to create ride request/offer:', expect.objectContaining({ message: 'network down' }));

    addDocSpy.mockRestore();
  });
});
