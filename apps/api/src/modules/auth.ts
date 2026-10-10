import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import {
  ROLE_LABELS,
  acceptInviteSchema,
  changePasswordSchema,
  loginSchema,
  notificationPrefsSchema,
  permissionsFor,
  requestPasswordResetSchema,
  resetPasswordSchema,
  switchSocietySchema,
  updateProfileSchema,
  type MembershipSummary,
  type SessionInfo,
  type SocietyRole,
} from '@smart-society/shared';
import { Invite, Membership, PasswordReset, Session, Society, Unit, User, type UserDoc } from '../models/index.js';
import { getDummyHash, hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { AppError, badRequest, conflict, notFound, unauthorized, unavailable } from '../lib/errors.js';
import { requireAuth } from '../lib/context.js';
import { oid, parse } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { runtime } from '../services/runtime.js';
import { clearSessionCookies, cookieNames, createSession, setAnonymousCsrfCookie, setSessionCookies } from '../middleware/session.js';
import type { createLimiters } from '../middleware/rate-limit.js';

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;
const RESET_TTL_MINUTES = 30;

export async function membershipSummaries(userId: Types.ObjectId): Promise<MembershipSummary[]> {
  const memberships = await Membership.find({ userId, status: 'active' }).sort({ createdAt: 1 }).lean();
  const societies = await Society.find({ _id: { $in: memberships.map((m) => m.societyId) }, status: 'active' }, { name: 1 }).lean();
  const units = await Unit.find({ _id: { $in: memberships.map((m) => m.unitId).filter(Boolean) } }, { label: 1 }).lean();
  const sMap = new Map(societies.map((s) => [String(s._id), s.name]));
  const uMap = new Map(units.map((u) => [String(u._id), u.label]));
  return memberships
    .filter((m) => sMap.has(String(m.societyId)))
    .map((m) => ({
      id: String(m._id),
      role: m.role as SocietyRole,
      societyId: String(m.societyId),
      societyName: sMap.get(String(m.societyId)) ?? '',
      unitId: m.unitId ? String(m.unitId) : null,
      unitLabel: m.unitId ? (uMap.get(String(m.unitId)) ?? null) : null,
    }));
}

async function sessionInfo(user: UserDoc, activeMembershipId: Types.ObjectId | null): Promise<SessionInfo> {
  const memberships = await membershipSummaries(user._id);
  const active = memberships.find((m) => m.id === String(activeMembershipId)) ?? null;
  const society = active ? await Society.findById(active.societyId, { timezone: 1 }).lean() : null;
  return {
    user: { id: String(user._id), name: user.name, email: user.email, phone: user.phone ?? null, isPlatformAdmin: user.isPlatformAdmin },
    membership: active && society ? { ...active, timezone: society.timezone } : null,
    memberships,
    permissions: active ? [...permissionsFor(active.role)] : [],
    notificationPrefs: {
      emailEnabled: user.notificationPrefs?.emailEnabled ?? false,
      mutedTypes: user.notificationPrefs?.mutedTypes ?? [],
    },
  };
}

async function sendSessionInfo(req: Request, res: Response): Promise<void> {
  const ctx = requireAuth(req);
  const user = await User.findById(ctx.userId);
  if (!user) throw unauthorized();
  res.json(await sessionInfo(user, ctx.membership?.id ?? null));
}

async function firstActiveMembership(userId: Types.ObjectId): Promise<Types.ObjectId | null> {
  const summaries = await membershipSummaries(userId);
  return summaries[0] ? oid(summaries[0].id) : null;
}

export function authRouter(limiters: ReturnType<typeof createLimiters>): Router {
  const r = Router();

  r.get('/csrf', (req, res) => {
    if (req.ctx) {
      res.json({ csrfToken: req.ctx.session.csrfToken });
      return;
    }
    const existing: unknown = req.cookies?.[cookieNames().csrf];
    const token = typeof existing === 'string' && existing.length >= 20 && existing.length <= 64 ? existing : randomToken(24);
    setAnonymousCsrfCookie(res, token);
    res.json({ csrfToken: token });
  });

  r.post('/login', limiters.auth, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const { now } = runtime();
    const user = await User.findOne({ email }).select('+passwordHash');
    const invalid = new AppError(401, 'invalid_credentials', 'Email or password is incorrect');
    if (!user) {
      await verifyPassword(password, await getDummyHash());
      throw invalid;
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > now().getTime()) {
      throw new AppError(423, 'locked', `Too many failed attempts. Try again after ${LOCK_MINUTES} minutes.`);
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok || user.status !== 'active') {
      if (!ok) {
        const failed = (user.failedLoginCount ?? 0) + 1;
        user.failedLoginCount = failed >= MAX_FAILED_LOGINS ? 0 : failed;
        if (failed >= MAX_FAILED_LOGINS) user.lockedUntil = new Date(now().getTime() + LOCK_MINUTES * 60_000);
        await user.save();
      }
      throw invalid;
    }
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.lastLoginAt = now();
    await user.save();

    // Rotate: any session cookie presented with the login is discarded (prevents fixation).
    if (req.ctx) await req.ctx.session.deleteOne();
    const activeMembershipId = await firstActiveMembership(user._id);
    const s = await createSession(user._id, activeMembershipId, req.get('user-agent'));
    setSessionCookies(res, s.token, s.csrfToken, s.expiresAt);
    res.json(await sessionInfo(user, activeMembershipId));
  });

  r.post('/logout', async (req, res) => {
    if (req.ctx) await req.ctx.session.deleteOne();
    clearSessionCookies(res);
    res.status(204).end();
  });

  r.get('/me', sendSessionInfo);

  r.post('/switch-society', async (req, res) => {
    const ctx = requireAuth(req);
    const { membershipId } = parse(switchSocietySchema, req.body);
    const valid = (await membershipSummaries(ctx.userId)).some((m) => m.id === membershipId);
    if (!valid) throw notFound('Membership');
    ctx.session.activeMembershipId = oid(membershipId);
    await ctx.session.save();
    const user = await User.findById(ctx.userId);
    if (!user) throw unauthorized();
    res.json(await sessionInfo(user, ctx.session.activeMembershipId));
  });

  r.patch('/profile', async (req, res) => {
    const ctx = requireAuth(req);
    const input = parse(updateProfileSchema, req.body);
    await User.updateOne({ _id: ctx.userId }, { $set: { name: input.name, phone: input.phone ?? null } });
    await sendSessionInfo(req, res);
  });

  r.put('/notification-prefs', async (req, res) => {
    const ctx = requireAuth(req);
    const input = parse(notificationPrefsSchema, req.body);
    await User.updateOne({ _id: ctx.userId }, { $set: { notificationPrefs: input } });
    await sendSessionInfo(req, res);
  });

  r.post('/change-password', limiters.auth, async (req, res) => {
    const ctx = requireAuth(req);
    const input = parse(changePasswordSchema, req.body);
    const user = await User.findById(ctx.userId).select('+passwordHash');
    if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect', { currentPassword: 'Current password is incorrect' });
    }
    user.passwordHash = await hashPassword(input.newPassword);
    await user.save();
    // Sign out every other device.
    await Session.deleteMany({ userId: user._id, _id: { $ne: ctx.session._id } });
    await audit({ userId: user._id, societyId: ctx.society?._id ?? null, ip: req.ip }, 'auth.password_changed', { type: 'User', id: user._id }, 'Changed own password');
    res.status(204).end();
  });

  r.post('/password-reset/request', limiters.passwordReset, async (req, res) => {
    const { email } = parse(requestPasswordResetSchema, req.body);
    const { email: provider, env, now } = runtime();
    if (provider.kind === 'none') {
      throw unavailable('Password reset by email is not configured for this deployment. Ask your society admin to re-invite you.');
    }
    const user = await User.findOne({ email, status: 'active' });
    if (user) {
      const token = randomToken(32);
      await PasswordReset.create({ userId: user._id, tokenHash: sha256(token), expiresAt: new Date(now().getTime() + RESET_TTL_MINUTES * 60_000) });
      await provider.send({
        to: user.email,
        subject: 'Reset your Smart Society password',
        text: `Use this link within ${RESET_TTL_MINUTES} minutes to choose a new password:\n${env.APP_URL}/reset-password?token=${token}\n\nIf you did not ask for this, ignore this email.`,
      });
    }
    // Same response whether or not the account exists.
    res.status(202).json({ ok: true });
  });

  r.post('/password-reset/confirm', limiters.passwordReset, async (req, res) => {
    const input = parse(resetPasswordSchema, req.body);
    const { now } = runtime();
    const reset = await PasswordReset.findOneAndUpdate(
      { tokenHash: sha256(input.token), usedAt: null, expiresAt: { $gt: now() } },
      { $set: { usedAt: now() } },
      { new: true },
    );
    if (!reset) throw badRequest('This reset link is invalid or has expired');
    const passwordHash = await hashPassword(input.password);
    await User.updateOne({ _id: reset.userId }, { $set: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
    await Session.deleteMany({ userId: reset.userId });
    await audit({ userId: reset.userId, societyId: null, ip: req.ip }, 'auth.password_reset', { type: 'User', id: reset.userId }, 'Reset password via email link');
    res.status(204).end();
  });

  r.get('/invites/:token', limiters.auth, async (req, res) => {
    const invite = await Invite.findOne({
      tokenHash: sha256(String(req.params.token)),
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { $gt: runtime().now() },
    }).lean();
    if (!invite) throw notFound('Invitation');
    const society = await Society.findById(invite.societyId, { name: 1 }).lean();
    const unit = invite.unitId ? await Unit.findById(invite.unitId, { label: 1 }).lean() : null;
    const existing = await User.exists({ email: invite.email });
    res.json({
      email: invite.email,
      name: invite.name,
      role: invite.role,
      roleLabel: ROLE_LABELS[invite.role as SocietyRole],
      societyName: society?.name ?? '',
      unitLabel: unit?.label ?? null,
      existingAccount: Boolean(existing),
      expiresAt: invite.expiresAt.toISOString(),
    });
  });

  r.post('/invites/accept', limiters.auth, async (req, res) => {
    const input = parse(acceptInviteSchema, req.body);
    const { now } = runtime();
    const invite = await Invite.findOneAndUpdate(
      { tokenHash: sha256(input.token), acceptedAt: null, revokedAt: null, expiresAt: { $gt: now() } },
      { $set: { acceptedAt: now() } },
      { new: true },
    );
    if (!invite) throw badRequest('This invitation is invalid, expired or already used');
    const rollback = () => Invite.updateOne({ _id: invite._id }, { $set: { acceptedAt: null } });

    let user = await User.findOne({ email: invite.email }).select('+passwordHash');
    if (user) {
      // Joining another society with an existing account requires proving account ownership.
      if (!(await verifyPassword(input.password, user.passwordHash))) {
        await rollback();
        throw badRequest('This email already has an account. Enter its current password to join.', { password: 'Incorrect password for the existing account' });
      }
    } else {
      user = await User.create({ email: invite.email, name: input.name, passwordHash: await hashPassword(input.password) });
    }
    if (await Membership.exists({ userId: user._id, societyId: invite.societyId })) {
      await rollback();
      throw conflict('You are already a member of this society');
    }
    const membership = await Membership.create({
      userId: user._id,
      societyId: invite.societyId,
      role: invite.role,
      unitId: invite.unitId,
      invitedBy: invite.createdBy,
    });
    if (invite.unitId) await Unit.updateOne({ _id: invite.unitId }, { $set: { status: 'occupied' } });
    await audit(
      { userId: user._id, societyId: invite.societyId, ip: req.ip },
      'membership.joined',
      { type: 'Membership', id: membership._id },
      `${user.name} joined as ${ROLE_LABELS[invite.role as SocietyRole]}`,
      { role: invite.role },
    );

    if (req.ctx) await req.ctx.session.deleteOne();
    const s = await createSession(user._id, membership._id, req.get('user-agent'));
    setSessionCookies(res, s.token, s.csrfToken, s.expiresAt);
    res.status(201).json(await sessionInfo(user, membership._id));
  });

  return r;
}
