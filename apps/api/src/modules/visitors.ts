import { Router } from 'express';
import type { Types } from 'mongoose';
import { DateTime } from 'luxon';
import {
  VISIT_STATUSES,
  calendarDate,
  canTransitionVisit,
  effectiveInvitationStatus,
  evaluateInvitationForCheckIn,
  guardDecisionSchema,
  invitationSchema,
  localDayBounds,
  residentDecisionSchema,
  verifyPassSchema,
  walkInSchema,
  type GateBoard,
  type InvitationDto,
  type InvitationStatus,
  type Paginated,
  type PassVerification,
  type VisitDto,
  type VisitPurpose,
  type VisitStatus,
} from '@smart-society/shared';
import { Society, Unit, Visit, VisitorInvitation } from '../models/index.js';
import { can, requireAnyPermission, requirePermission, type SocietyContext } from '../lib/context.js';
import { AppError, badRequest, conflict, forbidden, isDuplicateKeyError, notFound } from '../lib/errors.js';
import { escapeRegex, idParam, parse, queryEnum, queryString } from '../lib/validate.js';
import { pageParams } from '../lib/pagination.js';
import { iso, maskPhone, summary, userNames } from '../lib/dto.js';
import { passCode } from '../lib/crypto.js';
import { audit } from '../services/audit.js';
import { activeResidentsOfUnit, notify } from '../services/notifications.js';
import { runtime } from '../services/runtime.js';
import { ownUnit } from './society.js';
import type { createLimiters } from '../middleware/rate-limit.js';

type InvitationLean = {
  _id: Types.ObjectId;
  code: string;
  visitorName: string;
  visitorPhone?: string | null;
  purpose: string;
  validFrom: Date;
  validUntil: Date;
  guestCount: number;
  vehicleNumber?: string | null;
  note?: string | null;
  status: string;
  unitId: Types.ObjectId;
  unitLabel: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
};

type VisitLean = {
  _id: Types.ObjectId;
  source: string;
  status: string;
  visitorName: string;
  visitorPhone?: string | null;
  purpose: string;
  guestCount: number;
  vehicleNumber?: string | null;
  unitId: Types.ObjectId;
  unitLabel: string;
  decision?: { by?: Types.ObjectId | null; method: string; outcome: string; at: Date } | null;
  checkedInAt?: Date | null;
  checkedOutAt?: Date | null;
  checkedInBy?: Types.ObjectId | null;
  checkedOutBy?: Types.ObjectId | null;
  createdAt: Date;
};

/** Hosts and admins see contact details; everyone else (e.g. guards) sees a masked number. */
function seesContact(ctx: SocietyContext, unitId: Types.ObjectId): boolean {
  return ctx.role === 'admin' || (ctx.role === 'resident' && String(ctx.membership.unitId) === String(unitId));
}

async function invitationDtos(ctx: SocietyContext, rows: InvitationLean[]): Promise<InvitationDto[]> {
  const names = await userNames(rows.map((r) => r.createdBy));
  const now = runtime().now();
  return rows.map((r) => ({
    id: String(r._id),
    code: r.code,
    visitorName: r.visitorName,
    visitorPhone: seesContact(ctx, r.unitId) ? (r.visitorPhone ?? null) : maskPhone(r.visitorPhone),
    purpose: r.purpose as VisitPurpose,
    validFrom: r.validFrom.toISOString(),
    validUntil: r.validUntil.toISOString(),
    guestCount: r.guestCount,
    vehicleNumber: r.vehicleNumber ?? null,
    note: r.note ?? null,
    status: effectiveInvitationStatus(r.status as InvitationStatus, r.validUntil, now),
    unitLabel: r.unitLabel,
    createdBy: summary(names, r.createdBy) ?? { id: '', name: 'Unknown' },
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function visitDtos(ctx: SocietyContext, rows: VisitLean[]): Promise<VisitDto[]> {
  const names = await userNames(rows.flatMap((r) => [r.decision?.by, r.checkedInBy, r.checkedOutBy]));
  return rows.map((r) => ({
    id: String(r._id),
    source: r.source as VisitDto['source'],
    status: r.status as VisitStatus,
    visitorName: r.visitorName,
    visitorPhone: seesContact(ctx, r.unitId) ? (r.visitorPhone ?? null) : maskPhone(r.visitorPhone),
    purpose: r.purpose as VisitPurpose,
    guestCount: r.guestCount,
    vehicleNumber: r.vehicleNumber ?? null,
    unitId: String(r.unitId),
    unitLabel: r.unitLabel,
    decision: r.decision
      ? { by: summary(names, r.decision.by), method: r.decision.method, at: r.decision.at.toISOString(), outcome: r.decision.outcome as 'approve' | 'deny' }
      : null,
    checkedInAt: iso(r.checkedInAt),
    checkedOutAt: iso(r.checkedOutAt),
    checkedInBy: summary(names, r.checkedInBy),
    checkedOutBy: summary(names, r.checkedOutBy),
    createdAt: r.createdAt.toISOString(),
  }));
}

function passView(r: InvitationLean): PassVerification['invitation'] {
  return {
    id: String(r._id),
    code: r.code,
    visitorName: r.visitorName,
    purpose: r.purpose as VisitPurpose,
    validFrom: r.validFrom.toISOString(),
    validUntil: r.validUntil.toISOString(),
    guestCount: r.guestCount,
    vehicleNumber: r.vehicleNumber ?? null,
    unitLabel: r.unitLabel,
  };
}

const actor = (ctx: SocietyContext) => ({ userId: ctx.userId, societyId: ctx.societyId, ip: ctx.ip });

const CHECK_IN_MESSAGES = {
  not_yet_valid: 'This pass is not valid yet',
  expired: 'This pass has expired',
  cancelled: 'This pass was cancelled by the resident',
  already_used: 'This pass has already been used',
} as const;

async function loadVisit(ctx: SocietyContext, id: Types.ObjectId) {
  const visit = await Visit.findOne({ _id: id, societyId: ctx.societyId });
  if (!visit) throw notFound('Visit');
  return visit;
}

/** Applies a decision (approve → inside, deny → denied) atomically from awaiting_approval. */
async function decideVisit(ctx: SocietyContext, id: Types.ObjectId, outcome: 'approve' | 'deny', method: string, extraFilter: Record<string, unknown> = {}) {
  const now = runtime().now();
  const to: VisitStatus = outcome === 'approve' ? 'inside' : 'denied';
  if (!canTransitionVisit('awaiting_approval', to)) throw conflict('Invalid transition');
  const set: Record<string, unknown> = { status: to, decision: { by: ctx.userId, method, outcome, at: now } };
  if (to === 'inside') {
    set.checkedInAt = now;
    set.checkedInBy = ctx.userId;
  }
  const visit = await Visit.findOneAndUpdate(
    { _id: id, societyId: ctx.societyId, status: 'awaiting_approval', ...extraFilter },
    { $set: set },
    { new: true },
  );
  if (!visit) {
    const exists = await Visit.exists({ _id: id, societyId: ctx.societyId, ...extraFilter });
    if (!exists) throw notFound('Visit');
    throw conflict('This visitor has already been decided', 'already_decided');
  }
  await audit(actor(ctx), outcome === 'approve' ? 'visitors.walk_in_approved' : 'visitors.walk_in_denied', { type: 'Visit', id: visit._id }, `${outcome === 'approve' ? 'Approved' : 'Denied'} walk-in for ${visit.unitLabel} (${method})`, { method });
  return visit;
}

export function visitorsRouter(limiters: ReturnType<typeof createLimiters>): Router {
  const r = Router();

  // ---------------------------------------------------------------- invitations

  r.get('/invitations', async (req, res) => {
    const ctx = requireAnyPermission(req, 'visitors.viewOwn', 'visitors.viewAll');
    const { page, pageSize } = pageParams(req.query);
    const now = runtime().now();
    const filter: Record<string, unknown> = { societyId: ctx.societyId };
    if (!can(ctx, 'visitors.viewAll')) filter.unitId = ownUnit(ctx);
    const scope = queryEnum(req.query.scope, ['upcoming', 'past'] as const) ?? 'upcoming';
    if (scope === 'upcoming') {
      filter.status = 'active';
      filter.validUntil = { $gte: now };
    } else {
      filter.$or = [{ status: { $ne: 'active' } }, { validUntil: { $lt: now } }];
    }
    const q = queryString(req.query.q, 60);
    if (q) filter.visitorName = { $regex: escapeRegex(q), $options: 'i' };
    const [rows, total] = await Promise.all([
      VisitorInvitation.find(filter)
        .sort({ validFrom: scope === 'upcoming' ? 1 : -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<InvitationLean[]>(),
      VisitorInvitation.countDocuments(filter),
    ]);
    res.json({ items: await invitationDtos(ctx, rows), page, pageSize, total } satisfies Paginated<InvitationDto>);
  });

  r.post('/invitations', async (req, res) => {
    const ctx = requirePermission(req, 'visitors.invite');
    const input = parse(invitationSchema, req.body);
    const unitId = ownUnit(ctx);
    const unit = await Unit.findOne({ _id: unitId, societyId: ctx.societyId }, { label: 1 }).lean();
    if (!unit) throw notFound('Unit');
    const policy = ctx.society.settings?.visitorPolicy;
    const now = runtime().now();
    const maxDays = policy?.invitationMaxDaysAhead ?? 30;
    const maxHours = policy?.invitationMaxHours ?? 24;
    if (input.validUntil.getTime() <= now.getTime()) throw badRequest('The visit window has already ended', { validUntil: 'Choose a future time' });
    if (input.validFrom.getTime() > now.getTime() + maxDays * 86_400_000) {
      throw badRequest(`Invitations can be created up to ${maxDays} days ahead`, { validFrom: `At most ${maxDays} days ahead` });
    }
    if (input.validUntil.getTime() - input.validFrom.getTime() > maxHours * 3_600_000) {
      throw badRequest(`A pass can be valid for at most ${maxHours} hours`, { validUntil: `At most ${maxHours} hours after the start` });
    }
    const active = await VisitorInvitation.countDocuments({ societyId: ctx.societyId, unitId, status: 'active', validUntil: { $gte: now } });
    if (active >= 50) throw conflict('Your unit has too many active passes. Cancel some first.');

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const inv = await VisitorInvitation.create({
          ...input,
          visitorPhone: input.visitorPhone ?? null,
          vehicleNumber: input.vehicleNumber ?? null,
          note: input.note ?? null,
          societyId: ctx.societyId,
          unitId,
          unitLabel: unit.label,
          code: passCode(),
          createdBy: ctx.userId,
        });
        const [dto] = await invitationDtos(ctx, [inv.toObject() as unknown as InvitationLean]);
        res.status(201).json(dto);
        return;
      } catch (e) {
        if (!isDuplicateKeyError(e)) throw e; // pass-code collision: try a new code
      }
    }
    throw new AppError(503, 'code_exhausted', 'Could not allocate a pass code. Try again.');
  });

  r.post('/invitations/:id/cancel', async (req, res) => {
    const ctx = requireAnyPermission(req, 'visitors.invite', 'visitors.viewAll');
    const id = idParam(req.params.id, 'Invitation');
    const filter: Record<string, unknown> = { _id: id, societyId: ctx.societyId };
    if (ctx.role !== 'admin') filter.unitId = ownUnit(ctx);
    const now = runtime().now();
    const inv = await VisitorInvitation.findOneAndUpdate(
      { ...filter, status: 'active' },
      { $set: { status: 'cancelled', cancelledAt: now, cancelledBy: ctx.userId } },
      { new: true },
    );
    if (!inv) {
      if (!(await VisitorInvitation.exists(filter))) throw notFound('Invitation');
      throw conflict('Only active passes can be cancelled');
    }
    await audit(actor(ctx), 'visitors.invitation_cancelled', { type: 'VisitorInvitation', id }, `Cancelled pass for ${inv.unitLabel}`);
    res.status(204).end();
  });

  // ---------------------------------------------------------------- visit history

  r.get('/visits', async (req, res) => {
    const ctx = requireAnyPermission(req, 'visitors.viewOwn', 'visitors.viewAll');
    const { page, pageSize } = pageParams(req.query);
    const filter: Record<string, unknown> = { societyId: ctx.societyId };
    if (!can(ctx, 'visitors.viewAll')) filter.unitId = ownUnit(ctx);
    const status = queryEnum(req.query.status, VISIT_STATUSES);
    if (status) filter.status = status;
    const source = queryEnum(req.query.source, ['invitation', 'walk_in'] as const);
    if (source) filter.source = source;
    const tz = ctx.society.timezone;
    const from = queryString(req.query.from, 10);
    const to = queryString(req.query.to, 10);
    const range: Record<string, Date> = {};
    if (from) range.$gte = DateTime.fromISO(parse(calendarDate, from), { zone: tz }).startOf('day').toJSDate();
    if (to) range.$lt = DateTime.fromISO(parse(calendarDate, to), { zone: tz }).plus({ days: 1 }).startOf('day').toJSDate();
    if (from || to) filter.createdAt = range;
    const q = queryString(req.query.q, 60);
    if (q) filter.$or = [{ visitorName: { $regex: escapeRegex(q), $options: 'i' } }, { unitLabel: { $regex: escapeRegex(q.toUpperCase()) } }];
    const [rows, total] = await Promise.all([
      Visit.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean<VisitLean[]>(),
      Visit.countDocuments(filter),
    ]);
    res.json({ items: await visitDtos(ctx, rows), page, pageSize, total } satisfies Paginated<VisitDto>);
  });

  /** Resident decision on a walk-in waiting at the gate for their unit. */
  r.post('/visits/:id/decision', async (req, res) => {
    const ctx = requirePermission(req, 'visitors.decideOwnUnit');
    const id = idParam(req.params.id, 'Visit');
    const { decision } = parse(residentDecisionSchema, req.body);
    const visit = await decideVisit(ctx, id, decision, 'resident_app', { unitId: ownUnit(ctx) });
    const [dto] = await visitDtos(ctx, [visit.toObject() as unknown as VisitLean]);
    res.json(dto);
  });

  // ---------------------------------------------------------------- gate operations

  r.get('/gate/board', async (req, res) => {
    const ctx = requirePermission(req, 'gate.operate');
    const now = runtime().now();
    const { start, end } = localDayBounds(now, ctx.society.timezone);
    const [expected, awaiting, inside] = await Promise.all([
      VisitorInvitation.find({ societyId: ctx.societyId, status: 'active', validFrom: { $lt: end }, validUntil: { $gte: now > start ? now : start } })
        .sort({ validFrom: 1 })
        .limit(100)
        .lean<InvitationLean[]>(),
      Visit.find({ societyId: ctx.societyId, status: 'awaiting_approval' }).sort({ createdAt: 1 }).limit(50).lean<VisitLean[]>(),
      Visit.find({ societyId: ctx.societyId, status: 'inside' }).sort({ checkedInAt: -1 }).limit(200).lean<VisitLean[]>(),
    ]);
    const board: GateBoard = {
      expectedToday: expected.map(passView),
      awaitingApproval: await visitDtos(ctx, awaiting),
      inside: await visitDtos(ctx, inside),
    };
    res.json(board);
  });

  r.post('/gate/verify', limiters.gateLookup, async (req, res) => {
    const ctx = requirePermission(req, 'gate.operate');
    const { code } = parse(verifyPassSchema, req.body);
    const inv = await VisitorInvitation.findOne({ societyId: ctx.societyId, code }).lean<InvitationLean>();
    if (!inv) throw notFound('Pass');
    const out: PassVerification = {
      invitation: passView(inv),
      checkIn: evaluateInvitationForCheckIn(inv.status as InvitationStatus, inv.validFrom, inv.validUntil, runtime().now()),
    };
    res.json(out);
  });

  r.post('/gate/invitations/:id/check-in', async (req, res) => {
    const ctx = requirePermission(req, 'gate.operate');
    const id = idParam(req.params.id, 'Invitation');
    const now = runtime().now();
    // Claim the pass atomically; only one concurrent check-in can win.
    const inv = await VisitorInvitation.findOneAndUpdate(
      { _id: id, societyId: ctx.societyId, status: 'active', validFrom: { $lte: now }, validUntil: { $gte: now } },
      { $set: { status: 'used', usedAt: now } },
      { new: true },
    );
    if (!inv) {
      const current = await VisitorInvitation.findOne({ _id: id, societyId: ctx.societyId }).lean<InvitationLean>();
      if (!current) throw notFound('Pass');
      const verdict = evaluateInvitationForCheckIn(current.status as InvitationStatus, current.validFrom, current.validUntil, now);
      const reason = verdict.ok ? 'already_used' : verdict.reason;
      throw new AppError(409, reason, CHECK_IN_MESSAGES[reason]);
    }
    let visit;
    try {
      visit = await Visit.create({
        societyId: ctx.societyId,
        unitId: inv.unitId,
        unitLabel: inv.unitLabel,
        source: 'invitation',
        invitationId: inv._id,
        visitorName: inv.visitorName,
        visitorPhone: inv.visitorPhone,
        purpose: inv.purpose,
        guestCount: inv.guestCount,
        vehicleNumber: inv.vehicleNumber,
        status: 'inside',
        decision: { by: inv.createdBy, method: 'pre_approved', outcome: 'approve', at: inv.createdAt },
        registeredBy: ctx.userId,
        checkedInAt: now,
        checkedInBy: ctx.userId,
      });
    } catch (e) {
      if (isDuplicateKeyError(e)) throw new AppError(409, 'already_used', CHECK_IN_MESSAGES.already_used);
      throw e;
    }
    await audit(actor(ctx), 'visitors.checked_in', { type: 'Visit', id: visit._id }, `Checked in pre-approved visitor for ${inv.unitLabel}`);
    await notify(ctx.societyId, [inv.createdBy], {
      type: 'visitor.arrived',
      title: `${inv.visitorName} has arrived`,
      body: `Checked in at the gate for ${inv.unitLabel}.`,
      link: '/app/visitors',
    });
    const [dto] = await visitDtos(ctx, [visit.toObject() as unknown as VisitLean]);
    res.status(201).json(dto);
  });

  r.post('/gate/walk-ins', async (req, res) => {
    const ctx = requirePermission(req, 'gate.operate');
    const input = parse(walkInSchema, req.body);
    const unit = await Unit.findOne({ _id: idParam(input.unitId, 'Unit'), societyId: ctx.societyId }, { label: 1 }).lean();
    if (!unit) throw notFound('Unit');
    const visit = await Visit.create({
      societyId: ctx.societyId,
      unitId: unit._id,
      unitLabel: unit.label,
      source: 'walk_in',
      visitorName: input.visitorName,
      visitorPhone: input.visitorPhone ?? null,
      purpose: input.purpose,
      guestCount: input.guestCount,
      vehicleNumber: input.vehicleNumber ?? null,
      status: 'awaiting_approval',
      registeredBy: ctx.userId,
    });
    await audit(actor(ctx), 'visitors.walk_in_registered', { type: 'Visit', id: visit._id }, `Registered walk-in for ${unit.label}`, { purpose: input.purpose });
    const residents = await activeResidentsOfUnit(ctx.societyId, unit._id);
    await notify(ctx.societyId, residents, {
      type: 'visitor.approval_requested',
      title: 'Visitor waiting at the gate',
      body: `${input.visitorName} (${input.purpose}) is asking to visit ${unit.label}. Approve or deny in the app.`,
      link: '/app/visitors',
    });
    const [dto] = await visitDtos(ctx, [visit.toObject() as unknown as VisitLean]);
    res.status(201).json({ visit: dto, residentsNotified: residents.length });
  });

  /** Guard records a decision obtained by intercom/phone, or in person when policy allows. */
  r.post('/gate/visits/:id/decision', async (req, res) => {
    const ctx = requirePermission(req, 'gate.operate');
    const id = idParam(req.params.id, 'Visit');
    const input = parse(guardDecisionSchema, req.body);
    const policy = ctx.society.settings?.visitorPolicy;
    if (input.decision === 'approve' && input.method === 'in_person' && (policy?.walkInRequiresResidentApproval ?? true)) {
      throw forbidden('Society policy requires the resident to approve walk-ins (in the app, by intercom or by phone)');
    }
    const visit = await decideVisit(ctx, id, input.decision, input.method);
    const residents = await activeResidentsOfUnit(ctx.societyId, visit.unitId);
    if (input.decision === 'approve') {
      await notify(ctx.societyId, residents, {
        type: 'visitor.arrived',
        title: `${visit.visitorName} checked in`,
        body: `Let in for ${visit.unitLabel} after confirmation by ${input.method.replace('_', ' ')}.`,
        link: '/app/visitors',
      });
    }
    const [dto] = await visitDtos(ctx, [visit.toObject() as unknown as VisitLean]);
    res.json(dto);
  });

  r.post('/gate/visits/:id/withdraw', async (req, res) => {
    const ctx = requirePermission(req, 'gate.operate');
    const id = idParam(req.params.id, 'Visit');
    const visit = await Visit.findOneAndUpdate({ _id: id, societyId: ctx.societyId, status: 'awaiting_approval' }, { $set: { status: 'withdrawn' } }, { new: true });
    if (!visit) {
      await loadVisit(ctx, id);
      throw conflict('Only waiting visitors can be withdrawn');
    }
    await audit(actor(ctx), 'visitors.walk_in_withdrawn', { type: 'Visit', id }, `Walk-in for ${visit.unitLabel} left before a decision`);
    res.status(204).end();
  });

  r.post('/gate/visits/:id/check-out', async (req, res) => {
    const ctx = requirePermission(req, 'gate.operate');
    const id = idParam(req.params.id, 'Visit');
    const now = runtime().now();
    const visit = await Visit.findOneAndUpdate(
      { _id: id, societyId: ctx.societyId, status: 'inside' },
      { $set: { status: 'checked_out', checkedOutAt: now, checkedOutBy: ctx.userId } },
      { new: true },
    );
    if (!visit) {
      await loadVisit(ctx, id);
      throw conflict('This visitor is not inside', 'not_inside');
    }
    await audit(actor(ctx), 'visitors.checked_out', { type: 'Visit', id }, `Checked out visitor from ${visit.unitLabel}`);
    if (visit.invitationId) {
      const inv = await VisitorInvitation.findById(visit.invitationId, { createdBy: 1 }).lean();
      if (inv) {
        await notify(ctx.societyId, [inv.createdBy], {
          type: 'visitor.checked_out',
          title: `${visit.visitorName} has left`,
          body: `Checked out at the gate.`,
          link: '/app/visitors',
        });
      }
    }
    const [dto] = await visitDtos(ctx, [visit.toObject() as unknown as VisitLean]);
    res.json(dto);
  });

  return r;
}

/**
 * Visitor data retention: replaces names, phone numbers and vehicle numbers on records older
 * than each society's retention period. Visits still in progress are never touched.
 */
export async function purgeExpiredVisitorData(): Promise<number> {
  const now = runtime().now();
  let total = 0;
  const societies = await Society.find({}, { settings: 1 }).lean();
  for (const s of societies) {
    const days = s.settings?.visitorPolicy?.visitorRetentionDays ?? 180;
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const scrub = { visitorName: 'Removed after retention period', visitorPhone: null, vehicleNumber: null, anonymizedAt: now };
    const v = await Visit.updateMany(
      { societyId: s._id, createdAt: { $lt: cutoff }, anonymizedAt: null, status: { $nin: ['inside', 'awaiting_approval'] } },
      { $set: scrub },
    );
    const i = await VisitorInvitation.updateMany(
      { societyId: s._id, validUntil: { $lt: cutoff }, anonymizedAt: null },
      { $set: { ...scrub, note: null } },
    );
    total += v.modifiedCount + i.modifiedCount;
  }
  return total;
}

