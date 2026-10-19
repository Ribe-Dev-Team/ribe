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

/** What iOS sends for a key pressed in a hidden field it has wiped: the key,
 *  then the field's text - just that key, or nothing for backspace. */
const wipedKey = async (key: string) => {
  await fireEvent(input(), 'keyPress', { nativeEvent: { key } });
  await fireEvent.changeText(input(), key === 'Backspace' ? '' : key);
};

describe('on iOS, coming back to a rejected password', () => {
  const os = Platform.OS;
  beforeAll(() => { Platform.OS = 'ios'; });
  afterAll(() => { Platform.OS = os; });

  it('adds the next letter to the end instead of starting over', async () => {
    await render(<Controlled initial="Password" />);
    await wipedKey('1');
    expect(input().props.value).toBe('Password1');
  });

  it('keeps the password through every wipe, not just the first', async () => {
    // Restoring the text arms iOS's wipe again, so each key arrives wiped.
    await render(<Controlled initial="Password" />);
    await wipedKey('1');
    await wipedKey('2');
    await wipedKey('Backspace');
    await wipedKey('3');
    expect(input().props.value).toBe('Password13');
  });

  it('removes one letter on backspace instead of emptying the field', async () => {
    await render(<Controlled initial="Password1" />);
    await wipedKey('Backspace');
    expect(input().props.value).toBe('Password');
  });

  it('passes ordinary typing and deleting straight through', async () => {
    await render(<Controlled />);
    let previous = '';
    for (const text of ['P', 'Pa', 'Pas', 'Pa', 'P', '']) {
      const key = text.length < previous.length ? 'Backspace' : text.slice(-1);
      await fireEvent(input(), 'keyPress', { nativeEvent: { key } });
      await fireEvent.changeText(input(), text);
      previous = text;
      expect(input().props.value).toBe(text);
    }
  });

  it('leaves a shown password alone - iOS only wipes hidden ones', async () => {
    await render(<Controlled initial="Password" />);
    await fireEvent.press(screen.getByLabelText('Show password'));
    await fireEvent.changeText(input(), 'P');
    expect(input().props.value).toBe('P');
  });
});
