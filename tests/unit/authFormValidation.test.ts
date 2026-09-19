import {
  getDriverValidationError,
  getFormValidationError,
  type AuthFormValues,
  type DriverFormValues,
} from '@/pages/schema/user.validation';

const validSignup: AuthFormValues = {
  mode: 'signup',
  name: 'Anika Kamleshwaran',
  dob: '01/01/1990',
  phoneNumber: '0412345678',
  email: 'anika@example.com',
  password: 'Password1',
  confirmPassword: 'Password1',
};

const validLogin: AuthFormValues = {
  mode: 'login',
  name: '',
  dob: '',
  phoneNumber: '',
  email: 'anika@example.com',
  password: 'Password1',
  confirmPassword: '',
};

describe('getFormValidationError - login mode', () => {
  it('accepts a valid login (only email + password are checked)', () => {
    expect(getFormValidationError(validLogin)).toBeNull();
  });

  it('requires an email', () => {
    expect(getFormValidationError({ ...validLogin, email: '' })).toBe('Email is required.');
  });

  it('rejects a malformed email', () => {
    expect(getFormValidationError({ ...validLogin, email: 'not-an-email' })).toBe(
      'Enter a valid email address.',
    );
  });

  it('requires a password', () => {
    expect(getFormValidationError({ ...validLogin, password: '' })).toBe('Password is required.');
  });

  it('does not enforce password strength on login', () => {
    expect(getFormValidationError({ ...validLogin, password: 'weak' })).toBeNull();
  });

  it('does not require name, dob, phone number, or confirm password on login', () => {
    expect(
      getFormValidationError({
        ...validLogin,
        name: '',
        dob: '',
        phoneNumber: '',
        confirmPassword: '',
      }),
    ).toBeNull();
  });
});

describe('getFormValidationError - signup mode', () => {
  it('accepts a fully valid signup', () => {
    expect(getFormValidationError(validSignup)).toBeNull();
  });

  it('requires an email', () => {
    expect(getFormValidationError({ ...validSignup, email: '' })).toBe('Email is required.');
  });

  it('rejects a malformed email', () => {
    expect(getFormValidationError({ ...validSignup, email: 'not-an-email' })).toBe(
      'Enter a valid email address.',
    );
  });

  it('requires a password before checking anything else', () => {
    expect(getFormValidationError({ ...validSignup, password: '' })).toBe('Password is required.');
  });

  it('enforces password strength', () => {
    expect(getFormValidationError({ ...validSignup, password: 'weak', confirmPassword: 'weak' })).toBe(
      'Password must be at least 8 characters long and include uppercase, lowercase, and a number.',
    );
  });

  it('rejects an invalid name', () => {
    expect(getFormValidationError({ ...validSignup, name: 'John123' })).toBe(
      'Please enter a valid full name.',
    );
  });

  it('rejects an under-18 date of birth', () => {
    expect(getFormValidationError({ ...validSignup, dob: '01/01/2015' })).toBe(
      'Please enter a valid date of birth in DD/MM/YYYY format and you must be at least 18 years old.',
    );
  });

  it('rejects an invalid phone number', () => {
    expect(getFormValidationError({ ...validSignup, phoneNumber: '123' })).toBe(
      'Please enter a valid phone number.',
    );
  });

  it('requires confirm password', () => {
    expect(getFormValidationError({ ...validSignup, confirmPassword: '' })).toBe(
      'Please confirm your password.',
    );
  });

  it('rejects mismatched password confirmation', () => {
    expect(getFormValidationError({ ...validSignup, confirmPassword: 'Different1' })).toBe(
      'Passwords do not match.',
    );
  });

  it('trims whitespace before validating name, dob, and phone number', () => {
    expect(
      getFormValidationError({
        ...validSignup,
        name: '  Anika Kamleshwaran  ',
        dob: '  01/01/1990  ',
        phoneNumber: '  0412345678  ',
      }),
    ).toBeNull();
  });
});

const validDriver: DriverFormValues = {
  isDriver: true,
  vehicleMake: 'Honda',
  vehicleModel: 'Civic',
  vehicleColor: 'Silver',
  licensePlate: '1ABC234',
  seatsAvailable: '3',
};

describe('getDriverValidationError', () => {
  it('accepts fully valid driver details', () => {
    expect(getDriverValidationError(validDriver)).toBeNull();
  });

  it('skips vehicle validation entirely when the user is not a driver', () => {
    expect(
      getDriverValidationError({
        ...validDriver,
        isDriver: false,
        vehicleMake: '',
        vehicleModel: '',
        vehicleColor: '',
        licensePlate: '',
        seatsAvailable: '',
      }),
    ).toBeNull();
  });

  it('requires a vehicle make when signing up as a driver', () => {
    expect(getDriverValidationError({ ...validDriver, vehicleMake: '' })).toBe(
      'Please fill in all vehicle details.',
    );
  });

  it('requires a vehicle model when signing up as a driver', () => {
    expect(getDriverValidationError({ ...validDriver, vehicleModel: '' })).toBe(
      'Please fill in all vehicle details.',
    );
  });

  it('requires a vehicle color when signing up as a driver', () => {
    expect(getDriverValidationError({ ...validDriver, vehicleColor: '' })).toBe(
      'Please fill in all vehicle details.',
    );
  });

  it('requires a license plate when signing up as a driver', () => {
    expect(getDriverValidationError({ ...validDriver, licensePlate: '' })).toBe(
      'Please fill in all vehicle details.',
    );
  });

  it('rejects a non-numeric seats available value', () => {
    expect(getDriverValidationError({ ...validDriver, seatsAvailable: 'two' })).toBe(
      'Please enter a valid number of seats available.',
    );
  });

  it('rejects a seats available value below 1', () => {
    expect(getDriverValidationError({ ...validDriver, seatsAvailable: '0' })).toBe(
      'Please enter a valid number of seats available.',
    );
  });

  it('rejects a fractional seats available value', () => {
    expect(getDriverValidationError({ ...validDriver, seatsAvailable: '1.5' })).toBe(
      'Please enter a valid number of seats available.',
    );
  });

  it('trims whitespace before validating vehicle fields', () => {
    expect(
      getDriverValidationError({
        ...validDriver,
        vehicleMake: '  Honda  ',
        vehicleModel: '  Civic  ',
        vehicleColor: '  Silver  ',
        licensePlate: '  1ABC234  ',
      }),
    ).toBeNull();
  });
});
