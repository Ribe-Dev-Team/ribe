// Component tests for mobile/components/PasswordInput.tsx: the button that
// shows or hides the password, and undoing iOS wiping a hidden password field
// on the first key pressed after it's focused again.

import * as React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import PasswordInput from '../../mobile/components/PasswordInput';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

/** The input as a parent holds it: its value lives in state, as on AuthPage. */
function Controlled({ initial = '' }: { initial?: string }) {
  const [value, setValue] = React.useState(initial);
  return <PasswordInput placeholder="Password" value={value} onChangeText={setValue} />;
}

const input = () => screen.getByPlaceholderText('Password');

it('hides the password until the eye button is pressed, and hides it again', async () => {
  await render(<Controlled initial="Secret1x" />);
  expect(input().props.secureTextEntry).toBe(true);

  await fireEvent.press(screen.getByLabelText('Show password'));
  expect(input().props.secureTextEntry).toBe(false);

  await fireEvent.press(screen.getByLabelText('Hide password'));
  expect(input().props.secureTextEntry).toBe(true);
});

describe('on iOS, coming back to a rejected password', () => {
  const os = Platform.OS;
  beforeAll(() => { Platform.OS = 'ios'; });
  afterAll(() => { Platform.OS = os; });

  it('adds the next letter to the end instead of starting over', async () => {
    await render(<Controlled initial="Password" />);
    await fireEvent(input(), 'focus');
    await fireEvent.changeText(input(), '1'); // iOS reports only the new key
    expect(input().props.value).toBe('Password1');

    // Later keys arrive whole, as normal.
    await fireEvent.changeText(input(), 'Password12');
    expect(input().props.value).toBe('Password12');
  });

  it('removes one letter on backspace instead of emptying the field', async () => {
    await render(<Controlled initial="Password1" />);
    await fireEvent(input(), 'focus');
    await fireEvent.changeText(input(), '');
    expect(input().props.value).toBe('Password');
  });

  it('leaves a shown password alone - iOS only wipes hidden ones', async () => {
    await render(<Controlled initial="Password" />);
    await fireEvent.press(screen.getByLabelText('Show password'));
    await fireEvent(input(), 'focus');
    await fireEvent.changeText(input(), 'P');
    expect(input().props.value).toBe('P');
  });
});
