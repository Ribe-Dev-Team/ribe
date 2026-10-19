// Unit tests for mobile/utility/phone.ts: phone numbers spaced into their
// parts as they're typed and shown, local or +61, and masked before pickup.

import { formatPhone, maskPhone } from '../../mobile/utility/phone';

describe('formatPhone', () => {
  it.each([
    ['0412345678', '0412 345 678'],
    ['+61412345678', '+61 412 345 678'],
    ['0412 345678', '0412 345 678'],
    ['+61 4123-45678', '+61 412 345 678'],
  ])('spaces %s as %s', (input, expected) => {
    expect(formatPhone(input)).toBe(expected);
  });

  it('spaces a number still being typed, with no trailing space', () => {
    expect(['0', '0412', '04123', '0412345', '04123456'].map(formatPhone))
      .toEqual(['0', '0412', '0412 3', '0412 345', '0412 345 6']);
    expect(['+', '+6', '+61', '+614', '+61412', '+614123'].map(formatPhone))
      .toEqual(['+', '+6', '+61', '+61 4', '+61 412', '+61 412 3']);
  });

  it('lets backspace remove a digit rather than getting stuck on a space', () => {
    // Deleting "3" from "0412 3" leaves "0412 ", which formats back to "0412".
    expect(formatPhone('0412 ')).toBe('0412');
    expect(formatPhone('+61 ')).toBe('+61');
  });

  it('drops digits past the end of a full number', () => {
    expect(formatPhone('04123456789')).toBe('0412 345 678');
    expect(formatPhone('+614123456789')).toBe('+61 412 345 678');
  });

  it('is empty for an empty number', () => {
    expect(formatPhone('')).toBe('');
  });
});

describe('maskPhone', () => {
  it('shows only the start of the number, in the same spacing', () => {
    expect(maskPhone('0412345678')).toBe('0412 ••• •••');
    expect(maskPhone('+61412345678')).toBe('+61 412 ••• •••');
  });
});
