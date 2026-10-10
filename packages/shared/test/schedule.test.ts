import { describe, expect, it } from 'vitest';
import { daysAhead, intervalsOverlap, isSlotStart, isValidSchedule, localDayBounds, slotsForDay } from '../src/schedule.js';

const tz = 'Asia/Kolkata';

describe('slotsForDay', () => {
  it('builds slots in the society time zone', () => {
    const slots = slotsForDay({ openTime: '06:00', closeTime: '09:00', slotMinutes: 60 }, '2026-10-10', tz);
    expect(slots).toHaveLength(3);
    // 06:00 IST is 00:30 UTC
    expect(slots[0]?.start.toISOString()).toBe('2026-10-10T00:30:00.000Z');
    expect(slots[2]?.end.toISOString()).toBe('2026-10-10T03:30:00.000Z');
  });
  it('drops a trailing partial slot', () => {
    expect(slotsForDay({ openTime: '06:00', closeTime: '07:45', slotMinutes: 60 }, '2026-10-10', tz)).toHaveLength(1);
  });
  it('returns nothing for invalid dates or schedules', () => {
    expect(slotsForDay({ openTime: '06:00', closeTime: '07:00', slotMinutes: 60 }, '2026-13-40', tz)).toEqual([]);
    expect(slotsForDay({ openTime: '09:00', closeTime: '08:00', slotMinutes: 60 }, '2026-10-10', tz)).toEqual([]);
    expect(isValidSchedule({ openTime: '9:00', closeTime: '10:00', slotMinutes: 60 })).toBe(false);
  });
  it('recognises valid slot starts only', () => {
    const s = { openTime: '06:00', closeTime: '09:00', slotMinutes: 60 };
    expect(isSlotStart(s, new Date('2026-10-10T01:30:00.000Z'), tz)).toBe(true);
    expect(isSlotStart(s, new Date('2026-10-10T01:00:00.000Z'), tz)).toBe(false);
    expect(isSlotStart(s, new Date('2026-10-10T03:30:00.000Z'), tz)).toBe(false);
  });
});

describe('time helpers', () => {
  it('treats intervals as half-open', () => {
    const a = new Date('2026-01-01T10:00:00Z');
    const b = new Date('2026-01-01T11:00:00Z');
    const c = new Date('2026-01-01T12:00:00Z');
    expect(intervalsOverlap(a, b, b, c)).toBe(false);
    expect(intervalsOverlap(a, c, b, c)).toBe(true);
  });
  it('counts calendar days in local time', () => {
    // 23:00 IST on the 9th vs 01:00 IST on the 10th: one calendar day apart
    expect(daysAhead(new Date('2026-10-09T19:30:00Z'), new Date('2026-10-09T17:30:00Z'), tz)).toBe(1);
  });
  it('computes local day bounds', () => {
    const { start, end } = localDayBounds(new Date('2026-10-09T20:00:00Z'), tz);
    expect(start.toISOString()).toBe('2026-10-09T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-10T18:30:00.000Z');
  });
});
