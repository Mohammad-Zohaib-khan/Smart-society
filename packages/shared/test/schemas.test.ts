import { describe, expect, it } from 'vitest';
import { complaintSchema, invitationSchema, inviteMemberSchema, loginSchema, password, vehicleSchema } from '../src/schemas.js';

describe('schemas', () => {
  it('rejects unknown keys to prevent mass assignment', () => {
    const r = complaintSchema.safeParse({ title: 'Leak', description: 'Water leaking from ceiling', category: 'Plumbing', priority: 'high', area: 'unit', status: 'closed' });
    expect(r.success).toBe(false);
  });
  it('rejects operator objects where strings are expected (NoSQL injection)', () => {
    expect(loginSchema.safeParse({ email: { $ne: '' }, password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: { $gt: '' } }).success).toBe(false);
  });
  it('normalises vehicle registrations', () => {
    const r = vehicleSchema.parse({ registrationNumber: 'mh 12-ab 1234', type: 'car' });
    expect(r.registrationNumber).toBe('MH12AB1234');
  });
  it('requires invitation windows to move forward', () => {
    const r = invitationSchema.safeParse({ visitorName: 'Asha', purpose: 'guest', guestCount: 1, validFrom: '2026-10-10T12:00:00+05:30', validUntil: '2026-10-10T10:00:00+05:30' });
    expect(r.success).toBe(false);
  });
  it('requires residents to be tied to a unit', () => {
    expect(inviteMemberSchema.safeParse({ email: 'r@x.in', name: 'Ravi', role: 'resident' }).success).toBe(false);
    expect(inviteMemberSchema.safeParse({ email: 'g@x.in', name: 'Gita', role: 'guard' }).success).toBe(true);
  });
  it('enforces password strength', () => {
    expect(password.safeParse('short1').success).toBe(false);
    expect(password.safeParse('longenoughpassword').success).toBe(false);
    expect(password.safeParse('longenough123').success).toBe(true);
  });
});
