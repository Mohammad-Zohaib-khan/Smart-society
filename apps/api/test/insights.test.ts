import { beforeAll, describe, expect, it } from 'vitest';
import { seedSociety, signedIn, useTestApp, type SeededSociety } from './helpers.js';
import { AuditLog, Complaint } from '../src/models/index.js';

const t = useTestApp();
let s: SeededSociety;
beforeAll(async () => {
  s = await seedSociety('ins');
  const resident = await signedIn(t.app, s.emails.resident);
  await resident.post('/api/complaints', { title: '=HYPERLINK("http://evil")', description: 'Formula injection attempt here', category: 'Other', priority: 'urgent', area: 'unit' });
  await resident.post('/api/visitors/invitations', { visitorName: 'Guest One', purpose: 'guest', guestCount: 1, validFrom: '2026-10-12T05:00:00.000Z', validUntil: '2026-10-12T09:00:00.000Z' });
});

describe('dashboards', () => {
  it('returns a role-specific dashboard', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const a = await admin.get('/api/dashboard');
    expect(a.body.role).toBe('admin');
    expect(a.body.admin.complaints.urgentOpen).toBe(1);
    expect(a.body.admin.visitors.expectedToday).toBe(1);
    expect(a.body.admin.recentActivity.length).toBeGreaterThan(0);
    const committee = await signedIn(t.app, s.emails.committee);
    const c = await committee.get('/api/dashboard');
    expect(c.body.admin.recentActivity).toEqual([]); // no audit access
    const resident = await signedIn(t.app, s.emails.resident);
    const r = await resident.get('/api/dashboard');
    expect(r.body.resident.unitLabel).toBe('A-101');
    expect(r.body.resident.upcomingInvitations).toHaveLength(1);
    expect(r.body.resident.openComplaints).toHaveLength(1);
    const staff = await signedIn(t.app, s.emails.staff);
    expect((await staff.get('/api/dashboard')).body.staff.assigned).toBe(0);
    const guard = await signedIn(t.app, s.emails.guard);
    expect((await guard.get('/api/dashboard')).body).toEqual({ role: 'guard' });
  });
});

describe('reports and exports', () => {
  it('summarises the period with a continuous daily series', async () => {
    const committee = await signedIn(t.app, s.emails.committee);
    const res = await committee.get('/api/reports/summary?from=2026-10-06&to=2026-10-12');
    expect(res.status).toBe(200);
    expect(res.body.visitorsPerDay).toHaveLength(7);
    expect(res.body.complaintsByCategory).toEqual([{ key: 'Other', count: 1 }]);
    expect((await committee.get('/api/reports/summary?from=2026-10-12&to=2026-10-01')).status).toBe(400);
  });

  it('exports CSV with formula injection neutralised and audits the export', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const res = await admin.get('/api/reports/export?kind=complaints&from=2026-10-01&to=2026-10-12');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(await AuditLog.exists({ societyId: s.societyId, action: 'reports.exported' })).toBeTruthy();
    const resident = await signedIn(t.app, s.emails.resident);
    expect((await resident.get('/api/reports/export?kind=complaints')).status).toBe(403);
  });

  it('lets admins search the audit log; nobody else can', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const res = await admin.get('/api/audit?action=complaints');
    expect(res.status).toBe(200);
    expect(res.body.items.every((a: { action: string }) => a.action.startsWith('complaints'))).toBe(true);
    const c = await Complaint.findOne({ societyId: s.societyId });
    expect(res.body.items[0].targetId).toBe(String(c!._id));
    const committee = await signedIn(t.app, s.emails.committee);
    expect((await committee.get('/api/audit')).status).toBe(403);
  });
});
