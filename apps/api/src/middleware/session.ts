import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { Membership, Session, Society, User, type SessionDoc } from '../models/index.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { runtime } from '../services/runtime.js';
import type { SocietyRole } from '@smart-society/shared';

const TOUCH_INTERVAL_MS = 5 * 60_000;

export function cookieNames() {
  // The __Host- prefix makes browsers refuse the cookie unless it is Secure, host-only and path=/.
  const secure = runtime().env.COOKIE_SECURE;
  return { session: secure ? '__Host-ss_session' : 'ss_session', csrf: secure ? '__Host-ss_csrf' : 'ss_csrf' };
}

function baseCookie(): CookieOptions {
  return { secure: runtime().env.COOKIE_SECURE, sameSite: 'lax', path: '/' };
}

export function setSessionCookies(res: Response, sessionToken: string, csrfToken: string, expiresAt: Date): void {
  const names = cookieNames();
  res.cookie(names.session, sessionToken, { ...baseCookie(), httpOnly: true, expires: expiresAt });
  // Readable by the web app so it can echo it in the X-CSRF-Token header (double submit).
  res.cookie(names.csrf, csrfToken, { ...baseCookie(), httpOnly: false, expires: expiresAt });
}

export function setAnonymousCsrfCookie(res: Response, token: string): void {
  res.cookie(cookieNames().csrf, token, { ...baseCookie(), httpOnly: false });
}

export function clearSessionCookies(res: Response): void {
  const names = cookieNames();
  res.clearCookie(names.session, baseCookie());
  res.clearCookie(names.csrf, baseCookie());
}

export async function createSession(userId: SessionDoc['userId'], activeMembershipId: SessionDoc['activeMembershipId'], userAgent: string | undefined) {
  const { env, now } = runtime();
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const at = now();
  const expiresAt = new Date(at.getTime() + env.SESSION_TTL_HOURS * 3_600_000);
  await Session.create({
    tokenHash: sha256(token),
    csrfToken,
    userId,
    activeMembershipId,
    expiresAt,
    lastSeenAt: at,
    userAgent: userAgent?.slice(0, 200) ?? null,
  });
  return { token, csrfToken, expiresAt };
}

/** Resolves the session cookie into `req.ctx`. Never throws for anonymous requests. */
export async function loadSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw: unknown = req.cookies?.[cookieNames().session];
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 100) return next();
  const { env, now } = runtime();
  const at = now();
  const session = await Session.findOne({ tokenHash: sha256(raw), expiresAt: { $gt: at } });
  if (!session || at.getTime() - session.lastSeenAt.getTime() > env.SESSION_IDLE_HOURS * 3_600_000) {
    if (session) await session.deleteOne();
    clearSessionCookies(res);
    return next();
  }
  const user = await User.findById(session.userId);
  if (!user || user.status !== 'active') {
    await session.deleteOne();
    clearSessionCookies(res);
    return next();
  }

  let membership = session.activeMembershipId
    ? await Membership.findOne({ _id: session.activeMembershipId, userId: user._id, status: 'active' })
    : null;
  let society = membership ? await Society.findOne({ _id: membership.societyId, status: 'active' }) : null;
  if (!membership || !society) {
    // Fall back to any other active membership (e.g. after a role was suspended).
    membership = null;
    society = null;
    const candidates = await Membership.find({ userId: user._id, status: 'active' }).sort({ createdAt: 1 });
    for (const m of candidates) {
      const s = await Society.findOne({ _id: m.societyId, status: 'active' });
      if (s) {
        membership = m;
        society = s;
        break;
      }
    }
    const nextId = membership?._id ?? null;
    if (String(nextId) !== String(session.activeMembershipId)) {
      session.activeMembershipId = nextId;
      await session.save();
    }
  }

  if (at.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    session.lastSeenAt = at;
    await session.save();
  }

  req.ctx = {
    userId: user._id,
    user: { id: String(user._id), name: user.name, email: user.email, isPlatformAdmin: user.isPlatformAdmin },
    session,
    membership: membership
      ? { id: membership._id, role: membership.role as SocietyRole, societyId: membership.societyId, unitId: membership.unitId ?? null }
      : null,
    society,
  };
  next();
}
