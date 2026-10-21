/** A driver's number is shown in full only this close to pickup; before then
 *  just enough to recognise it. */
export const PHONE_REVEAL_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * A phone number spaced into its parts: "+61 412 345 678" when it starts with
 * a plus, else "0412 345 678". Works on a number still being typed - no
 * trailing space, so backspace removes a digit rather than the space it just
 * added - and drops digits past the end of a full number.
 */
export function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  const groups = phone.trim().startsWith('+')
    ? ['+' + digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 8), digits.slice(8, 11)]
    : [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7, 10)];
  return groups.filter(Boolean).join(' ');
}

/** The number formatted, with everything after its "0412" / "+61 412" hidden. */
export function maskPhone(phone: string) {
  const shown = phone.trim().startsWith('+') ? 5 : 4;
  let seen = 0;
  return formatPhone(phone).replace(/\d/g, (digit) => (++seen <= shown ? digit : '•'));
}
