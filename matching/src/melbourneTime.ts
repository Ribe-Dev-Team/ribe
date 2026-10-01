/**
 * Turning a stored booking's date and "HH:mm" strings into real instants.
 *
 * The app stores `date` as the phone's LOCAL midnight (parseDateAsStr builds
 * `new Date(y, m, d)`), so in Firestore a Melbourne booking for 5 October is the
 * instant 2026-10-04T13:00Z. Read naively on a server running in UTC, that is the
 * 4th, and every trip would be matched a day early. Times are "HH:mm" with no
 * zone at all. Both are therefore interpreted in the campus's own time zone, and
 * daylight saving is handled by asking Intl for the real offset rather than
 * assuming +10 or +11.
 */

export const CAMPUS_TIME_ZONE = 'Australia/Melbourne';

export interface CalendarDate {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Whether `value` is a 24-hour "HH:mm" string, the only time format the app writes. */
export function isHhMm(value: unknown): value is string {
  return typeof value === 'string' && HHMM.test(value.trim());
}

function partsIn(instant: Date, timeZone: string): Record<string, number> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** The calendar date `instant` falls on in `timeZone`. */
export function calendarDateIn(instant: Date, timeZone = CAMPUS_TIME_ZONE): CalendarDate {
  const p = partsIn(instant, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Minutes `timeZone` is ahead of UTC at `instant` (Melbourne: 600 or 660). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The instant a wall-clock time on `date` happens in `timeZone`.
 *
 * Guesses with the offset at the naive UTC reading, then corrects once if that
 * guess landed on the other side of a daylight-saving change. Throws on a
 * malformed time: a silently wrong departure sends a driver at the wrong hour.
 */
export function zonedDateTime(date: CalendarDate, hhmm: string, timeZone = CAMPUS_TIME_ZONE): Date {
  const m = HHMM.exec(hhmm.trim());
  if (!m) throw new Error(`'${hhmm}' is not a 24-hour HH:mm time`);

  const naive = Date.UTC(date.year, date.month - 1, date.day, Number(m[1]), Number(m[2]));
  const first = offsetMinutes(new Date(naive), timeZone);
  const guess = naive - first * 60_000;
  const second = offsetMinutes(new Date(guess), timeZone);
  return new Date(second === first ? guess : naive - second * 60_000);
}

/** "2026-10-05" - sortable, and stable for a given booking. */
export function dateKey(date: CalendarDate): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}
