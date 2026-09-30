import { calendarDateIn, dateKey, isHhMm, zonedDateTime } from '../src/melbourneTime';

// Melbourne daylight saving starts 2:00 am Sunday 4 October 2026 (+10 -> +11).

describe('calendarDateIn', () => {
  it('reads a phone-stored local midnight as the intended day, not the UTC day before', () => {
    // parseDateAsStr('05-10-2026') on a Melbourne phone = local midnight = 13:00Z on the 4th.
    const stored = new Date('2026-10-04T13:00:00Z');
    expect(calendarDateIn(stored)).toEqual({ year: 2026, month: 10, day: 5 });
  });

  it('handles the standard-time side of the year too', () => {
    const stored = new Date('2026-09-14T14:00:00Z'); // midnight 15 Sep, UTC+10
    expect(calendarDateIn(stored)).toEqual({ year: 2026, month: 9, day: 15 });
  });
});

describe('zonedDateTime', () => {
  it('uses +10 before daylight saving starts', () => {
    expect(zonedDateTime({ year: 2026, month: 10, day: 3 }, '08:00').toISOString())
      .toBe('2026-10-02T22:00:00.000Z');
  });

  it('uses +11 after daylight saving starts', () => {
    expect(zonedDateTime({ year: 2026, month: 10, day: 5 }, '08:00').toISOString())
      .toBe('2026-10-04T21:00:00.000Z');
  });

  it('gets the changeover day itself right on both sides of 2 am', () => {
    const day = { year: 2026, month: 10, day: 4 };
    expect(zonedDateTime(day, '01:30').toISOString()).toBe('2026-10-03T15:30:00.000Z');
    expect(zonedDateTime(day, '09:00').toISOString()).toBe('2026-10-03T22:00:00.000Z');
  });

  it('rejects a malformed time rather than guessing', () => {
    expect(() => zonedDateTime({ year: 2026, month: 10, day: 5 }, '8am')).toThrow();
    expect(() => zonedDateTime({ year: 2026, month: 10, day: 5 }, '24:00')).toThrow();
  });
});

describe('isHhMm / dateKey', () => {
  it('accepts only 24-hour HH:mm', () => {
    expect(isHhMm('08:05')).toBe(true);
    expect(isHhMm('23:59')).toBe(true);
    expect(isHhMm('8:05')).toBe(false);
    expect(isHhMm(undefined)).toBe(false);
  });

  it('pads the key so batches sort by date', () => {
    expect(dateKey({ year: 2026, month: 3, day: 7 })).toBe('2026-03-07');
  });
});
