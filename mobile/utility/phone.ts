/** A driver's number is shown in full only this close to pickup; before then
 *  just enough to recognise it. */
export const PHONE_REVEAL_WINDOW_MS = 12 * 60 * 60 * 1000;

export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return `${digits.slice(0, 4)} •• •• ••`;
}

export function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)}`;
}
