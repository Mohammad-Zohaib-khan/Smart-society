import type { Request } from 'express';
import type { Types } from 'mongoose';
import { hasPermission, type Permission, type SocietyRole } from '@smart-society/shared';
import { forbidden, unauthorized } from './errors.js';
import type { SessionDoc, SocietyDoc } from '../models/index.js';

export interface AuthContext {
  userId: Types.ObjectId;
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  session: SessionDoc;
  membership: {
    id: Types.ObjectId;
    role: SocietyRole;
    societyId: Types.ObjectId;
    unitId: Types.ObjectId | null;
  } | null;
  society: SocietyDoc | null;
}

export interface SocietyContext extends AuthContext {
  membership: NonNullable<AuthContext['membership']>;
  society: SocietyDoc;
  societyId: Types.ObjectId;
  role: SocietyRole;
  ip: string | null;
}

export function requireAuth(req: Request): AuthContext {
  if (!req.ctx) throw unauthorized();
  return req.ctx;
}

export function requireSociety(req: Request): SocietyContext {
  const ctx = requireAuth(req);
  if (!ctx.membership || !ctx.society) throw forbidden('Select an active society membership first');
  return { ...ctx, membership: ctx.membership, society: ctx.society, societyId: ctx.society._id, role: ctx.membership.role, ip: req.ip ?? null };
}

/** Resolves the society context and asserts the role grants every listed permission. */
export function requirePermission(req: Request, ...permissions: Permission[]): SocietyContext {
  const ctx = requireSociety(req);
  for (const p of permissions) if (!hasPermission(ctx.role, p)) throw forbidden();
  return ctx;
}

/** Like requirePermission but passes when the role holds at least one of the permissions. */
export function requireAnyPermission(req: Request, ...permissions: Permission[]): SocietyContext {
  const ctx = requireSociety(req);
  if (!permissions.some((p) => hasPermission(ctx.role, p))) throw forbidden();
  return ctx;
}

export function can(ctx: SocietyContext, permission: Permission): boolean {
  return hasPermission(ctx.role, permission);
}

export function requirePlatformAdmin(req: Request): AuthContext {
  const ctx = requireAuth(req);
  if (!ctx.user.isPlatformAdmin) throw forbidden();
  return ctx;
}
