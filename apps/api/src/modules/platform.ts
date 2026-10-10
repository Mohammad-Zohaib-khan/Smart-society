import { Router } from 'express';
import { z } from 'zod';
import { createSocietySchema, isValidTimeZone, type SocietyOverview } from '@smart-society/shared';
import { Building, Membership, Society, Unit } from '../models/index.js';
import { requirePlatformAdmin } from '../lib/context.js';
import { badRequest, notFound } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { createInvite } from '../services/invites.js';

/** Platform administration: onboarding societies. Exposes counts only, never residents' data. */
export function platformRouter(): Router {
  const r = Router();

  r.get('/societies', async (req, res) => {
    requirePlatformAdmin(req);
    const societies = await Society.find({}).sort({ createdAt: -1 }).limit(200).lean();
    const ids = societies.map((s) => s._id);
    const [b, u, m] = await Promise.all([
      Building.aggregate<{ _id: unknown; n: number }>([{ $match: { societyId: { $in: ids } } }, { $group: { _id: '$societyId', n: { $sum: 1 } } }]),
      Unit.aggregate<{ _id: unknown; n: number }>([{ $match: { societyId: { $in: ids } } }, { $group: { _id: '$societyId', n: { $sum: 1 } } }]),
      Membership.aggregate<{ _id: unknown; n: number }>([{ $match: { societyId: { $in: ids }, status: 'active' } }, { $group: { _id: '$societyId', n: { $sum: 1 } } }]),
    ]);
    const count = (rows: { _id: unknown; n: number }[], id: unknown) => rows.find((r) => String(r._id) === String(id))?.n ?? 0;
    const out: SocietyOverview[] = societies.map((s) => ({
      id: String(s._id),
      name: s.name,
      city: s.city,
      timezone: s.timezone,
      status: s.status as 'active' | 'suspended',
      createdAt: s.createdAt.toISOString(),
      counts: { buildings: count(b, s._id), units: count(u, s._id), members: count(m, s._id) },
    }));
    res.json(out);
  });

  r.post('/societies', async (req, res) => {
    const ctx = requirePlatformAdmin(req);
    const input = parse(createSocietySchema, req.body);
    if (!isValidTimeZone(input.timezone)) throw badRequest('Unknown time zone', { timezone: 'Use an IANA zone such as Asia/Kolkata' });
    const society = await Society.create({
      name: input.name,
      city: input.city,
      address: input.address,
      timezone: input.timezone,
      createdBy: ctx.userId,
    });
    const invite = await createInvite({
      societyId: society._id,
      email: input.adminEmail,
      name: input.adminName,
      role: 'admin',
      unitId: null,
      createdBy: ctx.userId,
    });
    await audit({ userId: ctx.userId, societyId: society._id, ip: req.ip }, 'platform.society_created', { type: 'Society', id: society._id }, `Created society ${society.name}`);
    res.status(201).json({ societyId: String(society._id), invite });
  });

  r.patch('/societies/:id/status', async (req, res) => {
    const ctx = requirePlatformAdmin(req);
    const id = idParam(req.params.id, 'Society');
    const { status } = parse(z.strictObject({ status: z.enum(['active', 'suspended']) }), req.body);
    const society = await Society.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!society) throw notFound('Society');
    await audit({ userId: ctx.userId, societyId: society._id, ip: req.ip }, 'platform.society_status', { type: 'Society', id: society._id }, `Set ${society.name} to ${status}`, { status });
    res.status(204).end();
  });

  return r;
}
