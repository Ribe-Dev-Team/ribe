// Integration tests for a user's driver status in mobile/auth/useAuth.tsx,
// against the in-memory Firebase mocks. Saving the profile page (photo,
// degree, bio) used to reset isDriver and the car details, and saving driver
// registration used to wipe the degree and bio - every save wrote every field.

import * as React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../../mobile/firebaseConfig';

// __mocks__/firebase/auth.ts replaces useAuth with a stub for every test that
// loads Firebase auth, so the real provider is loaded explicitly.
const { AuthProvider, useAuth } = jest.requireActual('../../mobile/auth/useAuth') as typeof import('../../mobile/auth/useAuth');

// The mocked Firestore uses real setTimeout delays internally.
jest.useRealTimers();

const UID = 'driver-uid';
const car = { vehicleMake: 'Toyota', vehicleModel: 'Corolla', vehicleColor: 'Blue', licensePlate: 'ABC123', seatsAvailable: 3 };

/** Renders the real AuthProvider signed in as UID, and hands back its hook. */
async function signIn() {
  (auth as unknown as { currentUser: unknown }).currentUser = { uid: UID, email: 'd@example.com', displayName: 'Dana' };
  let hook!: ReturnType<typeof useAuth>;
  const Probe = () => { hook = useAuth(); return null; };
  await render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(hook.loading).toBe(false));
  currentHook = () => hook;
  return currentHook;
}

/** Save through the hook inside act(), so the provider's state updates -
 *  submitting on, then off - are applied before the test looks. */
let currentHook: () => ReturnType<typeof useAuth>;
const save = (data: Parameters<ReturnType<typeof useAuth>['updateProfileDetails']>[0]) =>
  act(() => currentHook().updateProfileDetails(data));

const stored = async (collection: string) => (await getDoc(doc(db, collection, UID))).data();

afterEach(() => {
  (auth as unknown as { currentUser: unknown }).currentUser = null;
});

it('keeps a driver a driver, with their car, when they edit their profile', async () => {
  await setDoc(doc(db, 'users', UID), { name: 'Dana', isDriver: true, degree: 'Law', bio: 'Hi', onboardingComplete: true, ...car });
  const hook = await signIn();

  await save({ degree: 'Engineering', bio: 'Drives in most days.' });

  expect(await stored('users')).toMatchObject({ isDriver: true, degree: 'Engineering', bio: 'Drives in most days.', ...car });
  await waitFor(() => expect(hook().profileData).toMatchObject({ isDriver: true, vehicleMake: 'Toyota', degree: 'Engineering' }));
});

it("keeps someone's degree and bio when they register as a driver", async () => {
  await setDoc(doc(db, 'users', UID), { name: 'Dana', isDriver: false, degree: 'Law', bio: 'Hi', onboardingComplete: true });
  const hook = await signIn();

  await save({ isDriver: true, ...car });

  expect(await stored('users')).toMatchObject({ isDriver: true, degree: 'Law', bio: 'Hi', ...car });
  expect(await stored('drivers')).toMatchObject({ uid: UID, ...car });
});

it('still clears a field the person emptied on purpose', async () => {
  await setDoc(doc(db, 'users', UID), { name: 'Dana', isDriver: true, degree: 'Law', bio: 'Hi', onboardingComplete: true, ...car });
  const hook = await signIn();

  await save({ degree: '', bio: 'Hi' });

  expect(await stored('users')).toMatchObject({ degree: null, isDriver: true });
});

it('updates the phone number from the profile page, and keeps it when another save leaves it out', async () => {
  await setDoc(doc(db, 'users', UID), { name: 'Dana', phoneNumber: '0400000000', onboardingComplete: true });
  const hook = await signIn();

  await save({ phoneNumber: ' 0412345678 ', bio: 'Hi' });
  expect(await stored('users')).toMatchObject({ phoneNumber: '0412345678' });
  await waitFor(() => expect(hook().profileData).toMatchObject({ phoneNumber: '0412345678' }));

  await save({ isDriver: true, ...car });
  expect(await stored('users')).toMatchObject({ phoneNumber: '0412345678' });
});

it('shows a driver whose profile an older save reset as a driver again, with their car', async () => {
  // What the old save left behind: users/{uid} reset, drivers/{uid} intact.
  await setDoc(doc(db, 'users', UID), {
    name: 'Dana', isDriver: false, onboardingComplete: true,
    vehicleMake: null, vehicleModel: null, vehicleColor: null, licensePlate: null, seatsAvailable: null,
  });
  await setDoc(doc(db, 'drivers', UID), { uid: UID, name: 'Dana', ...car });

  const hook = await signIn();

  expect(hook().profileData).toMatchObject({ isDriver: true, ...car });
});

it('shows someone who never registered as not a driver', async () => {
  await setDoc(doc(db, 'users', UID), { name: 'Dana', isDriver: false, onboardingComplete: true });

  const hook = await signIn();

  expect(hook().profileData?.isDriver).toBe(false);
});
