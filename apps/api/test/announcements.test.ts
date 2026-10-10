import { beforeAll, describe, expect, it } from 'vitest';
import { seedSociety, signedIn, useTestApp, type SeededSociety } from './helpers.js';
import { Building, Membership, Notification, Unit, User } from '../src/models/index.js';

const t = useTestApp();
let s: SeededSociety;
let towerB: string;

beforeAll(async () => {
  s = await seedSociety('ann');
  const b = await Building.create({ societyId: s.societyId, name: 'Tower B', code: 'B', floors: 5 });
  towerB = String(b._id);
  const unit = await Unit.create({ societyId: s.societyId, buildingId: b._id, number: '101', label: 'B-101', floor: 1, status: 'occupied' });
  const template = await User.findOne({ email: s.emails.resident }).select('+passwordHash');
  const user = await User.create({ email: 'tower-b@example.test', name: 'Tower B resident', passwordHash: template!.passwordHash });
  await Membership.create({ userId: user._id, societyId: s.societyId, role: 'resident', unitId: unit._id });
});

const notice = (overrides: Record<string, unknown> = {}) => ({
  title: 'Water supply interruption',
  body: 'Water will be off from 10am to 2pm for tank cleaning.',
  priority: 'important',
  pinned: true,
  audience: { roles: [], buildingIds: [] },
  ...overrides,
});

describe('announcements', () => {
  it('drafts stay private until published; publishing notifies the audience', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const resident = await signedIn(t.app, s.emails.resident);
    const created = await admin.post('/api/announcements', notice());
    expect(created.status).toBe(201);
    expect((await resident.get(`/api/announcements/${created.body.id}`)).status).toBe(404);
    const pub = await admin.post(`/api/announcements/${created.body.id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.notified).toBeGreaterThanOrEqual(6);
    expect(await Notification.exists({ userId: s.userIds.guard, type: 'announcement.published' })).toBeTruthy();
    const list = await resident.get('/api/announcements');
    expect(list.body.items[0]).toMatchObject({ id: created.body.id, read: false, pinned: true });
    expect(list.body.items[0].readStats).toBeUndefined();
  });

  it('tracks reads per user and reports them to managers', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const resident = await signedIn(t.app, s.emails.resident);
    const id = (await resident.get('/api/announcements')).body.items[0].id;
    expect((await resident.post(`/api/announcements/${id}/read`)).status).toBe(204);
    expect((await resident.post(`/api/announcements/${id}/read`)).status).toBe(204); // idempotent
    expect((await resident.get(`/api/announcements/${id}`)).body.read).toBe(true);
    const managerView = (await admin.get('/api/announcements')).body.items.find((a: { id: string }) => a.id === id);
    expect(managerView.readStats.read).toBe(1);
    expect(managerView.readStats.audience).toBe(8);
  });

  it('targets roles and buildings', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const roleOnly = await admin.post('/api/announcements', notice({ title: 'Guard shift roster', audience: { roles: ['guard'], buildingIds: [] } }));
    await admin.post(`/api/announcements/${roleOnly.body.id}/publish`);
    const towerOnly = await admin.post('/api/announcements', notice({ title: 'Tower B lift service', audience: { roles: [], buildingIds: [towerB] } }));
    await admin.post(`/api/announcements/${towerOnly.body.id}/publish`);

    const resident = await signedIn(t.app, s.emails.resident);
    const titles = (await resident.get('/api/announcements')).body.items.map((a: { title: string }) => a.title);
    expect(titles).not.toContain('Guard shift roster');
    expect(titles).not.toContain('Tower B lift service');
    const guard = await signedIn(t.app, s.emails.guard);
    expect((await guard.get('/api/announcements')).body.items.map((a: { title: string }) => a.title)).toContain('Guard shift roster');
    const towerResident = await signedIn(t.app, 'tower-b@example.test');
    expect((await towerResident.get('/api/announcements')).body.items.map((a: { title: string }) => a.title)).toContain('Tower B lift service');
  });

  it('hides expired notices and protects published ones from deletion', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const a = await admin.post('/api/announcements', notice({ title: 'Diwali event', expiresAt: '2026-10-12T06:00:00.000Z' }));
    await admin.post(`/api/announcements/${a.body.id}/publish`);
    const resident = await signedIn(t.app, s.emails.resident);
    expect((await resident.get('/api/announcements')).body.items.map((x: { title: string }) => x.title)).toContain('Diwali event');
    t.clock.set('2026-10-12T07:00:00.000Z');
    expect((await resident.get('/api/announcements')).body.items.map((x: { title: string }) => x.title)).not.toContain('Diwali event');
    expect((await admin.delete(`/api/announcements/${a.body.id}`)).status).toBe(409);
    expect((await admin.post(`/api/announcements/${a.body.id}/archive`)).status).toBe(204);
    t.clock.set('2026-10-12T04:30:00.000Z');
    expect((await resident.post('/api/announcements', notice())).status).toBe(403);
  });
});

describe('notification centre', () => {
  it('lists, counts and marks notifications as read for the current user only', async () => {
    const guard = await signedIn(t.app, s.emails.guard);
    const unread = await guard.get('/api/notifications/unread-count');
    expect(unread.body.count).toBeGreaterThan(0);
    const list = await guard.get('/api/notifications?unread=1');
    const first = list.body.items[0];
    const resident = await signedIn(t.app, s.emails.resident);
    expect((await resident.post(`/api/notifications/${first.id}/read`)).status).toBe(404);
    expect((await guard.post(`/api/notifications/${first.id}/read`)).status).toBe(204);
    await guard.post('/api/notifications/read-all');
    expect((await guard.get('/api/notifications/unread-count')).body.count).toBe(0);
    const channels = await guard.get('/api/notifications/channels');
    expect(channels.body.find((c: { channel: string }) => c.channel === 'sms').state).toBe('not_configured');
  });
});
