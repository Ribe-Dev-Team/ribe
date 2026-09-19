import {
  isValidDob,
  isValidEmail,
  isValidName,
  isValidPassword,
  isValidPhoneNumber,
} from '@/pages/schema/user.validation';

// Formats a Date as DD/MM/YYYY the same way the DOB fields in the app expect.
const formatDob = (date: Date) => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

const dobForAge = (age: number, dayOffset = 0) => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - age);
  date.setDate(date.getDate() + dayOffset);
  return formatDob(date);
};

describe('isValidEmail', () => {
  it.each([
    'user@example.com',
    'user.name+tag@sub.example.co',
    '  user@example.com  ',
  ])('accepts %s', (value) => {
    expect(isValidEmail(value)).toBe(true);
  });

  it.each([
    ['missing @', 'userexample.com'],
    ['missing domain dot', 'user@example'],
    ['space before @', 'user @example.com'],
    ['space in domain', 'user@ example.com'],
    ['empty string', ''],
  ])('rejects %s (%s)', (_label, value) => {
    expect(isValidEmail(value)).toBe(false);
  });
});

describe('isValidPassword', () => {
  it.each(['Password1', 'Abcdefg1', 'Str0ngPass'])('accepts %s', (value) => {
    expect(isValidPassword(value)).toBe(true);
  });

  it.each([
    ['no uppercase', 'password1'],
    ['no lowercase', 'PASSWORD1'],
    ['no digit', 'Password'],
    ['too short', 'Pass1'],
    ['empty string', ''],
  ])('rejects %s (%s)', (_label, value) => {
    expect(isValidPassword(value)).toBe(false);
  });
});

describe('isValidName', () => {
  it.each(['Anika', 'Anne-Marie', "O'Brien", 'José García'])('accepts %s', (value) => {
    expect(isValidName(value)).toBe(true);
  });

  it.each([
    ['single character', 'A'],
    ['contains digits', 'John123'],
    ['blank', '   '],
    ['double space between words', 'John  Doe'],
    ['empty string', ''],
  ])('rejects %s (%s)', (_label, value) => {
    expect(isValidName(value)).toBe(false);
  });
});

describe('isValidPhoneNumber', () => {
  it.each([
    ['10 local digits', '0412345678'],
    ['international with country code', '+61412345678'],
    ['9 digits padded by a plus sign and space', '+1 23456789'],
  ])('accepts %s (%s)', (_label, value) => {
    expect(isValidPhoneNumber(value)).toBe(true);
  });

  it.each([
    ['too short', '12345'],
    ['contains letters', '0412ABC678'],
    ['too many digits', '0412345678901'],
    ['empty string', ''],
  ])('rejects %s (%s)', (_label, value) => {
    expect(isValidPhoneNumber(value)).toBe(false);
  });
});

describe('isValidDob', () => {
  it('accepts a clearly adult date of birth', () => {
    expect(isValidDob('01/01/1990')).toBe(true);
  });

  it('accepts someone who turns 18 today', () => {
    expect(isValidDob(dobForAge(18))).toBe(true);
  });

  it('rejects someone who turns 18 tomorrow', () => {
    expect(isValidDob(dobForAge(18, 1))).toBe(false);
  });

  it('rejects a 17 year old', () => {
    expect(isValidDob(dobForAge(17))).toBe(false);
  });

  it.each([
    ['wrong separators', '1990-01-01'],
    ['day out of range', '32/01/1990'],
    ['non-existent calendar date', '31/02/1990'],
    ['empty string', ''],
  ])('rejects %s (%s)', (_label, value) => {
    expect(isValidDob(value)).toBe(false);
  });
});
