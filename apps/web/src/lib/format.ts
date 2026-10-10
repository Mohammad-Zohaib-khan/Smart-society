import { DateTime } from 'luxon';

/** All dates are shown in the society's time zone, not the device's. */
let zone = 'Asia/Kolkata';
export function setDisplayZone(tz: string): void {
  zone = tz;
}
export function displayZone(): string {
  return zone;
}

const dt = (iso: string) => DateTime.fromISO(iso, { zone });

export const fmt = {
  date: (iso: string | null | undefined) => (iso ? dt(iso).toFormat('d LLL yyyy') : '—'),
  dateShort: (iso: string | null | undefined) => (iso ? dt(iso).toFormat('d LLL') : '—'),
  time: (iso: string | null | undefined) => (iso ? dt(iso).toFormat('HH:mm') : '—'),
  dateTime: (iso: string | null | undefined) => (iso ? dt(iso).toFormat('d LLL, HH:mm') : '—'),
  weekdayDate: (iso: string) => dt(iso).toFormat('cccc d LLLL'),
  relative: (iso: string | null | undefined) => (iso ? (dt(iso).toRelative({ style: 'short' }) ?? '') : ''),
  calendarDate: (date: string) => DateTime.fromISO(date, { zone }).toFormat('ccc d LLL'),
};

export function todayLocal(): string {
  return DateTime.now().setZone(zone).toISODate() ?? '';
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone }).plus({ days }).toISODate() ?? date;
}

/** Converts a `datetime-local` input value in the society zone to an ISO string with offset. */
export function localInputToIso(value: string): string {
  return DateTime.fromISO(value, { zone }).toISO() ?? '';
}

export function isoToLocalInput(iso: string): string {
  return dt(iso).toFormat("yyyy-LL-dd'T'HH:mm");
}

export function nowLocalInput(plusMinutes = 0): string {
  return DateTime.now().setZone(zone).plus({ minutes: plusMinutes }).startOf('minute').toFormat("yyyy-LL-dd'T'HH:mm");
}

export function humanise(value: string): string {
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
