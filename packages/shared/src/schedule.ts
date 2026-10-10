import { DateTime } from 'luxon';

/** "HH:mm" in 24-hour time. */
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
/** "yyyy-MM-dd" calendar date. */
export const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AmenitySchedule {
  openTime: string;
  closeTime: string;
  slotMinutes: number;
}

export interface Slot {
  start: Date;
  end: Date;
}

export function minutesOfDay(time: string): number {
  if (!TIME_OF_DAY.test(time)) throw new Error(`Invalid time of day: ${time}`);
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function isValidSchedule(s: AmenitySchedule): boolean {
  if (!TIME_OF_DAY.test(s.openTime) || !TIME_OF_DAY.test(s.closeTime)) return false;
  if (!Number.isInteger(s.slotMinutes) || s.slotMinutes < 15 || s.slotMinutes > 720) return false;
  const span = minutesOfDay(s.closeTime) - minutesOfDay(s.openTime);
  return span >= s.slotMinutes;
}

/** Parse a calendar date in a society's time zone; returns null for invalid input. */
export function parseLocalDate(date: string, timeZone: string): DateTime | null {
  if (!CALENDAR_DATE.test(date)) return null;
  const dt = DateTime.fromISO(date, { zone: timeZone });
  return dt.isValid ? dt.startOf('day') : null;
}

/**
 * Build the bookable slots for one calendar day in the society's time zone.
 * Slots never run past closing time; a trailing remainder shorter than a slot is dropped.
 */
export function slotsForDay(schedule: AmenitySchedule, date: string, timeZone: string): Slot[] {
  const day = parseLocalDate(date, timeZone);
  if (!day || !isValidSchedule(schedule)) return [];
  const open = minutesOfDay(schedule.openTime);
  const close = minutesOfDay(schedule.closeTime);
  const slots: Slot[] = [];
  for (let m = open; m + schedule.slotMinutes <= close; m += schedule.slotMinutes) {
    const start = day.plus({ minutes: m });
    slots.push({ start: start.toJSDate(), end: start.plus({ minutes: schedule.slotMinutes }).toJSDate() });
  }
  return slots;
}

/** True when `start` is exactly the start of one of that day's slots. */
export function isSlotStart(schedule: AmenitySchedule, start: Date, timeZone: string): boolean {
  const local = DateTime.fromJSDate(start, { zone: timeZone });
  const date = local.toISODate();
  if (!date) return false;
  return slotsForDay(schedule, date, timeZone).some((s) => s.start.getTime() === start.getTime());
}

/** Half-open interval overlap: [aStart, aEnd) ∩ [bStart, bEnd). */
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Whole days between `now` and `target`, measured in the society's calendar. */
export function daysAhead(target: Date, now: Date, timeZone: string): number {
  const t = DateTime.fromJSDate(target, { zone: timeZone }).startOf('day');
  const n = DateTime.fromJSDate(now, { zone: timeZone }).startOf('day');
  return Math.round(t.diff(n, 'days').days);
}

/** Start and end (exclusive) of the society-local day containing `at`. */
export function localDayBounds(at: Date, timeZone: string): { start: Date; end: Date } {
  const d = DateTime.fromJSDate(at, { zone: timeZone }).startOf('day');
  return { start: d.toJSDate(), end: d.plus({ days: 1 }).toJSDate() };
}

export function isValidTimeZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}
