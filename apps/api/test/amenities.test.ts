import { beforeAll, describe, expect, it } from 'vitest';
import { ist, seedSociety, signedIn, useTestApp, type SeededSociety } from './helpers.js';
import { Membership, SlotCounter, Unit, User } from '../src/models/index.js';

const t = useTestApp();
let s: SeededSociety;
let amenityId: string;

const amenity = {
  name: 'Badminton Court',
  description: 'Indoor court with lights',
  location: 'Clubhouse',
  openTime: '06:00',
  closeTime: '22:00',
  slotMinutes: 60,
  capacity: 2,
  maxAdvanceDays: 7,
  maxActiveBookingsPerUnit: 2,
  cancellationCutoffHours: 2,
  active: true,
};

beforeAll(async () => {
  s = await seedSociety('amen');
  t.clock.set('2026-10-12T04:30:00.000Z'); // Mon 10:00 IST
  const admin = await signedIn(t.app, s.emails.admin);
  const res = await admin.post('/api/amenities', amenity);
  amenityId = res.body.id;
  // Extra residents in their own units for the capacity race.
  const extra = await Unit.insertMany(['301', '302', '303', '304'].map((n) => ({ societyId: s.societyId, buildingId: s.buildingId, number: n, label: `A-${n}`, floor: 3, status: 'occupied' })));
  const template = await User.findOne({ email: s.emails.resident }).select('+passwordHash');
  for (const [i, u] of extra.entries()) {
    const user = await User.create({ email: `extra${i}@example.test`, name: `Extra ${i}`, passwordHash: template!.passwordHash });
    await Membership.create({ userId: user._id, societyId: s.societyId, role: 'resident', unitId: u._id });
  }
});

describe('amenity availability and booking', () => {
  it('lists slots in the society time zone with reasons', async () => {
    const resident = await signedIn(t.app, s.emails.resident);
    const res = await resident.get(`/api/amenities/${amenityId}/availability?date=2026-10-12`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(16);
    expect(res.body[0].start).toBe('2026-10-12T00:30:00.000Z'); // 06:00 IST
    expect(res.body[0].reason).toBe('past');
    expect(res.body.find((sl: { start: string }) => sl.start === '2026-10-12T05:30:00.000Z').bookable).toBe(true);
    const far = await resident.get(`/api/amenities/${amenityId}/availability?date=2026-10-25`);
    expect(far.body[0].reason).toBe('too_far');
  });

  it('never oversells a slot under concurrent bookings', async () => {
    const clients = await Promise.all([0, 1, 2, 3].map((i) => signedIn(t.app, `extra${i}@example.test`)));
    const r = await signedIn(t.app, s.emails.resident2);
    const slotStart = ist('2026-10-13T18:00');
    const results = await Promise.all([...clients, r].map((c) => c.post('/api/amenities/bookings', { amenityId, slotStart })));
    const statuses = results.map((x) => x.status);
    expect(statuses.filter((st) => st === 201)).toHaveLength(2);
    expect(statuses.filter((st) => st === 409)).toHaveLength(3);
    expect(results.filter((x) => x.status === 409).every((x) => x.body.error.code === 'slot_full')).toBe(true);
    const counter = await SlotCounter.findOne({ slotStart: new Date('2026-10-13T12:30:00.000Z') });
    expect(counter!.count).toBe(2);
  });

  it('stops a household holding the same slot twice and enforces per-unit limits', async () => {
    const resident = await signedIn(t.app, s.emails.resident);
    const first = await resident.post('/api/amenities/bookings', { amenityId, slotStart: ist('2026-10-14T07:00') });
    expect(first.status).toBe(201);
    const dup = await resident.post('/api/amenities/bookings', { amenityId, slotStart: ist('2026-10-14T07:00') });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('already_booked');
    // The failed duplicate must not consume capacity.
    expect((await SlotCounter.findOne({ slotStart: new Date('2026-10-14T01:30:00.000Z') }))!.count).toBe(1);
    expect((await resident.post('/api/amenities/bookings', { amenityId, slotStart: ist('2026-10-14T08:00') })).status).toBe(201);
    const third = await resident.post('/api/amenities/bookings', { amenityId, slotStart: ist('2026-10-14T09:00') });
    expect(third.body.error.code).toBe('unit_limit');
  });

  it('rejects misaligned, past and too-distant slots', async () => {
    const r = await signedIn(t.app, s.emails.resident2);
    expect((await r.post('/api/amenities/bookings', { amenityId, slotStart: ist('2026-10-14T07:30') })).status).toBe(400);
    expect((await r.post('/api/amenities/bookings', { amenityId, slotStart: ist('2026-10-12T07:00') })).status).toBe(400);
    expect((await r.post('/api/amenities/bookings', { amenityId, slotStart: ist('2026-10-21T07:00') })).status).toBe(400);
    expect((await r.post('/api/amenities/bookings', { amenityId, slotStart: ist('2026-10-14T23:00') })).status).toBe(400);
  });

  it('applies the cancellation cutoff to residents and releases capacity on cancel', async () => {
    const r = await signedIn(t.app, s.emails.resident2);
    const b = await r.post('/api/amenities/bookings', { amenityId, slotStart: ist('2026-10-12T12:00') });
    expect(b.status).toBe(201);
    expect(b.body.canCancel).toBe(true);
    t.clock.set('2026-10-12T05:00:00.000Z'); // 10:30 IST, 1.5 h before
    const late = await r.post(`/api/amenities/bookings/${b.body.id}/cancel`);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('past_cutoff');
    const admin = await signedIn(t.app, s.emails.admin);
    const byAdmin = await admin.post(`/api/amenities/bookings/${b.body.id}/cancel`);
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.status).toBe('cancelled');
    expect((await SlotCounter.findOne({ slotStart: new Date('2026-10-12T06:30:00.000Z') }))!.count).toBe(0);
    expect((await admin.post(`/api/amenities/bookings/${b.body.id}/cancel`)).status).toBe(409);
    t.clock.set('2026-10-12T04:30:00.000Z');
  });

  it('keeps residents to their own bookings', async () => {
    const r1 = await signedIn(t.app, s.emails.resident);
    const r2 = await signedIn(t.app, s.emails.resident2);
    const mine = await r1.get('/api/amenities/bookings?scope=upcoming');
    const id = mine.body.items[0].id;
    expect((await r2.post(`/api/amenities/bookings/${id}/cancel`)).status).toBe(404);
    const theirs = await r2.get('/api/amenities/bookings?scope=all');
    expect(theirs.body.items.map((b: { id: string }) => b.id)).not.toContain(id);
  });

  it('refuses schedule changes while future bookings exist, and amenity admin to non-admins', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    expect((await admin.patch(`/api/amenities/${amenityId}`, { ...amenity, slotMinutes: 30 })).status).toBe(409);
    expect((await admin.patch(`/api/amenities/${amenityId}`, { ...amenity, capacity: 3 })).status).toBe(204);
    const r = await signedIn(t.app, s.emails.resident);
    expect((await r.post('/api/amenities', { ...amenity, name: 'Pool' })).status).toBe(403);
  });
});
