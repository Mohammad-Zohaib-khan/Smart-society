import { beforeAll, describe, expect, it } from 'vitest';
import { Client, seedSociety, signedIn, useTestApp, type SeededSociety } from './helpers.js';
import { Society, User } from '../src/models/index.js';

const t = useTestApp();
let s: SeededSociety;
beforeAll(async () => {
  s = await seedSociety('soc');
});

describe('society structure', () => {
  it('creates buildings and generates units in bulk, skipping existing numbers', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const b = await admin.post('/api/society/buildings', { name: 'Tower C', code: 'c', floors: 4 });
    expect(b.status).toBe(201);
    expect((await admin.post('/api/society/buildings', { name: 'Again', code: 'C', floors: 2 })).status).toBe(409);
    const one = await admin.post('/api/society/units', { buildingId: b.body.id, number: '101', floor: 1, status: 'vacant' });
    expect(one.status).toBe(201);
    const bulk = await admin.post('/api/society/units/bulk', { buildingId: b.body.id, fromFloor: 1, toFloor: 4, unitsPerFloor: 3 });
    expect(bulk.status).toBe(201);
    expect(bulk.body).toEqual({ created: 11, skipped: 1 });
    const list = await admin.get(`/api/society/units?buildingId=${b.body.id}&pageSize=50`);
    expect(list.body.total).toBe(12);
    expect(list.body.items[0].label).toBe('C-101');
    expect((await admin.post('/api/society/units', { buildingId: b.body.id, number: '901', floor: 9, status: 'vacant' })).status).toBe(400);
    expect((await admin.delete(`/api/society/buildings/${b.body.id}`)).status).toBe(409);
  });

  it('refuses to delete units with history or mark them vacant while residents live there', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    expect((await admin.delete(`/api/society/units/${String(s.units[0])}`)).status).toBe(409);
    expect((await admin.patch(`/api/society/units/${String(s.units[0])}`, { number: '101', floor: 1, status: 'vacant' })).status).toBe(409);
  });

  it('updates settings with validation and records it in the audit log', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const current = (await admin.get('/api/society/settings')).body;
    const bad = await admin.put('/api/society/settings', { ...stripIds(current), visitorPolicy: { ...current.visitorPolicy, visitorRetentionDays: 1 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields['visitorPolicy.visitorRetentionDays']).toBeTruthy();
    const ok = await admin.put('/api/society/settings', { ...stripIds(current), complaintCategories: ['Plumbing', 'Garden', 'Plumbing'] });
    expect(ok.status).toBe(200);
    expect(ok.body.complaintCategories).toEqual(['Plumbing', 'Garden']);
    const guard = await signedIn(t.app, s.emails.guard);
    expect((await guard.put('/api/society/settings', stripIds(current))).status).toBe(403);
    const audit = await admin.get('/api/audit?action=society.settings');
    expect(audit.body.total).toBe(1);
  });

  it('lets residents manage only their own household list', async () => {
    const r1 = await signedIn(t.app, s.emails.resident);
    const r2 = await signedIn(t.app, s.emails.resident2);
    const h = await r1.post('/api/society/household', { name: 'Meera', relation: 'child', isMinor: true });
    expect(h.status).toBe(201);
    expect((await r1.get('/api/society/household')).body).toHaveLength(1);
    expect((await r2.get('/api/society/household')).body).toHaveLength(0);
    expect((await r2.delete(`/api/society/household/${h.body.id}`)).status).toBe(404);
    expect((await r1.delete(`/api/society/household/${h.body.id}`)).status).toBe(204);
  });
});

describe('platform administration', () => {
  it('onboards a society and its first admin without exposing residents', async () => {
    await User.updateOne({ email: s.emails.committee }, { $set: { isPlatformAdmin: true } });
    const platform = await signedIn(t.app, s.emails.committee);
    const created = await platform.post('/api/platform/societies', { name: 'Green Meadows', city: 'Raipur', address: 'Ring Road 2, Raipur', timezone: 'Asia/Kolkata', adminName: 'Rohit Sen', adminEmail: 'rohit@example.test' });
    expect(created.status).toBe(201);
    expect(created.body.invite.emailDelivered).toBe(true);
    const list = await platform.get('/api/platform/societies');
    expect(list.body.find((x: { name: string }) => x.name === 'Green Meadows').counts).toEqual({ buildings: 0, units: 0, members: 0 });
    expect(JSON.stringify(list.body)).not.toContain('@example.test');
    expect((await platform.post('/api/platform/societies', { name: 'Bad TZ', city: 'X', address: 'Somewhere 1', timezone: 'Mars/Olympus', adminName: 'A B', adminEmail: 'a@b.test' })).status).toBe(400);
    const admin = await signedIn(t.app, s.emails.admin);
    expect((await admin.get('/api/platform/societies')).status).toBe(403);
  });

  it('suspending a society removes access for its members', async () => {
    const platform = await signedIn(t.app, s.emails.committee);
    const guard = await signedIn(t.app, s.emails.guard);
    const res = await platform.patch(`/api/platform/societies/${String(s.societyId)}/status`, { status: 'suspended' });
    expect(res.status).toBe(204);
    expect((await guard.get('/api/visitors/gate/board')).status).toBe(403);
    await Society.updateOne({ _id: s.societyId }, { $set: { status: 'active' } });
  });

  it('switches between memberships only to ones the user holds', async () => {
    const c = await new Client(t.app).init();
    const me = await c.login(s.emails.resident);
    const res = await c.post('/api/auth/switch-society', { membershipId: String(s.membershipIds.admin) });
    expect(res.status).toBe(404);
    expect(me.memberships).toHaveLength(1);
  });
});

function stripIds(settings: Record<string, unknown>) {
  const { id: _id, city: _city, timezone: _tz, ...rest } = settings;
  return rest;
}
