import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { safeEqual } from '../lib/crypto.js';
import { cookieNames } from './session.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection layered on SameSite=Lax cookies and a narrow CORS policy.
 * Unsafe requests must echo the CSRF cookie in `X-CSRF-Token`; for signed-in requests the value
 * must also match the token bound to the server-side session.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE.has(req.method)) return next();
  const header = req.get('x-csrf-token');
  const cookie: unknown = req.cookies?.[cookieNames().csrf];
  const fail = () => next(new AppError(403, 'csrf_failed', 'Your session security token is missing or stale. Refresh and try again.'));
  if (!header || typeof cookie !== 'string' || !safeEqual(header, cookie)) return fail();
  if (req.ctx && !safeEqual(header, req.ctx.session.csrfToken)) return fail();
  next();
}
