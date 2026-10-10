import { beforeAll, describe, expect, it } from 'vitest';
import { seedSociety, signedIn, useTestApp, type SeededSociety } from './helpers.js';
import { Attachment, Notification } from '../src/models/index.js';

const t = useTestApp();
let s: SeededSociety;
beforeAll(async () => {
  s = await seedSociety('cmp');
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex');

const report = { title: 'Bathroom leak', description: 'Water seeping under the bathroom door', category: 'Plumbing', priority: 'high', area: 'unit' };

describe('complaint lifecycle', () => {
  it('resident submits → admin assigns → staff works and resolves with evidence → resident closes', async () => {
    const resident = await signedIn(t.app, s.emails.resident);
    const admin = await signedIn(t.app, s.emails.admin);
    const staff = await signedIn(t.app, s.emails.staff);

    const created = await resident.post('/api/complaints', report);
    expect(created.status).toBe(201);
    expect(created.body.number).toBe(1);
    expect(created.body.status).toBe('open');
    expect(created.body.unitLabel).toBe('A-101');
    expect(created.body.allowedTransitions).toEqual(['cancelled']);
    expect(await Notification.exists({ userId: s.userIds.admin, type: 'complaint.updated' })).toBeTruthy();

    // Staff cannot assign themselves.
    expect((await staff.post(`/api/complaints/${created.body.id}/assign`, { assigneeMembershipId: String(s.membershipIds.staff) })).status).toBe(403);
    const assigned = await admin.post(`/api/complaints/${created.body.id}/assign`, { assigneeMembershipId: String(s.membershipIds.staff), dueDate: '2026-10-14' });
    expect(assigned.status).toBe(200);
    expect(assigned.body.status).toBe('assigned');
    expect(assigned.body.assignee.name).toContain('staff');

    const queue = await staff.get('/api/complaints?assignee=me');
    expect(queue.body.items.map((c: { id: string }) => c.id)).toContain(created.body.id);

    expect((await staff.post(`/api/complaints/${created.body.id}/status`, { status: 'in_progress' })).body.status).toBe('in_progress');
    const internal = await staff.post(`/api/complaints/${created.body.id}/comments`, { body: 'Need a replacement valve', internal: true });
    expect(internal.status).toBe(201);

    const upload = await staff.agent
      .post(`/api/complaints/${created.body.id}/attachments`)
      .set('X-CSRF-Token', staff.csrf)
      .attach('files', PNG, { filename: 'after-fix.png', contentType: 'image/png' });
    expect(upload.status).toBe(201);
    expect(upload.body.attachments[0].purpose).toBe('completion');

    const noNote = await staff.post(`/api/complaints/${created.body.id}/status`, { status: 'resolved' });
    expect(noNote.status).toBe(400);
    const resolved = await staff.post(`/api/complaints/${created.body.id}/status`, { status: 'resolved', note: 'Replaced the valve and resealed' });
    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.resolvedAt).not.toBeNull();
    // Staff cannot close; that is for the reporter or a manager.
    expect((await staff.post(`/api/complaints/${created.body.id}/status`, { status: 'closed' })).status).toBe(409);

    const residentView = await resident.get(`/api/complaints/${created.body.id}`);
    expect(residentView.body.allowedTransitions.sort()).toEqual(['closed', 'in_progress']);
    // Internal notes are hidden from the resident.
    expect(residentView.body.events.some((e: { internal?: boolean }) => e.internal)).toBe(false);
    expect(residentView.body.events.map((e: { kind: string }) => e.kind)).toEqual(['created', 'assigned', 'status', 'attachment', 'status']);

    const closed = await resident.post(`/api/complaints/${created.body.id}/status`, { status: 'closed' });
    expect(closed.body.status).toBe('closed');
    expect((await resident.post(`/api/complaints/${created.body.id}/comments`, { body: 'thanks' })).status).toBe(409);
  });

  it('lets the reporter reopen a resolved complaint with a reason', async () => {
    const resident = await signedIn(t.app, s.emails.resident);
    const admin = await signedIn(t.app, s.emails.admin);
    const staff = await signedIn(t.app, s.emails.staff);
    const c = await resident.post('/api/complaints', { ...report, title: 'Kitchen sink blocked' });
    await admin.post(`/api/complaints/${c.body.id}/assign`, { assigneeMembershipId: String(s.membershipIds.staff) });
    await staff.post(`/api/complaints/${c.body.id}/status`, { status: 'in_progress' });
    await staff.post(`/api/complaints/${c.body.id}/status`, { status: 'resolved', note: 'Cleared' });
    expect((await resident.post(`/api/complaints/${c.body.id}/status`, { status: 'in_progress' })).status).toBe(400);
    const reopened = await resident.post(`/api/complaints/${c.body.id}/status`, { status: 'in_progress', note: 'Blocked again the next day' });
    expect(reopened.body.status).toBe('in_progress');
    expect(reopened.body.resolvedAt).toBeNull();
  });

  it('rejects categories outside the society list and illegal jumps', async () => {
    const resident = await signedIn(t.app, s.emails.resident);
    expect((await resident.post('/api/complaints', { ...report, category: 'Space lasers' })).status).toBe(400);
    const c = await resident.post('/api/complaints', report);
    expect((await resident.post(`/api/complaints/${c.body.id}/status`, { status: 'resolved', note: 'self-fixed' })).status).toBe(409);
    expect((await resident.post(`/api/complaints/${c.body.id}/comments`, { body: 'internal?', internal: true })).status).toBe(403);
  });
});

describe('attachments', () => {
  it('rejects files whose contents are not an allowed type, whatever their name says', async () => {
    const resident = await signedIn(t.app, s.emails.resident);
    const c = await resident.post('/api/complaints', report);
    const fake = await resident.agent
      .post(`/api/complaints/${c.body.id}/attachments`)
      .set('X-CSRF-Token', resident.csrf)
      .attach('files', Buffer.from('<script>alert(1)</script>'), { filename: 'photo.png', contentType: 'image/png' });
    expect(fake.status).toBe(415);
    expect(await Attachment.countDocuments({ ownerId: c.body.id })).toBe(0);
  });

  it('serves attachments only to people who can see the complaint, with safe headers', async () => {
    const resident = await signedIn(t.app, s.emails.resident);
    const c = await resident.post('/api/complaints', report);
    const up = await resident.agent
      .post(`/api/complaints/${c.body.id}/attachments`)
      .set('X-CSRF-Token', resident.csrf)
      .attach('files', PNG, { filename: '../../etc/passwd.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    const att = up.body.attachments[0];
    expect(att.fileName).not.toContain('/');
    expect(att.purpose).toBe('report');
    const ok = await resident.get(`/api/complaints/attachments/${att.id}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['content-disposition']).toMatch(/^attachment/);
    const neighbour = await signedIn(t.app, s.emails.resident2);
    expect((await neighbour.get(`/api/complaints/attachments/${att.id}`)).status).toBe(404);
    const guard = await signedIn(t.app, s.emails.guard);
    expect((await guard.get(`/api/complaints/attachments/${att.id}`)).status).toBe(404);
  });
});
