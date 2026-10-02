/*
Utility file to handle generic date types, masks and functions.
*/

export {
  datePattern,
  dateExclusions,
  monthNames,
  weekdayLabels,
  formatDateToStr,
  parseDateAsStr,
  startOfDay,
  isFutureDate,
  isSameDay,
  isToday,
};

/* Date format:
  - days: all from 01->09 + 10->29 + 30->31
  - months all from 01->09 + 10->12
  - years: all from 2020->2099
*/
const datePattern = /^(?:[0][1-9]|[12]\d|3[01])-(?:0[1-9]|1[0-2])-(?:20[2-9]\d)$/;

/* Match to specific invalid dates, namely
  - 30th of Feb     (2)
  - 29th Feb when years are not a multiple of 4 (3)
  - 31st of Feb     (1)
  - 31st April      (1)
  - 31st June       (1)
  - 31st September  (1)
  - 31st November   (1)
*/
const dateExclusions = /^(?:31-(?:02|04|06|09|11)-\d{4}|30-02-\d{4}|29-02-20(?:[02468][048]|[13579][26]))$/;

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const weekdayLabels = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/* Convert a date object into a human-readable string (using DD-MM-YYYY format) */
function formatDateToStr(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${date.getFullYear()}`;
}

/* Convert a date (as a string) into a Date object (or undefined if invalid) */
function parseDateAsStr(value: string): Date | undefined {
  if (!datePattern.test(value.trim())) return undefined;      // fails format
  if (dateExclusions.test(value.trim())) return undefined;    // hits exceptions/edge cases
  const [day, month, year] = value.trim().split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/* Return a copy of a Date object where the time is set to midnight
  (only date component is preserved)
*/
function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/* Check if the given Date object is tomorrow or in the future */
function isFutureDate(date: Date): boolean {
  return startOfDay(date) > startOfDay(new Date());
}

/* Check if two Date objects represent the same date */
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/* Special case of 'isSameDay' where the second date is today */
function isToday(a: Date): boolean {
  return isSameDay(a, new Date());
}
