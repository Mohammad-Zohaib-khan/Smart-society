import { Router } from 'express';
import type { Types } from 'mongoose';
import { DateTime } from 'luxon';
import {
  calendarDate,
  localDayBounds,
  slotsForDay,
  type AdminDashboard,
  type AuditLogDto,
  type CountByKey,
  type DashboardResponse,
  type Paginated,
  type ReportSummary,
  type ResidentDashboard,
  type StaffDashboard,
} from '@smart-society/shared';
import {
  Amenity,
  Announcement,
  AnnouncementRead,
  AuditLog,
  Booking,
  Complaint,
  Membership,
  Notification,
  ParkingAssignment,
  ParkingSlot,
  Unit,
  Visit,
  VisitorInvitation,
  type ComplaintLean,
} from '../models/index.js';
import { can, requirePermission, requireSociety, type SocietyContext } from '../lib/context.js';
import { badRequest } from '../lib/errors.js';
import { escapeRegex, parse, queryString } from '../lib/validate.js';
import { pageParams } from '../lib/pagination.js';
import { summary, userNames, maskPhone } from '../lib/dto.js';
import { audit } from '../services/audit.js';
import { runtime } from '../services/runtime.js';
import { complaintDtos } from './complaints.js';
import { visitDtos } from './visitors.js';

const OPEN: string[] = ['open', 'assigned', 'in_progress', 'on_hold'];

async function auditDtos(rows: Array<{ _id: Types.ObjectId; action: string; actorId?: Types.ObjectId | null; targetType: string; targetId?: Types.ObjectId | null; summary: string; metadata?: unknown; createdAt: Date }>): Promise<AuditLogDto[]> {
  const names = await userNames(rows.map((r) => r.actorId));
  return rows.map((r) => ({
    id: String(r._id),
    action: r.action,
    actor: summary(names, r.actorId),
    targetType: r.targetType,
    targetId: r.targetId ? String(r.targetId) : null,
    summary: r.summary,
    metadata: (r.metadata ?? {}) as AuditLogDto['metadata'],
    createdAt: r.createdAt.toISOString(),
  }));
}

function todayString(ctx: SocietyContext): string {
  return DateTime.fromJSDate(runtime().now(), { zone: ctx.society.timezone }).toISODate() ?? '';
}

async function adminDashboard(ctx: SocietyContext): Promise<AdminDashboard> {
  const now = runtime().now();
  const { start, end } = localDayBounds(now, ctx.society.timezone);
  const s = ctx.societyId;
  const [unitsTotal, unitsOccupied, members, byStatus, urgentOpen, overdue, expected, inside, awaiting, bookingsToday, slots, occupied, recent] = await Promise.all([
    Unit.countDocuments({ societyId: s }),
    Unit.countDocuments({ societyId: s, status: 'occupied' }),
    Membership.countDocuments({ societyId: s, status: 'active' }),
    Complaint.aggregate<{ _id: string; n: number }>([{ $match: { societyId: s } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Complaint.countDocuments({ societyId: s, priority: 'urgent', status: { $in: OPEN } }),
    Complaint.countDocuments({ societyId: s, status: { $in: OPEN }, dueDate: { $ne: null, $lt: todayString(ctx) } }),
    VisitorInvitation.countDocuments({ societyId: s, status: 'active', validFrom: { $lt: end }, validUntil: { $gte: now > start ? now : start } }),
    Visit.countDocuments({ societyId: s, status: 'inside' }),
    Visit.countDocuments({ societyId: s, status: 'awaiting_approval' }),
    Booking.countDocuments({ societyId: s, status: 'confirmed', slotStart: { $gte: start, $lt: end } }),
    ParkingSlot.countDocuments({ societyId: s, active: true }),
    ParkingAssignment.countDocuments({ societyId: s, active: true }),
    can(ctx, 'audit.view') ? AuditLog.find({ societyId: s }).sort({ createdAt: -1 }).limit(8).lean() : Promise.resolve([]),
  ]);
  const statusCounts: CountByKey[] = byStatus.map((b) => ({ key: b._id, count: b.n })).sort((a, b) => b.count - a.count);
  return {
    units: { total: unitsTotal, occupied: unitsOccupied },
    members,
    complaints: { open: statusCounts.filter((c) => OPEN.includes(c.key)).reduce((n, c) => n + c.count, 0), urgentOpen, overdue, byStatus: statusCounts },
    visitors: { expectedToday: expected, inside, awaitingApproval: awaiting },
    bookingsToday,
    parking: { slots, occupied },
    recentActivity: await auditDtos(recent),
  };
}

async function residentDashboard(ctx: SocietyContext): Promise<ResidentDashboard> {
  const now = runtime().now();
  const unitId = ctx.membership.unitId;
  const s = ctx.societyId;
  const unit = unitId ? await Unit.findById(unitId, { label: 1, buildingId: 1 }).lean() : null;
  const [invites, awaiting, inside, complaints, bookings, unread] = await Promise.all([
    unitId ? VisitorInvitation.find({ societyId: s, unitId, status: 'active', validUntil: { $gte: now } }).sort({ validFrom: 1 }).limit(5).lean() : [],
    unitId ? Visit.find({ societyId: s, unitId, status: 'awaiting_approval' }).sort({ createdAt: 1 }).lean() : [],
    unitId ? Visit.find({ societyId: s, unitId, status: 'inside' }).sort({ checkedInAt: -1 }).lean() : [],
    Complaint.find({ societyId: s, status: { $in: [...OPEN, 'resolved'] }, $or: [{ reporterId: ctx.userId }, ...(unitId ? [{ unitId }] : [])] }, { events: 0 })
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean<ComplaintLean[]>(),
    unitId ? Booking.find({ societyId: s, unitId, status: 'confirmed', slotEnd: { $gte: now } }).sort({ slotStart: 1 }).limit(5).lean() : [],
    Notification.countDocuments({ userId: ctx.userId, societyId: s, readAt: null }),
  ]);
  const pinned = await Announcement.find({ societyId: s, status: 'published', pinned: true, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] })
    .sort({ publishedAt: -1 })
    .limit(10)
    .lean();
  const visiblePinned = pinned.filter((a) => {
    const roles = a.audience?.roles ?? [];
    const buildings = (a.audience?.buildingIds ?? []).map(String);
    if (roles.length && !roles.includes('resident')) return false;
    return !buildings.length || (unit ? buildings.includes(String(unit.buildingId)) : false);
  }).slice(0, 3);
  const reads = await AnnouncementRead.find({ userId: ctx.userId, announcementId: { $in: visiblePinned.map((a) => a._id) } }, { announcementId: 1 }).lean();
  const authors = await userNames(visiblePinned.map((a) => a.authorId));
  const inviteNames = await userNames(invites.map((i) => i.createdBy));
  return {
    unitLabel: unit?.label ?? null,
    upcomingInvitations: invites.map((i) => ({
      id: String(i._id),
      code: i.code,
      visitorName: i.visitorName,
      visitorPhone: i.visitorPhone ?? null,
      purpose: i.purpose,
      validFrom: i.validFrom.toISOString(),
      validUntil: i.validUntil.toISOString(),
      guestCount: i.guestCount,
      vehicleNumber: i.vehicleNumber ?? null,
      note: i.note ?? null,
      status: 'active',
      unitLabel: i.unitLabel,
      createdBy: summary(inviteNames, i.createdBy) ?? { id: '', name: 'Unknown' },
      createdAt: i.createdAt.toISOString(),
    })),
    visitsAwaitingMe: await visitDtos(ctx, awaiting),
    insideNow: await visitDtos(ctx, inside),
    openComplaints: await complaintDtos(ctx, complaints),
    upcomingBookings: bookings.map((b) => ({
      id: String(b._id),
      amenityId: String(b.amenityId),
      amenityName: b.amenityName,
      slotStart: b.slotStart.toISOString(),
      slotEnd: b.slotEnd.toISOString(),
      status: 'confirmed',
      unitLabel: b.unitLabel,
      bookedBy: { id: String(b.bookedBy), name: '' },
      cancelledAt: null,
      cancelledBy: null,
      createdAt: b.createdAt.toISOString(),
      canCancel: false,
    })),
    pinnedAnnouncements: visiblePinned.map((a) => ({
      id: String(a._id),
      title: a.title,
      body: a.body,
      priority: a.priority,
      pinned: true,
      status: 'published',
      audience: { roles: a.audience?.roles ?? [], buildingIds: (a.audience?.buildingIds ?? []).map(String) },
      publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
      expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
      author: summary(authors, a.authorId) ?? { id: '', name: 'Unknown' },
      createdAt: a.createdAt.toISOString(),
      read: reads.some((r) => String(r.announcementId) === String(a._id)),
    })),
    unreadNotifications: unread,
  };
}

async function staffDashboard(ctx: SocietyContext): Promise<StaffDashboard> {
  const base = { societyId: ctx.societyId, assigneeUserId: ctx.userId };
  const today = todayString(ctx);
  const [assigned, inProgress, onHold, overdue, due] = await Promise.all([
    Complaint.countDocuments({ ...base, status: 'assigned' }),
    Complaint.countDocuments({ ...base, status: 'in_progress' }),
    Complaint.countDocuments({ ...base, status: 'on_hold' }),
    Complaint.countDocuments({ ...base, status: { $in: ['assigned', 'in_progress', 'on_hold'] }, dueDate: { $ne: null, $lt: today } }),
    Complaint.find({ ...base, status: { $in: ['assigned', 'in_progress', 'on_hold'] } }, { events: 0 })
      .sort({ dueDate: 1, createdAt: 1 })
      .limit(8)
      .lean<ComplaintLean[]>(),
  ]);
  // Items without a due date sort first in MongoDB; put them last for the work queue.
  const ordered = [...due].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  return { assigned, inProgress, onHold, overdue, dueSoon: await complaintDtos(ctx, ordered) };
}

function reportRange(ctx: SocietyContext, query: Record<string, unknown>): { from: DateTime; to: DateTime } {
  const tz = ctx.society.timezone;
  const today = DateTime.fromJSDate(runtime().now(), { zone: tz }).startOf('day');
  const fromStr = queryString(query.from, 10);
  const toStr = queryString(query.to, 10);
  const from = fromStr ? DateTime.fromISO(parse(calendarDate, fromStr), { zone: tz }) : today.minus({ days: 29 });
  const to = toStr ? DateTime.fromISO(parse(calendarDate, toStr), { zone: tz }) : today;
  if (to < from) throw badRequest('The end date must be on or after the start date');
  if (to.diff(from, 'days').days > 366) throw badRequest('Reports cover at most one year');
  return { from, to };
}

function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function insightsRouter(): Router {
  const r = Router();

  r.get('/dashboard', async (req, res) => {
    const ctx = requireSociety(req);
    let out: DashboardResponse;
    switch (ctx.role) {
      case 'admin':
      case 'committee':
        out = { role: ctx.role, admin: await adminDashboard(ctx) };
        break;
      case 'resident':
        out = { role: 'resident', resident: await residentDashboard(ctx) };
        break;
      case 'staff':
        out = { role: 'staff', staff: await staffDashboard(ctx) };
        break;
      case 'guard':
        out = { role: 'guard' };
        break;
    }
    res.json(out);
  });

  r.get('/reports/summary', async (req, res) => {
    const ctx = requirePermission(req, 'reports.view');
    const { from, to } = reportRange(ctx, req.query as Record<string, unknown>);
    const start = from.startOf('day').toJSDate();
    const end = to.plus({ days: 1 }).startOf('day').toJSDate();
    const s = ctx.societyId;
    const tz = ctx.society.timezone;
    const [perDay, bySource, byCategory, byStatus, resolved, amenities, bookings, slots, occupied] = await Promise.all([
      Visit.aggregate<{ _id: string; n: number }>([
        { $match: { societyId: s, createdAt: { $gte: start, $lt: end } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } }, n: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Visit.aggregate<{ _id: string; n: number }>([{ $match: { societyId: s, createdAt: { $gte: start, $lt: end } } }, { $group: { _id: '$source', n: { $sum: 1 } } }]),
      Complaint.aggregate<{ _id: string; n: number }>([{ $match: { societyId: s, createdAt: { $gte: start, $lt: end } } }, { $group: { _id: '$category', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
      Complaint.aggregate<{ _id: string; n: number }>([{ $match: { societyId: s, createdAt: { $gte: start, $lt: end } } }, { $group: { _id: '$status', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
      Complaint.find({ societyId: s, resolvedAt: { $gte: start, $lt: end } }, { createdAt: 1, resolvedAt: 1 }).limit(5000).lean(),
      Amenity.find({ societyId: s }).lean(),
      Booking.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { societyId: s, status: 'confirmed', slotStart: { $gte: start, $lt: end } } }, { $group: { _id: '$amenityId', n: { $sum: 1 } } }]),
      ParkingSlot.countDocuments({ societyId: s, active: true }),
      ParkingAssignment.countDocuments({ societyId: s, active: true }),
    ]);
    // Fill empty days so charts show a continuous series.
    const days: CountByKey[] = [];
    for (let d = from; d <= to; d = d.plus({ days: 1 })) {
      const key = d.toISODate() ?? '';
      days.push({ key, count: perDay.find((p) => p._id === key)?.n ?? 0 });
    }
    const hours = resolved.filter((c) => c.resolvedAt).map((c) => ((c.resolvedAt as Date).getTime() - c.createdAt.getTime()) / 3_600_000);
    const dayCount = Math.round(to.diff(from, 'days').days) + 1;
    const report: ReportSummary = {
      range: { from: from.toISODate() ?? '', to: to.toISODate() ?? '' },
      visitorsPerDay: days,
      visitorsBySource: bySource.map((b) => ({ key: b._id, count: b.n })),
      complaintsByCategory: byCategory.map((b) => ({ key: b._id, count: b.n })),
      complaintsByStatus: byStatus.map((b) => ({ key: b._id, count: b.n })),
      averageResolutionHours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
      amenityUtilisation: amenities.map((a) => ({
        amenity: a.name,
        bookings: bookings.find((b) => String(b._id) === String(a._id))?.n ?? 0,
        capacitySlots: slotsForDay(a, from.toISODate() ?? '', tz).length * a.capacity * dayCount,
      })),
      parking: { slots, occupied },
    };
    res.json(report);
  });

  r.get('/reports/export', async (req, res) => {
    const ctx = requirePermission(req, 'reports.export');
    const kind = queryString(req.query.kind, 20);
    if (kind !== 'visits' && kind !== 'complaints' && kind !== 'bookings') throw badRequest('Choose visits, complaints or bookings');
    const { from, to } = reportRange(ctx, req.query as Record<string, unknown>);
    const start = from.startOf('day').toJSDate();
    const end = to.plus({ days: 1 }).startOf('day').toJSDate();
    const tz = ctx.society.timezone;
    const fmt = (d: Date | null | undefined) => (d ? DateTime.fromJSDate(d, { zone: tz }).toFormat('yyyy-LL-dd HH:mm') : '');
    const LIMIT = 20_000;
    let csv: string;
    let count: number;
    if (kind === 'visits') {
      const rows = await Visit.find({ societyId: ctx.societyId, createdAt: { $gte: start, $lt: end } }).sort({ createdAt: 1 }).limit(LIMIT).lean();
      count = rows.length;
      // Exports never carry full visitor phone numbers.
      csv = toCsv(
        ['Registered', 'Unit', 'Visitor', 'Phone (masked)', 'Purpose', 'Guests', 'Source', 'Status', 'Checked in', 'Checked out'],
        rows.map((v) => [fmt(v.createdAt), v.unitLabel, v.visitorName, maskPhone(v.visitorPhone) ?? '', v.purpose, v.guestCount, v.source, v.status, fmt(v.checkedInAt), fmt(v.checkedOutAt)]),
      );
    } else if (kind === 'complaints') {
      const rows = await Complaint.find({ societyId: ctx.societyId, createdAt: { $gte: start, $lt: end } }, { events: 0 }).sort({ number: 1 }).limit(LIMIT).lean();
      const names = await userNames(rows.flatMap((c) => [c.reporterId, c.assigneeUserId]));
      count = rows.length;
      csv = toCsv(
        ['Number', 'Created', 'Title', 'Category', 'Priority', 'Area', 'Unit', 'Status', 'Reporter', 'Assignee', 'Due', 'Resolved'],
        rows.map((c) => [c.number, fmt(c.createdAt), c.title, c.category, c.priority, c.area, c.unitLabel ?? '', c.status, summary(names, c.reporterId)?.name ?? '', summary(names, c.assigneeUserId)?.name ?? '', c.dueDate ?? '', fmt(c.resolvedAt)]),
      );
    } else {
      const rows = await Booking.find({ societyId: ctx.societyId, slotStart: { $gte: start, $lt: end } }).sort({ slotStart: 1 }).limit(LIMIT).lean();
      count = rows.length;
      csv = toCsv(
        ['Amenity', 'Slot start', 'Slot end', 'Unit', 'Status', 'Booked at', 'Cancelled at'],
        rows.map((b) => [b.amenityName, fmt(b.slotStart), fmt(b.slotEnd), b.unitLabel, b.status, fmt(b.createdAt), fmt(b.cancelledAt)]),
      );
    }
    await audit({ userId: ctx.userId, societyId: ctx.societyId, ip: ctx.ip }, 'reports.exported', { type: 'Report' }, `Exported ${kind} (${count} rows)`, { kind, from: from.toISODate() ?? '', to: to.toISODate() ?? '', rows: count });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}-${from.toISODate()}-to-${to.toISODate()}.csv"`);
    res.send(`\uFEFF${csv}`); // BOM so Excel opens UTF-8 correctly
  });

  r.get('/audit', async (req, res) => {
    const ctx = requirePermission(req, 'audit.view');
    const { page, pageSize } = pageParams(req.query);
    const filter: Record<string, unknown> = { societyId: ctx.societyId };
    const action = queryString(req.query.action, 40);
    if (action) filter.action = { $regex: `^${escapeRegex(action)}` };
    const q = queryString(req.query.q, 60);
    if (q) filter.summary = { $regex: escapeRegex(q), $options: 'i' };
    if (req.query.from || req.query.to) {
      const { from, to } = reportRange(ctx, req.query as Record<string, unknown>);
      filter.createdAt = { $gte: from.startOf('day').toJSDate(), $lt: to.plus({ days: 1 }).startOf('day').toJSDate() };
    }
    const [rows, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ items: await auditDtos(rows), page, pageSize, total } satisfies Paginated<AuditLogDto>);
  });

  return r;
}
