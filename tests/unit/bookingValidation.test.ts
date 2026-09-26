import {
  validateTripStep,
  validateDetailsStep,
  getTimeOrderWarning,
  getDetourWarning,
} from '../../mobile/pages/validation/bookingValidation';

/* Helper to build a valid future-dated string, so date-window tests don't go stale. */
function futureDateStr(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${d.getFullYear()}`;
}

const validRiderDetails = {
  travelDate: futureDateStr(7),
  isDriving: false,
  detourTime: 0,
  numSeats: 1,
  depTime: '08:00',
  arrTime: '09:00',
};

describe('validateTripStep', () => {
  test('rejects an empty address', () => {
    expect(validateTripStep('')).toEqual({ addrErr: 'Address is required.' });
  });

  test('rejects a whitespace-only address', () => {
    expect(validateTripStep('   ')).toEqual({ addrErr: 'Address is required.' });
  });

  test('accepts a non-empty address', () => {
    expect(validateTripStep('123 Main St')).toEqual({ addrErr: '' });
  });
});

describe('getTimeOrderWarning', () => {
  test('warns when arrival is before departure', () => {
    expect(getTimeOrderWarning('09:00', '08:00')).toBe('Arrival time must be later than departure time.');
  });

  test('warns when arrival equals departure', () => {
    expect(getTimeOrderWarning('08:00', '08:00')).toBe('Arrival time must be later than departure time.');
  });

  test('is silent when arrival is after departure', () => {
    expect(getTimeOrderWarning('08:00', '09:00')).toBe('');
  });

  test('is silent while either time is not yet a valid HH:mm', () => {
    expect(getTimeOrderWarning('8', '09:00')).toBe('');
    expect(getTimeOrderWarning('08:00', '')).toBe('');
  });
});

describe('getDetourWarning', () => {
  // A rider leaves detourTime at 0 (the field is driver-only), which the
  // zero case below already covers.
  test('is silent when detour time is zero', () => {
    expect(getDetourWarning(0, '08:00', '08:20')).toBe('');
  });

  test('warns when the detour exceeds the travel window', () => {
    expect(getDetourWarning(30, '08:00', '08:20')).toBe(
      'Detour of 30 min exceeds your 20 min travel window.',
    );
  });

  test('is silent when the detour fits within the travel window', () => {
    expect(getDetourWarning(10, '08:00', '08:20')).toBe('');
  });

  test('is silent while either time is not yet a valid HH:mm', () => {
    expect(getDetourWarning(30, '8am', '08:20')).toBe('');
  });
});

describe('validateDetailsStep - travel date', () => {
  test('rejects an unparseable date', () => {
    const result = validateDetailsStep({ ...validRiderDetails, travelDate: '31-02-2030' });
    expect(result.travelDateErr).toBe("'31-02-2030' is not a valid date");
    expect(result.valid).toBe(false);
  });

  test('rejects a past date', () => {
    const result = validateDetailsStep({ ...validRiderDetails, travelDate: '01-01-2020' });
    expect(result.travelDateErr).toBe("'01-01-2020' must be a future date");
    expect(result.valid).toBe(false);
  });

  test('accepts a valid future date', () => {
    const result = validateDetailsStep(validRiderDetails);
    expect(result.travelDateErr).toBe('');
  });
});

describe('validateDetailsStep - departure/arrival time format', () => {
  test('rejects a malformed departure time', () => {
    const result = validateDetailsStep({ ...validRiderDetails, depTime: '8:00' });
    expect(result.depTimeErr).toBe('Departure time must be HH:mm (24-hr).');
    expect(result.valid).toBe(false);
  });

  test('rejects a malformed arrival time', () => {
    const result = validateDetailsStep({ ...validRiderDetails, arrTime: '25:00' });
    expect(result.arrTimeErr).toBe('Arrival time must be HH:mm (24-hr).');
    expect(result.valid).toBe(false);
  });

  test('accepts valid 24-hr times', () => {
    const result = validateDetailsStep(validRiderDetails);
    expect(result.depTimeErr).toBe('');
    expect(result.arrTimeErr).toBe('');
  });
});

describe('validateDetailsStep - arrival-after-departure sanity check', () => {
  test('marks the step invalid when arrival is not after departure', () => {
    const result = validateDetailsStep({ ...validRiderDetails, depTime: '09:00', arrTime: '08:00' });
    expect(result.valid).toBe(false);
  });
});

describe('validateDetailsStep - rider (not driving)', () => {
  /*
  Riders are deliberately never asked for a detour tolerance - the matcher
  derives one from their own direct trip at match time
  (matching/src/riderPolicy.ts). So detour and seats are both ignored here,
  whatever the form state happens to hold.
  */
  test('ignores detour and seat values entirely for a rider', () => {
    const result = validateDetailsStep({ ...validRiderDetails, isDriving: false, detourTime: 45, numSeats: 20 });
    expect(result.detourTimeErr).toBe('');
    expect(result.numSeatsErr).toBe('');
    expect(result.valid).toBe(true);
  });

  test('a rider with no detour set is still valid', () => {
    const result = validateDetailsStep({ ...validRiderDetails, isDriving: false, detourTime: 0 });
    expect(result.detourTimeErr).toBe('');
    expect(result.valid).toBe(true);
  });
});

describe('validateDetailsStep - driver', () => {
  const validDriverDetails = { ...validRiderDetails, isDriving: true, detourTime: 15, numSeats: 3 };

  test('requires a positive detour time', () => {
    const result = validateDetailsStep({ ...validDriverDetails, detourTime: 0 });
    expect(result.detourTimeErr).toBe('Maximum detour time required');
    expect(result.valid).toBe(false);
  });

  test('requires at least one seat', () => {
    const result = validateDetailsStep({ ...validDriverDetails, numSeats: 0 });
    expect(result.numSeatsErr).toBe('Ride offers require at least one available seat');
    expect(result.valid).toBe(false);
  });

  test('caps seats at 12', () => {
    const result = validateDetailsStep({ ...validDriverDetails, numSeats: 13 });
    expect(result.numSeatsErr).toBe('Too many seats offered. Max 12.');
    expect(result.valid).toBe(false);
  });

  test('accepts a valid detour time and seat count', () => {
    const result = validateDetailsStep(validDriverDetails);
    expect(result.detourTimeErr).toBe('');
    expect(result.numSeatsErr).toBe('');
  });

  test('marks the step invalid when the detour exceeds the travel window', () => {
    const result = validateDetailsStep({ ...validDriverDetails, depTime: '08:00', arrTime: '08:10', detourTime: 15 });
    expect(result.valid).toBe(false);
  });

  test('is valid end-to-end for well-formed driver details', () => {
    const result = validateDetailsStep(validDriverDetails);
    expect(result.valid).toBe(true);
  });
});
