/*
Pure validation logic for the booking flow (BookingPage). Kept free of React state
so it can be unit tested directly without rendering the component.
*/

import { timePattern, toMinutes } from '../../utility/times';
import { isFutureDate, parseDateAsStr } from '../../utility/dates';

export { validateTripStep, validateDetailsStep, getTimeOrderWarning, getDetourWarning };
export type { TripStepErrors, DetailsStepInput, DetailsStepErrors };

interface TripStepErrors {
  addrErr: string;
}

interface DetailsStepInput {
  travelDate: string;
  isDriving: boolean;
  detourTime: number;
  numSeats: number;
  depTime: string;
  arrTime: string;
}

interface DetailsStepErrors {
  travelDateErr: string;
  detourTimeErr: string;
  numSeatsErr: string;
  depTimeErr: string;
  arrTimeErr: string;
  resetDetourTime: boolean;
  valid: boolean;
}

/* Warning shown inline when the arrival time isn't after the departure time. */
function getTimeOrderWarning(depTime: string, arrTime: string): string {
  const depMinutes = timePattern.test(depTime.trim()) ? toMinutes(depTime.trim()) : null;
  const arrMinutes = timePattern.test(arrTime.trim()) ? toMinutes(arrTime.trim()) : null;
  return depMinutes !== null && arrMinutes !== null && arrMinutes <= depMinutes
    ? 'Arrival time must be later than departure time.'
    : '';
}

/* Warning shown inline when a driver's max detour exceeds their departure-to-arrival window. */
function getDetourWarning(isDriving: boolean, detourTime: number, depTime: string, arrTime: string): string {
  const depMinutes = timePattern.test(depTime.trim()) ? toMinutes(depTime.trim()) : null;
  const arrMinutes = timePattern.test(arrTime.trim()) ? toMinutes(arrTime.trim()) : null;
  if (!isDriving || detourTime <= 0 || depMinutes === null || arrMinutes === null) return '';
  const window = arrMinutes - depMinutes;
  return window < detourTime ? `Detour of ${detourTime} min exceeds your ${window} min travel window.` : '';
}

function validateTripStep(address: string): TripStepErrors {
  return { addrErr: address.trim() ? '' : 'Address is required.' };
}

function validateDetailsStep(input: DetailsStepInput): DetailsStepErrors {
  const { travelDate, isDriving, detourTime, numSeats, depTime, arrTime } = input;
  let valid = true;

  // travel date validation
  const parsedDate = parseDateAsStr(travelDate);
  let travelDateErr = '';
  if (!parsedDate) {
    travelDateErr = `'${travelDate}' is not a valid date`;
    valid = false;
  } else if (!isFutureDate(parsedDate)) {
    travelDateErr = `'${travelDate}' must be a future date`;
    valid = false;
  }

  // detour time & seats validation
  let detourTimeErr = '';
  let numSeatsErr = '';
  let resetDetourTime = false;
  if (!isDriving) {
    resetDetourTime = true;
  } else {
    if (detourTime <= 0) {
      detourTimeErr = 'Maximum detour time required';
      valid = false;
    }
    if (numSeats < 1) {
      numSeatsErr = 'Ride offers require at least one available seat';
      valid = false;
    } else if (numSeats > 12) {
      numSeatsErr = 'Too many seats offered. Max 12.';
      valid = false;
    }
  }

  // departure time validation
  let depTimeErr = '';
  if (!timePattern.test(depTime.trim())) {
    depTimeErr = 'Departure time must be HH:mm (24-hr).';
    valid = false;
  }

  // arrival time validation
  let arrTimeErr = '';
  if (!timePattern.test(arrTime.trim())) {
    arrTimeErr = 'Arrival time must be HH:mm (24-hr).';
    valid = false;
  }

  // arrival-after-departure and detour-vs-window sanity checks (surfaced inline as the user types)
  if (getTimeOrderWarning(depTime, arrTime) || getDetourWarning(isDriving, detourTime, depTime, arrTime)) {
    valid = false;
  }

  return { travelDateErr, detourTimeErr, numSeatsErr, depTimeErr, arrTimeErr, resetDetourTime, valid };
}
