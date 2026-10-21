// Component tests for mobile/components/AddressAutocompleteInput.tsx: picking
// a suggestion closes the keyboard, and the picked place - not a geocode of
// the half-typed text - is what the form gets.

import * as React from 'react';
import { TextInput } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AddressAutocompleteInput from '../../mobile/components/AddressAutocompleteInput';

const PICKED = { address: '12 Example St, Clayton VIC', lat: -37.9, lng: 145.1 };
let mockGeocodeCalls: string[] = [];
jest.mock('../../mobile/services/googlePlaces', () => ({
  isPlacesConfigured: () => true,
  createSessionToken: () => 'token',
  fetchPlacePredictions: async () => [{ placeId: 'p1', description: '12 Example St, Clayton VIC' }],
  fetchPlaceDetails: async () => ({ address: '12 Example St, Clayton VIC', lat: -37.9, lng: 145.1 }),
  geocodeAddress: async (address: string) => { mockGeocodeCalls.push(address); return null; },
}));

jest.useRealTimers();

function Field({ onResolved }: { onResolved: (place: unknown) => void }) {
  const [value, setValue] = React.useState('');
  return <AddressAutocompleteInput placeholder="Address" value={value} onChangeText={setValue} onResolvedLocation={onResolved} />;
}

it('closes the keyboard and keeps the picked place when a suggestion is chosen', async () => {
  mockGeocodeCalls = [];
  const blur = jest.spyOn(TextInput.prototype, 'blur');
  const onResolved = jest.fn();
  await render(<Field onResolved={onResolved} />);

  const input = screen.getByPlaceholderText('Address');
  await fireEvent(input, 'focus');
  await fireEvent.changeText(input, '12 Exam');
  await act(() => new Promise((resolve) => setTimeout(resolve, 350))); // the suggestion debounce

  await act(async () => {
    await fireEvent.press(screen.getByText('12 Example St, Clayton VIC'));
    await fireEvent(input, 'blur'); // what blurring the field fires
  });

  expect(blur).toHaveBeenCalled();
  expect(onResolved).toHaveBeenCalledWith(PICKED);
  expect(mockGeocodeCalls).toEqual([]); // never the half-typed "12 Exam"
  expect(screen.getByDisplayValue('12 Example St, Clayton VIC')).toBeTruthy();
});

it('still geocodes an address typed without picking a suggestion', async () => {
  mockGeocodeCalls = [];
  await render(<Field onResolved={() => {}} />);
  const input = screen.getByPlaceholderText('Address');

  // Picked one, then edited it by hand.
  await fireEvent(input, 'focus');
  await fireEvent.changeText(input, '12 Exam');
  await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
  await act(async () => { await fireEvent.press(screen.getByText('12 Example St, Clayton VIC')); });
  await fireEvent(input, 'focus');
  await fireEvent.changeText(input, '14 Example St, Clayton VIC');
  await act(async () => { await fireEvent(input, 'blur'); });

  expect(mockGeocodeCalls).toEqual(['14 Example St, Clayton VIC']);
});

it('keeps location suggestions visible after the keyboard is dismissed', async () => {
  await render(<Field onResolved={() => {}} />);
  const input = screen.getByPlaceholderText('Address');

  await fireEvent(input, 'focus');
  await fireEvent.changeText(input, '12 Exam');
  await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
  await fireEvent(input, 'blur');

  expect(screen.getByText('12 Example St, Clayton VIC')).toBeTruthy();
});
