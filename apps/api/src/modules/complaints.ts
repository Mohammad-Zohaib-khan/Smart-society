import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import type { Types } from 'mongoose';
import {
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  COMPLAINT_STATUS_LABELS,
  allowedComplaintTransitions,
  assignComplaintSchema,
  canAssignComplaint,
  canTransitionComplaint,
  complaintCommentSchema,
  complaintSchema,
  complaintStatusSchema,
  isComplaintTerminal,
  type AttachmentDto,
  type ComplaintActor,
  type ComplaintDetailDto,
  type ComplaintDto,
  type ComplaintEventDto,
  type ComplaintPriority,
  type ComplaintStatus,
  type Paginated,
} from '@smart-society/shared';
import { Attachment, Complaint, Membership, Society, Unit, type ComplaintLean } from '../models/index.js';
import { can, requireAnyPermission, requirePermission, requireSociety, type SocietyContext } from '../lib/context.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { escapeRegex, idParam, oid, parse, queryEnum, queryString } from '../lib/validate.js';
import { pageParams } from '../lib/pagination.js';
import { iso, summary, userNames } from '../lib/dto.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notifications.js';
import { runtime } from '../services/runtime.js';
import type { createLimiters } from '../middleware/rate-limit.js';

const ACTIVE_STATUSES: ComplaintStatus[] = ['assigned', 'in_progress', 'on_hold'];
const ALLOWED_UPLOADS: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
const MAX_ATTACHMENTS = 10;


const actor = (ctx: SocietyContext) => ({ userId: ctx.userId, societyId: ctx.societyId, ip: ctx.ip });

interface Access {
  canView: boolean;
  actors: ComplaintActor[];
  seesInternal: boolean;
}

function accessFor(ctx: SocietyContext, c: Pick<ComplaintLean, 'reporterId' | 'unitId' | 'assigneeUserId'>): Access {
  const actors: ComplaintActor[] = [];
  if (String(c.reporterId) === String(ctx.userId)) actors.push('reporter');
  if (can(ctx, 'complaints.assign')) actors.push('manager');
  if (can(ctx, 'workOrders.update') && c.assigneeUserId && String(c.assigneeUserId) === String(ctx.userId)) actors.push('assignee');
  const sameUnit = can(ctx, 'complaints.viewOwn') && c.unitId && String(c.unitId) === String(ctx.membership.unitId);
  const canView = actors.length > 0 || Boolean(sameUnit) || can(ctx, 'complaints.viewAll');
  return { canView, actors, seesInternal: actors.includes('manager') || actors.includes('assignee') || ctx.role === 'committee' };
}

function visibilityFilter(ctx: SocietyContext): Record<string, unknown> {
  if (can(ctx, 'complaints.viewAll')) return { societyId: ctx.societyId };
  const or: Record<string, unknown>[] = [{ reporterId: ctx.userId }];
  if (can(ctx, 'complaints.viewOwn') && ctx.membership.unitId) or.push({ unitId: ctx.membership.unitId });
  if (can(ctx, 'workOrders.viewAssigned')) or.push({ assigneeUserId: ctx.userId });
  return { societyId: ctx.societyId, $or: or };
}

export async function complaintDtos(ctx: SocietyContext, rows: ComplaintLean[]): Promise<ComplaintDto[]> {
  const names = await userNames(rows.flatMap((c) => [c.reporterId, c.assigneeUserId]));
  return rows.map((c) => {
    const access = accessFor(ctx, c);
    const status = c.status as ComplaintStatus;
    return {
      id: String(c._id),
      number: c.number,
      title: c.title,
      description: c.description,
      category: c.category,
      priority: c.priority as ComplaintPriority,
      area: c.area as 'unit' | 'common_area',
      status,
      unitLabel: c.unitLabel ?? null,
      reporter: summary(names, c.reporterId) ?? { id: '', name: 'Unknown' },
      assignee: summary(names, c.assigneeUserId),
      dueDate: c.dueDate ?? null,
      resolvedAt: iso(c.resolvedAt),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      allowedTransitions: allowedComplaintTransitions(status, access.actors),
      canAssign: access.actors.includes('manager') && canAssignComplaint(status),
      canComment: access.actors.length > 0 && !isComplaintTerminal(status),
    };
  });
}

async function detailDto(ctx: SocietyContext, c: ComplaintLean): Promise<ComplaintDetailDto> {
  const access = accessFor(ctx, c);
  const [base] = await complaintDtos(ctx, [c]);
  if (!base) throw notFound('Complaint');
  const events = (c.events ?? []).filter((e) => access.seesInternal || !e.internal);
  const attachments = await Attachment.find({ societyId: ctx.societyId, ownerType: 'complaint', ownerId: c._id }).sort({ createdAt: 1 }).lean();
  const names = await userNames([...events.flatMap((e) => [e.actorId, e.assigneeUserId]), ...attachments.map((a) => a.uploadedBy)]);
  const eventDtos: ComplaintEventDto[] = events.map((e) => ({
    id: String(e._id),
    kind: e.kind as ComplaintEventDto['kind'],
    actor: summary(names, e.actorId) ?? { id: '', name: 'Unknown' },
    at: e.at.toISOString(),
    ...(e.fromStatus ? { fromStatus: e.fromStatus as ComplaintStatus } : {}),
    ...(e.toStatus ? { toStatus: e.toStatus as ComplaintStatus } : {}),
    ...(e.body ? { body: e.body } : {}),
    ...(e.internal ? { internal: true } : {}),
    ...(e.assigneeUserId ? { assignee: summary(names, e.assigneeUserId) ?? { id: '', name: 'Unknown' } } : {}),
    ...(e.attachmentId ? { attachmentId: String(e.attachmentId) } : {}),
  }));
  const attachmentDtos: AttachmentDto[] = attachments.map((a) => ({
    id: String(a._id),
    fileName: a.fileName,
    contentType: a.contentType,
    size: a.size,
    purpose: a.purpose as AttachmentDto['purpose'],
    uploadedBy: summary(names, a.uploadedBy) ?? { id: '', name: 'Unknown' },
    createdAt: a.createdAt.toISOString(),
  }));
  return { ...base, events: eventDtos, attachments: attachmentDtos };
}

async function loadVisible(ctx: SocietyContext, id: Types.ObjectId) {
  const c = await Complaint.findOne({ _id: id, societyId: ctx.societyId }).lean<ComplaintLean>();
  // Not-visible and nonexistent look identical to the caller.
  if (!c || !accessFor(ctx, c).canView) throw notFound('Complaint');
  return c;
}

/** People to tell about a change: reporter and assignee, minus whoever made it. */
function stakeholders(c: Pick<ComplaintLean, 'reporterId' | 'assigneeUserId'>): Types.ObjectId[] {
  return [c.reporterId, c.assigneeUserId].filter((v): v is Types.ObjectId => Boolean(v));
}

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').replace(/\.{2,}/g, '.').trim();
  return (cleaned || 'file').slice(0, 80);
}

export function complaintsRouter(limiters: ReturnType<typeof createLimiters>): Router {
  const r = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: runtime().env.MAX_UPLOAD_MB * 1024 * 1024, files: 3, fields: 2, parts: 6 },
  });

  r.get('/', async (req, res) => {
    const ctx = requireAnyPermission(req, 'complaints.viewOwn', 'complaints.viewAll', 'workOrders.viewAssigned');
    const { page, pageSize } = pageParams(req.query);
    const filter = visibilityFilter(ctx);
    const status = queryString(req.query.status, 80);
    if (status === 'active') filter.status = { $in: ['open', ...ACTIVE_STATUSES] };
    else if (status) {
      const s = queryEnum(status, COMPLAINT_STATUSES);
      if (s) filter.status = s;
    }
    const priority = queryEnum(req.query.priority, COMPLAINT_PRIORITIES);
    if (priority) filter.priority = priority;
    const category = queryString(req.query.category, 40);
    if (category) filter.category = category;
    if (req.query.assignee === 'me') filter.assigneeUserId = ctx.userId;
    if (req.query.assignee === 'none') filter.assigneeUserId = null;
    const q = queryString(req.query.q, 60);
    if (q) {
      const n = Number(q.replace(/^#/, ''));
      const text = { $regex: escapeRegex(q), $options: 'i' };
      const and = (filter.$and as unknown[] | undefined) ?? [];
      and.push({ $or: [{ title: text }, { unitLabel: { $regex: escapeRegex(q.toUpperCase()) } }, ...(Number.isInteger(n) ? [{ number: n }] : [])] });
      filter.$and = and;
    }
    const [rows, total] = await Promise.all([
      Complaint.find(filter, { events: 0 }).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean<ComplaintLean[]>(),
      Complaint.countDocuments(filter),
    ]);
    res.json({ items: await complaintDtos(ctx, rows), page, pageSize, total } satisfies Paginated<ComplaintDto>);
  });

  r.post('/', async (req, res) => {
    const ctx = requirePermission(req, 'complaints.create');
    const input = parse(complaintSchema, req.body);
    const categories = ctx.society.settings?.complaintCategories ?? [];
    if (!categories.includes(input.category)) throw badRequest('Choose one of the society categories', { category: 'Unknown category' });
    let unitId: Types.ObjectId | null = null;
    let unitLabel: string | null = null;
    if (ctx.membership.unitId) {
      const unit = await Unit.findOne({ _id: ctx.membership.unitId, societyId: ctx.societyId }, { label: 1 }).lean();
      unitId = unit?._id ?? null;
      unitLabel = unit?.label ?? null;
    }
    if (input.area === 'unit' && !unitId) throw badRequest('Your membership has no unit; choose common area', { area: 'Use common area' });
    const counter = await Society.findOneAndUpdate({ _id: ctx.societyId }, { $inc: { complaintCounter: 1 } }, { new: true });
    if (!counter) throw notFound('Society');
    const now = runtime().now();
    const c = await Complaint.create({
      ...input,
      societyId: ctx.societyId,
      number: counter.complaintCounter,
      unitId,
      unitLabel,
      reporterId: ctx.userId,
      events: [{ kind: 'created', actorId: ctx.userId, at: now, toStatus: 'open' }],
    });
    await audit(actor(ctx), 'complaints.created', { type: 'Complaint', id: c._id }, `Complaint #${c.number} created`, { priority: input.priority, category: input.category });
    const managers = await Membership.find({ societyId: ctx.societyId, role: 'admin', status: 'active' }, { userId: 1 }).lean();
    await notify(ctx.societyId, managers.map((m) => m.userId), {
      type: 'complaint.updated',
      title: `New complaint #${c.number}: ${c.title}`,
      body: `${input.priority === 'urgent' ? 'URGENT · ' : ''}${input.category}${unitLabel ? ` · ${unitLabel}` : ''}`,
      link: `/app/complaints/${String(c._id)}`,
    }, { exclude: ctx.userId });
    res.status(201).json(await detailDto(ctx, c.toObject() as ComplaintLean));
  });

  r.get('/attachments/:id', async (req, res) => {
    const ctx = requireSociety(req);
    const id = idParam(req.params.id, 'Attachment');
    const a = await Attachment.findOne({ _id: id, societyId: ctx.societyId }).lean();
    if (!a) throw notFound('Attachment');
    await loadVisible(ctx, a.ownerId); // same visibility as the parent complaint
    const data = await runtime().storage.get(a.storageKey);
    res.setHeader('Content-Type', a.contentType);
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    const inline = req.query.inline === '1' && a.contentType.startsWith('image/');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${a.fileName.replace(/"/g, '')}"`);
    res.send(data);
  });

  r.get('/:id', async (req, res) => {
    const ctx = requireAnyPermission(req, 'complaints.viewOwn', 'complaints.viewAll', 'workOrders.viewAssigned');
    const c = await loadVisible(ctx, idParam(req.params.id, 'Complaint'));
    res.json(await detailDto(ctx, c));
  });

  r.post('/:id/assign', async (req, res) => {
    const ctx = requirePermission(req, 'complaints.assign');
    const id = idParam(req.params.id, 'Complaint');
    const input = parse(assignComplaintSchema, req.body);
    const staff = await Membership.findOne({ _id: oid(input.assigneeMembershipId), societyId: ctx.societyId, role: 'staff', status: 'active' });
    if (!staff) throw badRequest('Choose an active maintenance staff member', { assigneeMembershipId: 'Not an active staff member' });
    const current = await Complaint.findOne({ _id: id, societyId: ctx.societyId }).lean<ComplaintLean>();
    if (!current) throw notFound('Complaint');
    const from = current.status as ComplaintStatus;
    if (!canAssignComplaint(from)) throw conflict(`A ${COMPLAINT_STATUS_LABELS[from].toLowerCase()} complaint cannot be reassigned`);
    const now = runtime().now();
    const to: ComplaintStatus = from === 'open' ? 'assigned' : from;
    const updated = await Complaint.findOneAndUpdate(
      { _id: id, societyId: ctx.societyId, status: from },
      {
        $set: {
          status: to,
          assigneeMembershipId: staff._id,
          assigneeUserId: staff.userId,
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
        },
        $push: { events: { kind: 'assigned', actorId: ctx.userId, at: now, fromStatus: from, toStatus: to, assigneeUserId: staff.userId } },
      },
      { new: true },
    ).lean<ComplaintLean>();
    if (!updated) throw conflict('The complaint changed while you were editing. Refresh and try again.', 'stale');
    await audit(actor(ctx), 'complaints.assigned', { type: 'Complaint', id }, `Assigned complaint #${updated.number}`, { dueDate: input.dueDate ?? null });
    await notify(ctx.societyId, [staff.userId], {
      type: 'complaint.assigned',
      title: `Work order #${updated.number} assigned to you`,
      body: `${updated.title}${updated.dueDate ? ` · due ${updated.dueDate}` : ''}`,
      link: `/app/complaints/${String(id)}`,
    });
    await notify(ctx.societyId, [updated.reporterId], {
      type: 'complaint.updated',
      title: `Complaint #${updated.number} assigned`,
      body: 'A maintenance team member has been assigned.',
      link: `/app/complaints/${String(id)}`,
    }, { exclude: ctx.userId });
    res.json(await detailDto(ctx, updated));
  });

  r.post('/:id/status', async (req, res) => {
    const ctx = requireSociety(req);
    const id = idParam(req.params.id, 'Complaint');
    const input = parse(complaintStatusSchema, req.body);
    const current = await loadVisible(ctx, id);
    const from = current.status as ComplaintStatus;
    const { actors } = accessFor(ctx, current);
    if (!canTransitionComplaint(from, input.status, actors)) {
      if (actors.length === 0) throw forbidden();
      throw conflict(`Cannot move from ${COMPLAINT_STATUS_LABELS[from]} to ${COMPLAINT_STATUS_LABELS[input.status]}`, 'invalid_transition');
    }
    if (input.status === 'resolved' && !input.note) throw badRequest('Describe the work done before resolving', { note: 'Resolution note is required' });
    if (from === 'resolved' && input.status === 'in_progress' && !input.note) throw badRequest('Explain why the complaint is being reopened', { note: 'Reason is required' });
    const now = runtime().now();
    const set: Record<string, unknown> = { status: input.status };
    if (input.status === 'resolved') set.resolvedAt = now;
    if (input.status === 'closed') set.closedAt = now;
    if (from === 'resolved' && input.status === 'in_progress') set.resolvedAt = null;
    const updated = await Complaint.findOneAndUpdate(
      { _id: id, societyId: ctx.societyId, status: from },
      { $set: set, $push: { events: { kind: 'status', actorId: ctx.userId, at: now, fromStatus: from, toStatus: input.status, ...(input.note ? { body: input.note } : {}) } } },
      { new: true },
    ).lean<ComplaintLean>();
    if (!updated) throw conflict('The complaint changed while you were editing. Refresh and try again.', 'stale');
    await audit(actor(ctx), 'complaints.status_changed', { type: 'Complaint', id }, `Complaint #${updated.number}: ${COMPLAINT_STATUS_LABELS[from]} → ${COMPLAINT_STATUS_LABELS[input.status]}`, { from, to: input.status });
    await notify(ctx.societyId, stakeholders(updated), {
      type: 'complaint.updated',
      title: `Complaint #${updated.number} is ${COMPLAINT_STATUS_LABELS[input.status].toLowerCase()}`,
      body: input.note ?? updated.title,
      link: `/app/complaints/${String(id)}`,
    }, { exclude: ctx.userId });
    res.json(await detailDto(ctx, updated));
  });

  r.post('/:id/comments', async (req, res) => {
    const ctx = requireSociety(req);
    const id = idParam(req.params.id, 'Complaint');
    const input = parse(complaintCommentSchema, req.body);
    const current = await loadVisible(ctx, id);
    const access = accessFor(ctx, current);
    if (access.actors.length === 0) throw forbidden('Only the reporter, assignee or a manager can comment');
    if (isComplaintTerminal(current.status as ComplaintStatus)) throw conflict('This complaint is closed to new comments');
    if (input.internal && !(access.actors.includes('manager') || access.actors.includes('assignee'))) throw forbidden('Only staff can add internal notes');
    const updated = await Complaint.findOneAndUpdate(
      { _id: id, societyId: ctx.societyId },
      { $push: { events: { kind: 'comment', actorId: ctx.userId, at: runtime().now(), body: input.body, internal: input.internal } } },
      { new: true },
    ).lean<ComplaintLean>();
    if (!updated) throw notFound('Complaint');
    if (!input.internal) {
      await notify(ctx.societyId, stakeholders(updated), {
        type: 'complaint.updated',
        title: `New comment on #${updated.number}`,
        body: input.body.slice(0, 140),
        link: `/app/complaints/${String(id)}`,
      }, { exclude: ctx.userId });
    }
    res.status(201).json(await detailDto(ctx, updated));
  });

  r.post('/:id/attachments', limiters.upload, upload.array('files', 3), async (req, res) => {
    const ctx = requireSociety(req);
    const id = idParam(req.params.id, 'Complaint');
    const current = await loadVisible(ctx, id);
    const access = accessFor(ctx, current);
    if (access.actors.length === 0) throw forbidden();
    if (isComplaintTerminal(current.status as ComplaintStatus)) throw conflict('This complaint is closed');
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw badRequest('Attach at least one file');
    const existing = await Attachment.countDocuments({ societyId: ctx.societyId, ownerType: 'complaint', ownerId: id });
    if (existing + files.length > MAX_ATTACHMENTS) throw conflict(`A complaint can hold at most ${MAX_ATTACHMENTS} files`);

    // Validate every file by its content, never by the client's MIME type or extension.
    const sniffed = await Promise.all(files.map((f) => fileTypeFromBuffer(f.buffer)));
    for (const [i, t] of sniffed.entries()) {
      if (!t || !ALLOWED_UPLOADS[t.ext]) throw new AppError(415, 'unsupported_file', `${safeFileName(files[i]?.originalname ?? 'File')} is not a JPEG, PNG, WebP or PDF`);
    }
    const { storage } = runtime();
    const purpose = access.actors.includes('reporter') && !access.actors.includes('manager') ? 'report' : 'completion';
    const now = runtime().now();
    for (const [i, f] of files.entries()) {
      const type = sniffed[i];
      if (!type) continue;
      const key = await storage.put(f.buffer, type.ext);
      const a = await Attachment.create({
        societyId: ctx.societyId,
        ownerType: 'complaint',
        ownerId: id,
        storageKey: key,
        fileName: safeFileName(f.originalname),
        contentType: ALLOWED_UPLOADS[type.ext],
        size: f.size,
        purpose,
        uploadedBy: ctx.userId,
      });
      await Complaint.updateOne({ _id: id }, { $push: { events: { kind: 'attachment', actorId: ctx.userId, at: now, attachmentId: a._id, body: a.fileName } } });
    }
    const updated = await Complaint.findById(id).lean<ComplaintLean>();
    if (!updated) throw notFound('Complaint');
    res.status(201).json(await detailDto(ctx, updated));
  });

  return r;
}
