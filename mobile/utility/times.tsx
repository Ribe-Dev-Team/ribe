/*
Utility file to handle generic time types, masks and functions.
*/

export {
  sepTime12h,
  timePattern,
  isValid24Time,
  toMinutes,
  decomposeTime12h,
  formatTime12h,
  convert12hTo24h,
};

/* type for decomposed 12-hours time */
interface sepTime12h {
  hrs: number,
  mins: number,
  period: 'AM' | 'PM',
};

/* Time (24hr):
  - hours: all from 00->19 + 20->23
  - minutes: all from 00->59
*/
const timePattern = /^(?:[01]\d|2[0-3]):(?:[0-5]\d)$/;

function isValid24Time(time: string): boolean {
  return timePattern.test(time);
}

/* convert a 24-hr time (as string) into a number of minutes past midnight */
function toMinutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

/* take a 24-hr string and break it down into components of a 12-hr time */
function decomposeTime12h(time: string): sepTime12h {
  if (!timePattern.test(time.trim())) throw new Error(`'${time}' was not a valid 24-hr time.`);
  const [hh, mm] = time.trim().split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return {
    hrs: hour12,
    mins: mm,
    period
  };
}

/* convert a 24-hr time (as string) into a 12-hr time (string) */
function formatTime12h(time: string): string {
  if (!timePattern.test(time.trim())) return time;
  const t12 = decomposeTime12h(time);
  return `${t12.hrs}:${String(t12.mins).padStart(2, '0')} ${t12.period}`;
}

function convert12hTo24h(t12: sepTime12h): string {
  const hh = (t12.period === 'PM')
    ? t12.hrs % 12 + 12   // +12 for 12-23 range
    : t12.hrs % 12;       // +0 for 0-11 range
  return `${String(hh).padStart(2, '0')}:${String(t12.mins).padStart(2, '0')}`;
}