// Unit tests for formatWeekdayDate in mobile/utility/dates.ts - the travel
// date on the booking confirm page, with its day of the week.

import { formatWeekdayDate } from '../../mobile/utility/dates';

it('writes the day of the week, then the date with slashes', () => {
  expect(formatWeekdayDate(new Date(2026, 10, 2))).toBe('Monday 02/11/2026');
  expect(formatWeekdayDate(new Date(2026, 10, 3))).toBe('Tuesday 03/11/2026');
});
