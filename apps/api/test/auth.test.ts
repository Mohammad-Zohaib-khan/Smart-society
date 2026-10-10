import { beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { Client, PASSWORD, seedSociety, signedIn, useTestApp, type SeededSociety } from './helpers.js';
import { Invite, Session, User } from '../src/models/index.js';
import { sha256 } from '../src/lib/crypto.js';

const t = useTestApp();
let s: SeededSociety;

beforeAll(async () => {
  s = await seedSociety('auth');
});

describe('sign in', () => {
  it('signs in, sets an httpOnly SameSite session cookie and returns role permissions', async () => {
    const c = await new Client(t.app).init();
    const res = await c.post('/api/auth/login', { email: s.emails.resident, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.membership.role).toBe('resident');
    expect(res.body.permissions).toContain('visitors.invite');
    expect(res.body.permissions).not.toContain('members.manage');
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const session = cookies.find((c) => c.startsWith('ss_session='));
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(cookies.find((c) => c.startsWith('ss_csrf='))).not.toMatch(/HttpOnly/i);
    // Only a hash of the session token is stored.
    const token = /ss_session=([^;]+)/.exec(session ?? '')?.[1] ?? '';
    expect(await Session.exists({ tokenHash: sha256(decodeURIComponent(token)) })).toBeTruthy();
    expect(await Session.exists({ tokenHash: decodeURIComponent(token) })).toBeFalsy();
  });

  it('rejects wrong passwords and unknown emails with the same message', async () => {
    const c = await new Client(t.app).init();
    const a = await c.post('/api/auth/login', { email: s.emails.guard, password: 'wrong-password-1' });
    const b = await c.post('/api/auth/login', { email: 'nobody@example.test', password: 'wrong-password-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('rejects NoSQL operator payloads instead of evaluating them', async () => {
    const c = await new Client(t.app).init();
    const res = await c.post('/api/auth/login', { email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });

  it('locks an account after repeated failures', async () => {
    const c = await new Client(t.app).init();
    for (let i = 0; i < 8; i++) await c.post('/api/auth/login', { email: s.emails.staff2, password: 'not-the-password-9' });
    const locked = await c.post('/api/auth/login', { email: s.emails.staff2, password: PASSWORD });
    expect(locked.status).toBe(423);
    t.clock.advance(16 * 60_000);
    const later = await c.post('/api/auth/login', { email: s.emails.staff2, password: PASSWORD });
    expect(later.status).toBe(200);
  });
});

describe('session protections', () => {
  it('requires authentication for protected endpoints', async () => {
    const res = await supertest(t.app).get('/api/dashboard');
    expect(res.status).toBe(401);
    const me = await supertest(t.app).get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  it('rejects state-changing requests without a matching CSRF token', async () => {
    const c = await signedIn(t.app, s.emails.resident);
    const missing = await c.agent.post('/api/complaints').send({});
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('csrf_failed');
    const wrong = await c.agent.post('/api/complaints').set('X-CSRF-Token', 'x'.repeat(32)).send({});
    expect(wrong.status).toBe(403);
  });

  it('logs out and invalidates the server-side session', async () => {
    const c = await signedIn(t.app, s.emails.committee);
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('expires idle sessions', async () => {
    const c = await signedIn(t.app, s.emails.admin);
    t.clock.advance(49 * 3_600_000);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('signs out other devices after a password change', async () => {
    const a = await signedIn(t.app, s.emails.resident2);
    const b = await signedIn(t.app, s.emails.resident2);
    const res = await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'brand-new-pass-77' });
    expect(res.status).toBe(204);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    await User.updateOne({ email: s.emails.resident2 }, { $set: { passwordHash: (await User.findOne({ email: s.emails.resident }).select('+passwordHash'))!.passwordHash } });
  });

  it('ignores mass-assignment attempts on profile updates', async () => {
    const c = await signedIn(t.app, s.emails.guard);
    const res = await c.patch('/api/auth/profile', { name: 'Guard Updated', isPlatformAdmin: true });
    expect(res.status).toBe(400);
    expect((await User.findOne({ email: s.emails.guard }))!.isPlatformAdmin).toBe(false);
  });
});

describe('invitations and password reset', () => {
  it('lets an admin invite a resident who then joins with their own password', async () => {
    const admin = await signedIn(t.app, s.emails.admin);
    const invite = await admin.post('/api/society/invites', { email: 'new.person@example.test', name: 'New Person', role: 'resident', unitId: String(s.units[2]) });
    expect(invite.status).toBe(201);
    expect(invite.body.emailDelivered).toBe(true);
    const mail = t.email.sent.find((m) => m.to === 'new.person@example.test');
    const token = /token=([\w-]+)/.exec(mail?.text ?? '')?.[1] ?? '';
    expect(token.length).toBeGreaterThan(20);

    const visitor = await new Client(t.app).init();
    const preview = await visitor.get(`/api/auth/invites/${token}`);
    expect(preview.body.role).toBe('resident');
    expect(preview.body.unitLabel).toBe('A-201');
    const accepted = await visitor.post('/api/auth/invites/accept', { token, name: 'New Person', password: 'new-person-pass-1' });
    expect(accepted.status).toBe(201);
    expect(accepted.body.membership.unitLabel).toBe('A-201');
    // Tokens are single use.
    const again = await (await new Client(t.app).init()).post('/api/auth/invites/accept', { token, name: 'X', password: 'new-person-pass-1' });
    expect(again.status).toBe(400);
    expect(await Invite.exists({ tokenHash: token })).toBeFalsy();
  });

  it('does not let a non-admin invite members', async () => {
    const committee = await signedIn(t.app, s.emails.committee);
    const res = await committee.post('/api/society/invites', { email: 'x@example.test', name: 'X Y', role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('resets a password with a single-use emailed token', async () => {
    const c = await new Client(t.app).init();
    const req = await c.post('/api/auth/password-reset/request', { email: s.emails.staff });
    expect(req.status).toBe(202);
    const unknown = await c.post('/api/auth/password-reset/request', { email: 'ghost@example.test' });
    expect(unknown.status).toBe(202);
    const mail = t.email.sent.find((m) => m.to === s.emails.staff && m.subject.includes('Reset'));
    const token = /token=([\w-]+)/.exec(mail?.text ?? '')?.[1] ?? '';
    expect((await c.post('/api/auth/password-reset/confirm', { token, password: 'reset-pass-123' })).status).toBe(204);
    expect((await c.post('/api/auth/password-reset/confirm', { token, password: 'reset-pass-456' })).status).toBe(400);
    await c.login(s.emails.staff, 'reset-pass-123');
  });
});
