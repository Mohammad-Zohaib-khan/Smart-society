import { beforeAll, describe, expect, it } from 'vitest';
import { seedSociety, signedIn, useTestApp, type SeededSociety } from './helpers.js';
import { Complaint, Membership, VisitorInvitation } from '../src/models/index.js';

const t = useTestApp();
let a: SeededSociety;
let b: SeededSociety;

beforeAll(async () => {
  a = await seedSociety('ta');
  b = await seedSociety('tb');
});

describe('cross-society isolation', () => {
  it('hides other societies’ records behind 404s (no IDOR)', async () => {
    const residentB = await signedIn(t.app, b.emails.resident);
    const created = await residentB.post('/api/complaints', { title: 'Tap leaking', description: 'Kitchen tap leaks constantly', category: 'Plumbing', priority: 'medium', area: 'unit' });
    expect(created.status).toBe(201);
    const adminA = await signedIn(t.app, a.emails.admin);
    expect((await adminA.get(`/api/complaints/${created.body.id}`)).status).toBe(404);
    expect((await adminA.post(`/api/complaints/${created.body.id}/status`, { status: 'cancelled' })).status).toBe(404);
    const list = await adminA.get('/api/complaints');
    expect(list.body.items.map((c: { id: string }) => c.id)).not.toContain(created.body.id);
  });

  it('refuses to assign work to staff from another society', async () => {
    const adminA = await signedIn(t.app, a.emails.admin);
    const residentA = await signedIn(t.app, a.emails.resident);
    const c = await residentA.post('/api/complaints', { title: 'Lift stuck', description: 'Lift stops between floors', category: 'Lift', priority: 'high', area: 'common_area' });
    const res = await adminA.post(`/api/complaints/${c.body.id}/assign`, { assigneeMembershipId: String(b.membershipIds.staff) });
    expect(res.status).toBe(400);
  });

  it('cannot invite into another society’s unit or edit its members', async () => {
    const adminA = await signedIn(t.app, a.emails.admin);
    expect((await adminA.post('/api/society/invites', { email: 'intruder@example.test', name: 'In Truder', role: 'resident', unitId: String(b.units[0]) })).status).toBe(404);
    expect((await adminA.patch(`/api/society/members/${String(b.membershipIds.resident)}`, { status: 'suspended' })).status).toBe(404);
    expect((await Membership.findById(b.membershipIds.resident))!.status).toBe('active');
  });

  it('cannot check in another society’s visitor pass', async () => {
    const residentB = await signedIn(t.app, b.emails.resident);
    const inv = await residentB.post('/api/visitors/invitations', { visitorName: 'Cousin', purpose: 'guest', guestCount: 1, validFrom: '2026-10-12T04:00:00.000Z', validUntil: '2026-10-12T12:00:00.000Z' });
    expect(inv.status).toBe(201);
    const guardA = await signedIn(t.app, a.emails.guard);
    expect((await guardA.post('/api/visitors/gate/verify', { code: inv.body.code })).status).toBe(404);
    expect((await guardA.post(`/api/visitors/gate/invitations/${inv.body.id}/check-in`)).status).toBe(404);
    expect((await VisitorInvitation.findById(inv.body.id))!.status).toBe('active');
  });
});

describe('role restrictions inside a society', () => {
  it('keeps guards out of directories, reports and audit history', async () => {
    const guard = await signedIn(t.app, a.emails.guard);
    for (const url of ['/api/society/members', '/api/reports/summary', '/api/audit', '/api/society/units', '/api/complaints']) {
      expect((await guard.get(url)).status, url).toBe(403);
    }
  });

  it('gives guards a unit lookup without resident names or numbers', async () => {
    const guard = await signedIn(t.app, a.emails.guard);
    const res = await guard.get('/api/society/gate-units?q=A-1');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body[0]).sort()).toEqual(['hasActiveResidents', 'id', 'label']);
  });

  it('stops residents from seeing another unit’s passes and complaints', async () => {
    const r1 = await signedIn(t.app, a.emails.resident);
    const r2 = await signedIn(t.app, a.emails.resident2);
    const inv = await r1.post('/api/visitors/invitations', { visitorName: 'Plumber', purpose: 'service', guestCount: 1, validFrom: '2026-10-12T05:00:00.000Z', validUntil: '2026-10-12T08:00:00.000Z' });
    const list = await r2.get('/api/visitors/invitations');
    expect(list.body.items.map((i: { id: string }) => i.id)).not.toContain(inv.body.id);
    expect((await r2.post(`/api/visitors/invitations/${inv.body.id}/cancel`)).status).toBe(404);
    const c = await r1.post('/api/complaints', { title: 'Damp wall', description: 'Bedroom wall is damp', category: 'Plumbing', priority: 'low', area: 'unit' });
    expect((await r2.get(`/api/complaints/${c.body.id}`)).status).toBe(404);
  });

  it('only shows staff the work orders assigned to them', async () => {
    const r1 = await signedIn(t.app, a.emails.resident);
    const admin = await signedIn(t.app, a.emails.admin);
    const c = await r1.post('/api/complaints', { title: 'Corridor light', description: 'Light out on floor 1', category: 'Electrical', priority: 'low', area: 'common_area' });
    await admin.post(`/api/complaints/${c.body.id}/assign`, { assigneeMembershipId: String(a.membershipIds.staff) });
    const other = await signedIn(t.app, a.emails.staff2);
    expect((await other.get(`/api/complaints/${c.body.id}`)).status).toBe(404);
    expect((await other.post(`/api/complaints/${c.body.id}/status`, { status: 'in_progress' })).status).toBe(404);
    const mine = await signedIn(t.app, a.emails.staff);
    expect((await mine.post(`/api/complaints/${c.body.id}/status`, { status: 'in_progress' })).status).toBe(200);
  });

  it('keeps the committee read-only for operations and hides contact details', async () => {
    const committee = await signedIn(t.app, a.emails.committee);
    const members = await committee.get('/api/society/members');
    expect(members.status).toBe(200);
    expect(members.body.items.every((m: { email: string; phone: unknown }) => m.email === '' && m.phone === null)).toBe(true);
    const c = await Complaint.findOne({ societyId: a.societyId });
    expect((await committee.post(`/api/complaints/${String(c!._id)}/assign`, { assigneeMembershipId: String(a.membershipIds.staff) })).status).toBe(403);
    expect((await committee.patch(`/api/society/members/${String(a.membershipIds.guard)}`, { role: 'admin' })).status).toBe(403);
  });

  it('prevents privilege escalation by residents and self-promotion by admins', async () => {
    const resident = await signedIn(t.app, a.emails.resident);
    expect((await resident.patch(`/api/society/members/${String(a.membershipIds.resident)}`, { role: 'admin' })).status).toBe(403);
    const admin = await signedIn(t.app, a.emails.admin);
    expect((await admin.patch(`/api/society/members/${String(a.membershipIds.admin)}`, { status: 'suspended' })).status).toBe(403);
  });

  it('suspending a member revokes their access on the next request', async () => {
    const guard = await signedIn(t.app, a.emails.guard);
    expect((await guard.get('/api/visitors/gate/board')).status).toBe(200);
    const admin = await signedIn(t.app, a.emails.admin);
    expect((await admin.patch(`/api/society/members/${String(a.membershipIds.guard)}`, { status: 'suspended' })).status).toBe(204);
    expect((await guard.get('/api/visitors/gate/board')).status).toBe(403);
    await admin.patch(`/api/society/members/${String(a.membershipIds.guard)}`, { status: 'active' });
  });

  it('never leaves a society without an admin', async () => {
    const admin = await signedIn(t.app, a.emails.admin);
    // Promote the committee member, then demote the original admin via the new admin.
    expect((await admin.patch(`/api/society/members/${String(a.membershipIds.committee)}`, { role: 'admin' })).status).toBe(204);
    const second = await signedIn(t.app, a.emails.committee);
    expect((await second.patch(`/api/society/members/${String(a.membershipIds.admin)}`, { role: 'committee' })).status).toBe(204);
    // Now the only admin is the promoted member; demoting them must be refused.
    const original = await signedIn(t.app, a.emails.admin);
    expect((await original.patch(`/api/society/members/${String(a.membershipIds.committee)}`, { role: 'resident', unitId: String(a.units[2]) })).status).toBe(403);
    const self = await second.patch(`/api/society/members/${String(a.membershipIds.committee)}`, { role: 'committee' });
    expect(self.status).toBe(403);
    // restore
    await second.patch(`/api/society/members/${String(a.membershipIds.admin)}`, { role: 'admin' });
    await admin.patch(`/api/society/members/${String(a.membershipIds.committee)}`, { role: 'committee' });
  });
});
