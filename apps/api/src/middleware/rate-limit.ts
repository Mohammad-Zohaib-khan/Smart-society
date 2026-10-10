import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { runtime } from '../services/runtime.js';

function limiter(windowMs: number, limit: number, message: string): RequestHandler {
  const handler = rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited', message } });
    },
  });
  return (req, res, next) => (runtime().env.RATE_LIMIT_DISABLED ? next() : handler(req, res, next));
}

export const createLimiters = () => ({
  general: limiter(15 * 60_000, 1500, 'Too many requests. Please slow down.'),
  auth: limiter(15 * 60_000, 20, 'Too many sign-in attempts. Try again in 15 minutes.'),
  passwordReset: limiter(60 * 60_000, 6, 'Too many reset requests. Try again later.'),
  gateLookup: limiter(60_000, 90, 'Too many lookups. Wait a moment and try again.'),
  upload: limiter(15 * 60_000, 60, 'Too many uploads. Try again later.'),
});
