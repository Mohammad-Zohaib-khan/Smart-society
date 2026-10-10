import { beforeAll, describe, expect, it } from 'vitest';
import { ist, seedSociety, signedIn, useTestApp, type SeededSociety } from './helpers.js';
import { AuditLog, Notification, Visit, VisitorInvitation } from '../src/models/index.js';
import { purgeExpiredVisitorData } from '../src/modules/visitors.js';

const t = useTestApp();
let s: SeededSociety;

beforeAll(async () => {
  s = await seedSociety('vis');
});

const invite = (overrides: Record<string, unknown> = {}) => ({
  visitorName: 'Asha Rao',
  visitorPhone: '+91 98765 43210',
  purpose: 'guest',
  guestCount: 2,
  validFrom: ist('2026-10-12T09:00'),
  validUntil: ist('2026-10-12T18:00'),
  ...overrides,
});

describe('pre-approved visitor journey', () => {
  it('resident invites → guard verifies → check-in → check-out, with notifications and audit', async () => {
    t.clock.set('2026-10-12T04:30:00.000Z');
    const resident = await signedIn(t.app, s.emails.resident);
    const guard = await signedIn(t.app, s.emails.guard);

    const created = await resident.post('/api/visitors/invitations', invite());
    expect(created.status).toBe(201);
    expect(created.body.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(created.body.unitLabel).toBe('A-101');

    const board = await guard.get('/api/visitors/gate/board');
    expect(board.body.expectedToday.map((i: { id: string }) => i.id)).toContain(created.body.id);

    const verify = await guard.post('/api/visitors/gate/verify', { code: created.body.code.toLowerCase() });
    expect(verify.status).toBe(200);
    expect(verify.body.checkIn).toEqual({ ok: true });

    const checkIn = await guard.post(`/api/visitors/gate/invitations/${created.body.id}/check-in`);
    expect(checkIn.status).toBe(201);
    expect(checkIn.body.status).toBe('inside');
    expect(checkIn.body.visitorPhone).toBe('••••••3210'); // guards see masked numbers

    const residentView = await resident.get('/api/visitors/visits');
    expect(residentView.body.items[0].visitorPhone).toBe('+91 98765 43210');

    expect(await Notification.exists({ userId: s.userIds.resident, type: 'visitor.arrived' })).toBeTruthy();

    const out = await guard.post(`/api/visitors/gate/visits/${checkIn.body.id}/check-out`);
    expect(out.status).toBe(200);
    expect(out.body.status).toBe('checked_out');
    expect(out.body.checkedOutBy.name).toContain('guard');
    expect((await guard.post(`/api/visitors/gate/visits/${checkIn.body.id}/check-out`)).status).toBe(409);
    expect(await AuditLog.countDocuments({ societyId: s.societyId, action: { $in: ['visitors.checked_in', 'visitors.checked_out'] } })).toBe(2);
  });

  it('allows exactly one of two simultaneous check-ins of the same pass', async () => {
    const resident = await signedIn(t.app, s.emails.resident);
    const g1 = await signedIn(t.app, s.emails.guard);
    const g2 = await signedIn(t.app, s.emails.admin); // admins can also operate the gate
    const inv = await resident.post('/api/visitors/invitations', invite({ visitorName: 'Race Test' }));
    const results = await Promise.all([
      g1.post(`/api/visitors/gate/invitations/${inv.body.id}/check-in`),
      g2.post(`/api/visitors/gate/invitations/${inv.body.id}/check-in`),
      g1.post(`/api/visitors/gate/invitations/${inv.body.id}/check-in`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await Visit.countDocuments({ invitationId: inv.body.id })).toBe(1);
  });

  it('rejects passes outside their window and cancelled passes with clear reasons', async () => {
    const resident = await signedIn(t.app, s.emails.resident);
    const guard = await signedIn(t.app, s.emails.guard);
    const later = await resident.post('/api/visitors/invitations', invite({ validFrom: ist('2026-10-13T09:00'), validUntil: ist('2026-10-13T12:00') }));
    const early = await guard.post(`/api/visitors/gate/invitations/${later.body.id}/check-in`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('not_yet_valid');

    const cancelMe = await resident.post('/api/visitors/invitations', invite());
    expect((await resident.post(`/api/visitors/invitations/${cancelMe.body.id}/cancel`)).status).toBe(204);
    const cancelled = await guard.post(`/api/visitors/gate/invitations/${cancelMe.body.id}/check-in`);
    expect(cancelled.body.error.code).toBe('cancelled');

    t.clock.set('2026-10-12T13:00:00.000Z'); // 18:30 IST, after the window
    const expiring = await VisitorInvitation.findOne({ _id: later.body.id });
    expiring!.validUntil = new Date('2026-10-12T12:00:00.000Z');
    await expiring!.save();
    const expired = await guard.post('/api/visitors/gate/verify', { code: later.body.code });
    expect(expired.body.checkIn).toEqual({ ok: false, reason: 'expired' });
    t.clock.set('2026-10-12T04:30:00.000Z');
  });

  it('enforces the society’s invitation policy', async () => {
    const resident = await signedIn(t.app, s.emails.resident);
    const tooLong = await resident.post('/api/visitors/invitations', invite({ validFrom: ist('2026-10-12T09:00'), validUntil: ist('2026-10-14T09:00') }));
    expect(tooLong.status).toBe(400);
    const tooFar = await resident.post('/api/visitors/invitations', invite({ validFrom: ist('2027-01-12T09:00'), validUntil: ist('2027-01-12T10:00') }));
    expect(tooFar.status).toBe(400);
    const past = await resident.post('/api/visitors/invitations', invite({ validFrom: ist('2026-10-11T09:00'), validUntil: ist('2026-10-11T10:00') }));
    expect(past.status).toBe(400);
  });

  it('only lets residents create invitations', async () => {
    const guard = await signedIn(t.app, s.emails.guard);
    expect((await guard.post('/api/visitors/invitations', invite())).status).toBe(403);
  });
});

describe('walk-in visitors', () => {
  it('guard registers → resident approves in the app → visitor is inside', async () => {
    const guard = await signedIn(t.app, s.emails.guard);
    const resident = await signedIn(t.app, s.emails.resident);
    const reg = await guard.post('/api/visitors/gate/walk-ins', { visitorName: 'Courier', purpose: 'delivery', unitId: String(s.units[0]), guestCount: 1 });
    expect(reg.status).toBe(201);
    expect(reg.body.visit.status).toBe('awaiting_approval');
    expect(reg.body.residentsNotified).toBe(1);

    const other = await signedIn(t.app, s.emails.resident2);
    expect((await other.post(`/api/visitors/visits/${reg.body.visit.id}/decision`, { decision: 'approve' })).status).toBe(404);

    const ok = await resident.post(`/api/visitors/visits/${reg.body.visit.id}/decision`, { decision: 'approve' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('inside');
    expect(ok.body.decision.method).toBe('resident_app');
    // A late second decision cannot overwrite the first.
    const late = await guard.post(`/api/visitors/gate/visits/${reg.body.visit.id}/decision`, { decision: 'deny', method: 'intercom' });
    expect(late.status).toBe(409);
  });

  it('records intercom denials and blocks guard-only approvals when policy requires residents', async () => {
    const guard = await signedIn(t.app, s.emails.guard);
    const reg = await guard.post('/api/visitors/gate/walk-ins', { visitorName: 'Salesperson', purpose: 'other', unitId: String(s.units[1]), guestCount: 1 });
    const selfApprove = await guard.post(`/api/visitors/gate/visits/${reg.body.visit.id}/decision`, { decision: 'approve', method: 'in_person' });
    expect(selfApprove.status).toBe(403);
    const deny = await guard.post(`/api/visitors/gate/visits/${reg.body.visit.id}/decision`, { decision: 'deny', method: 'intercom', note: 'Resident declined' });
    expect(deny.status).toBe(200);
    expect(deny.body.status).toBe('denied');
    expect((await guard.post(`/api/visitors/gate/visits/${reg.body.visit.id}/check-out`)).status).toBe(409);
  });

  it('lets a guard withdraw a visitor who left before a decision', async () => {
    const guard = await signedIn(t.app, s.emails.guard);
    const reg = await guard.post('/api/visitors/gate/walk-ins', { visitorName: 'Impatient', purpose: 'guest', unitId: String(s.units[1]), guestCount: 1 });
    expect((await guard.post(`/api/visitors/gate/visits/${reg.body.visit.id}/withdraw`)).status).toBe(204);
    expect((await Visit.findById(reg.body.visit.id))!.status).toBe('withdrawn');
  });
});

describe('visitor data retention', () => {
  it('anonymises finished visits older than the retention period, but not visits in progress', async () => {
    const guard = await signedIn(t.app, s.emails.guard);
    const reg = await guard.post('/api/visitors/gate/walk-ins', { visitorName: 'Still Inside', visitorPhone: '9999988888', purpose: 'guest', unitId: String(s.units[0]), guestCount: 1 });
    const resident = await signedIn(t.app, s.emails.resident);
    await resident.post(`/api/visitors/visits/${reg.body.visit.id}/decision`, { decision: 'approve' });
    t.clock.advance(181 * 86_400_000);
    const n = await purgeExpiredVisitorData();
    expect(n).toBeGreaterThan(0);
    const scrubbed = await Visit.findOne({ visitorName: 'Removed after retention period' });
    expect(scrubbed?.visitorPhone).toBeNull();
    const inside = await Visit.findById(reg.body.visit.id);
    expect(inside!.visitorName).toBe('Still Inside');
    t.clock.set('2026-10-12T04:30:00.000Z');
  });
});
