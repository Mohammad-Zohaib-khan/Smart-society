import { Router } from 'express';
import type { Types } from 'mongoose';
import {
  ANNOUNCEMENT_STATUSES,
  announcementSchema,
  type AnnouncementDto,
  type AnnouncementPriority,
  type AnnouncementStatus,
  type Paginated,
  type SocietyRole,
} from '@smart-society/shared';
import { Announcement, AnnouncementRead, Building, Membership, Unit } from '../models/index.js';
import { can, requirePermission, type SocietyContext } from '../lib/context.js';
import { conflict, notFound } from '../lib/errors.js';
import { idParam, oid, parse, queryEnum } from '../lib/validate.js';
import { pageParams } from '../lib/pagination.js';
import { iso, summary, userNames } from '../lib/dto.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notifications.js';
import { runtime } from '../services/runtime.js';

type AnnouncementLean = {
  _id: Types.ObjectId;
  title: string;
  body: string;
  priority: string;
  pinned: boolean;
  status: string;
  audience: { roles: string[]; buildingIds: Types.ObjectId[] };
  publishedAt?: Date | null;
  expiresAt?: Date | null;
  authorId: Types.ObjectId;
  createdAt: Date;
};

const actor = (ctx: SocietyContext) => ({ userId: ctx.userId, societyId: ctx.societyId, ip: ctx.ip });

/**
 * Audience rule: role list empty = everyone; building list applies to residents only
 * (guards and staff are not tied to a building).
 */
function matchesAudience(a: AnnouncementLean, role: SocietyRole, buildingId: Types.ObjectId | null): boolean {
  const roles = a.audience?.roles ?? [];
  const buildings = (a.audience?.buildingIds ?? []).map(String);
  if (roles.length && !roles.includes(role)) return false;
  if (buildings.length && role === 'resident') return buildingId !== null && buildings.includes(String(buildingId));
  return true;
}

async function callerBuilding(ctx: SocietyContext): Promise<Types.ObjectId | null> {
  if (!ctx.membership.unitId) return null;
  const unit = await Unit.findById(ctx.membership.unitId, { buildingId: 1 }).lean();
  return unit?.buildingId ?? null;
}

/** All active member user ids that the announcement targets. */
async function audienceUserIds(societyId: Types.ObjectId, a: AnnouncementLean): Promise<Types.ObjectId[]> {
  const members = await Membership.find({ societyId, status: 'active' }, { userId: 1, role: 1, unitId: 1 }).lean();
  const units = await Unit.find({ societyId, _id: { $in: members.map((m) => m.unitId).filter(Boolean) } }, { buildingId: 1 }).lean();
  const unitBuilding = new Map(units.map((u) => [String(u._id), u.buildingId]));
  return members
    .filter((m) => matchesAudience(a, m.role as SocietyRole, m.unitId ? (unitBuilding.get(String(m.unitId)) ?? null) : null))
    .map((m) => m.userId);
}

async function toDtos(ctx: SocietyContext, rows: AnnouncementLean[]): Promise<AnnouncementDto[]> {
  const names = await userNames(rows.map((a) => a.authorId));
  const reads = await AnnouncementRead.find({ userId: ctx.userId, announcementId: { $in: rows.map((a) => a._id) } }, { announcementId: 1 }).lean();
  const readSet = new Set(reads.map((r) => String(r.announcementId)));
  const manager = can(ctx, 'announcements.manage');
  const stats = new Map<string, { read: number; audience: number }>();
  if (manager) {
    const counts = await AnnouncementRead.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { announcementId: { $in: rows.map((a) => a._id) } } },
      { $group: { _id: '$announcementId', n: { $sum: 1 } } },
    ]);
    for (const a of rows) {
      if (a.status === 'draft') continue;
      const audienceSize = (await audienceUserIds(ctx.societyId, a)).length;
      stats.set(String(a._id), { read: counts.find((c) => String(c._id) === String(a._id))?.n ?? 0, audience: audienceSize });
    }
  }
  return rows.map((a) => ({
    id: String(a._id),
    title: a.title,
    body: a.body,
    priority: a.priority as AnnouncementPriority,
    pinned: a.pinned,
    status: a.status as AnnouncementStatus,
    audience: { roles: (a.audience?.roles ?? []) as SocietyRole[], buildingIds: (a.audience?.buildingIds ?? []).map(String) },
    publishedAt: iso(a.publishedAt),
    expiresAt: iso(a.expiresAt),
    author: summary(names, a.authorId) ?? { id: '', name: 'Unknown' },
    createdAt: a.createdAt.toISOString(),
    read: readSet.has(String(a._id)),
    ...(stats.has(String(a._id)) ? { readStats: stats.get(String(a._id)) } : {}),
  }));
}

/** Loads one announcement the caller may see (published + in audience, or manager). */
async function loadVisible(ctx: SocietyContext, id: Types.ObjectId): Promise<AnnouncementLean> {
  const a = await Announcement.findOne({ _id: id, societyId: ctx.societyId }).lean<AnnouncementLean>();
  if (!a) throw notFound('Announcement');
  if (can(ctx, 'announcements.manage')) return a;
  const now = runtime().now();
  const live = a.status === 'published' && (!a.expiresAt || a.expiresAt.getTime() > now.getTime());
  if (!live || !matchesAudience(a, ctx.role, await callerBuilding(ctx))) throw notFound('Announcement');
  return a;
}

async function validateBuildings(societyId: Types.ObjectId, ids: string[]): Promise<Types.ObjectId[]> {
  const unique = [...new Set(ids)].map(oid);
  if (unique.length && (await Building.countDocuments({ societyId, _id: { $in: unique } })) !== unique.length) throw notFound('Building');
  return unique;
}

export function announcementsRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const ctx = requirePermission(req, 'announcements.view');
    const { page, pageSize } = pageParams(req.query);
    const now = runtime().now();
    if (can(ctx, 'announcements.manage')) {
      const filter: Record<string, unknown> = { societyId: ctx.societyId };
      const status = queryEnum(req.query.status, ANNOUNCEMENT_STATUSES);
      if (status) filter.status = status;
      const [rows, total] = await Promise.all([
        Announcement.find(filter).sort({ pinned: -1, publishedAt: -1, createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean<AnnouncementLean[]>(),
        Announcement.countDocuments(filter),
      ]);
      res.json({ items: await toDtos(ctx, rows), page, pageSize, total } satisfies Paginated<AnnouncementDto>);
      return;
    }
    // Audience matching needs the caller's building, so filter in memory over live notices.
    const building = await callerBuilding(ctx);
    const live = await Announcement.find({
      societyId: ctx.societyId,
      status: 'published',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
      .sort({ pinned: -1, publishedAt: -1 })
      .limit(500)
      .lean<AnnouncementLean[]>();
    const visible = live.filter((a) => matchesAudience(a, ctx.role, building));
    const items = visible.slice((page - 1) * pageSize, page * pageSize);
    res.json({ items: await toDtos(ctx, items), page, pageSize, total: visible.length } satisfies Paginated<AnnouncementDto>);
  });

  r.get('/:id', async (req, res) => {
    const ctx = requirePermission(req, 'announcements.view');
    const a = await loadVisible(ctx, idParam(req.params.id, 'Announcement'));
    const [dto] = await toDtos(ctx, [a]);
    res.json(dto);
  });

  r.post('/:id/read', async (req, res) => {
    const ctx = requirePermission(req, 'announcements.view');
    const a = await loadVisible(ctx, idParam(req.params.id, 'Announcement'));
    if (a.status !== 'published') throw conflict('Only published announcements can be marked read');
    await AnnouncementRead.updateOne(
      { announcementId: a._id, userId: ctx.userId },
      { $setOnInsert: { societyId: ctx.societyId, readAt: runtime().now() } },
      { upsert: true },
    );
    res.status(204).end();
  });

  r.post('/', async (req, res) => {
    const ctx = requirePermission(req, 'announcements.manage');
    const input = parse(announcementSchema, req.body);
    const buildingIds = await validateBuildings(ctx.societyId, input.audience.buildingIds);
    const a = await Announcement.create({
      ...input,
      audience: { roles: input.audience.roles, buildingIds },
      expiresAt: input.expiresAt ?? null,
      societyId: ctx.societyId,
      authorId: ctx.userId,
    });
    await audit(actor(ctx), 'announcements.created', { type: 'Announcement', id: a._id }, `Drafted "${a.title}"`);
    res.status(201).json({ id: String(a._id) });
  });

  r.patch('/:id', async (req, res) => {
    const ctx = requirePermission(req, 'announcements.manage');
    const id = idParam(req.params.id, 'Announcement');
    const input = parse(announcementSchema, req.body);
    const buildingIds = await validateBuildings(ctx.societyId, input.audience.buildingIds);
    const a = await Announcement.findOneAndUpdate(
      { _id: id, societyId: ctx.societyId, status: { $ne: 'archived' } },
      { $set: { ...input, audience: { roles: input.audience.roles, buildingIds }, expiresAt: input.expiresAt ?? null, updatedBy: ctx.userId } },
      { new: true },
    );
    if (!a) throw notFound('Announcement');
    await audit(actor(ctx), 'announcements.updated', { type: 'Announcement', id }, `Edited "${a.title}"`);
    res.status(204).end();
  });

  r.post('/:id/publish', async (req, res) => {
    const ctx = requirePermission(req, 'announcements.manage');
    const id = idParam(req.params.id, 'Announcement');
    const now = runtime().now();
    const a = await Announcement.findOneAndUpdate(
      { _id: id, societyId: ctx.societyId, status: 'draft' },
      { $set: { status: 'published', publishedAt: now } },
      { new: true },
    ).lean<AnnouncementLean>();
    if (!a) {
      if (!(await Announcement.exists({ _id: id, societyId: ctx.societyId }))) throw notFound('Announcement');
      throw conflict('Only drafts can be published');
    }
    const recipients = await audienceUserIds(ctx.societyId, a);
    const delivered = await notify(ctx.societyId, recipients, {
      type: 'announcement.published',
      title: `${a.priority === 'urgent' ? 'Urgent: ' : ''}${a.title}`,
      body: a.body.slice(0, 160),
      link: `/app/announcements/${String(a._id)}`,
    }, { exclude: ctx.userId });
    await audit(actor(ctx), 'announcements.published', { type: 'Announcement', id }, `Published "${a.title}"`, { recipients: delivered });
    res.json({ notified: delivered });
  });

  r.post('/:id/archive', async (req, res) => {
    const ctx = requirePermission(req, 'announcements.manage');
    const id = idParam(req.params.id, 'Announcement');
    const a = await Announcement.findOneAndUpdate({ _id: id, societyId: ctx.societyId, status: 'published' }, { $set: { status: 'archived', pinned: false } });
    if (!a) {
      if (!(await Announcement.exists({ _id: id, societyId: ctx.societyId }))) throw notFound('Announcement');
      throw conflict('Only published announcements can be archived');
    }
    await audit(actor(ctx), 'announcements.archived', { type: 'Announcement', id }, `Archived "${a.title}"`);
    res.status(204).end();
  });

  r.delete('/:id', async (req, res) => {
    const ctx = requirePermission(req, 'announcements.manage');
    const id = idParam(req.params.id, 'Announcement');
    const a = await Announcement.findOneAndDelete({ _id: id, societyId: ctx.societyId, status: 'draft' });
    if (!a) {
      if (!(await Announcement.exists({ _id: id, societyId: ctx.societyId }))) throw notFound('Announcement');
      throw conflict('Published announcements are kept for the record; archive instead');
    }
    await audit(actor(ctx), 'announcements.deleted', { type: 'Announcement', id }, `Deleted draft "${a.title}"`);
    res.status(204).end();
  });

  return r;
}
