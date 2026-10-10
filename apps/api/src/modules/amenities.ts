import { Router } from 'express';
import type { Types } from 'mongoose';
import { DateTime } from 'luxon';
import {
  amenitySchema,
  bookingSchema,
  calendarDate,
  canCancelBooking,
  daysAhead,
  isSlotStart,
  slotsForDay,
  type AmenityDto,
  type BookingDto,
  type BookingStatus,
  type Paginated,
  type SlotAvailability,
} from '@smart-society/shared';
import { Amenity, Booking, SlotCounter, Unit, type AmenityLean } from '../models/index.js';
import { can, requireAnyPermission, requirePermission, type SocietyContext } from '../lib/context.js';
import { AppError, badRequest, conflict, isDuplicateKeyError, notFound } from '../lib/errors.js';
import { idParam, oid, parse, queryEnum, queryString } from '../lib/validate.js';
import { pageParams } from '../lib/pagination.js';
import { summary, userNames } from '../lib/dto.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notifications.js';
import { runtime } from '../services/runtime.js';
import { ownUnit } from './society.js';

type BookingLean = {
  _id: Types.ObjectId;
  amenityId: Types.ObjectId;
  amenityName: string;
  unitId: Types.ObjectId;
  unitLabel: string;
  slotStart: Date;
  slotEnd: Date;
  status: string;
  bookedBy: Types.ObjectId;
  cancelledAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  createdAt: Date;
};

const actor = (ctx: SocietyContext) => ({ userId: ctx.userId, societyId: ctx.societyId, ip: ctx.ip });

function amenityDto(a: AmenityLean): AmenityDto {
  return {
    id: String(a._id),
    name: a.name,
    description: a.description ?? '',
    location: a.location ?? null,
    openTime: a.openTime,
    closeTime: a.closeTime,
    slotMinutes: a.slotMinutes,
    capacity: a.capacity,
    maxAdvanceDays: a.maxAdvanceDays,
    maxActiveBookingsPerUnit: a.maxActiveBookingsPerUnit,
    cancellationCutoffHours: a.cancellationCutoffHours,
    active: a.active,
  };
}

async function bookingDtos(ctx: SocietyContext, rows: BookingLean[]): Promise<BookingDto[]> {
  const names = await userNames(rows.flatMap((b) => [b.bookedBy, b.cancelledBy]));
  const amenities = await Amenity.find({ _id: { $in: rows.map((b) => b.amenityId) } }, { cancellationCutoffHours: 1 }).lean();
  const now = runtime().now();
  const manager = can(ctx, 'amenities.manage');
  return rows.map((b) => {
    const cutoff = amenities.find((a) => String(a._id) === String(b.amenityId))?.cancellationCutoffHours ?? 0;
    const owns = String(b.unitId) === String(ctx.membership.unitId) && can(ctx, 'amenities.book');
    return {
      id: String(b._id),
      amenityId: String(b.amenityId),
      amenityName: b.amenityName,
      slotStart: b.slotStart.toISOString(),
      slotEnd: b.slotEnd.toISOString(),
      status: b.status as BookingStatus,
      unitLabel: b.unitLabel,
      bookedBy: summary(names, b.bookedBy) ?? { id: '', name: 'Unknown' },
      cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
      cancelledBy: summary(names, b.cancelledBy),
      createdAt: b.createdAt.toISOString(),
      canCancel: (owns || manager) && canCancelBooking({ status: b.status as BookingStatus, slotStart: b.slotStart, now, cutoffHours: cutoff, isManager: manager }).ok,
    };
  });
}

const CANCEL_MESSAGES = {
  already_cancelled: 'This booking is already cancelled',
  started: 'This slot has already started',
  past_cutoff: 'The cancellation window for this booking has passed',
} as const;

export function amenitiesRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const ctx = requirePermission(req, 'amenities.view');
    const filter: Record<string, unknown> = { societyId: ctx.societyId };
    if (!can(ctx, 'amenities.manage')) filter.active = true;
    const rows = await Amenity.find(filter).sort({ name: 1 }).lean<AmenityLean[]>();
    res.json(rows.map(amenityDto));
  });

  r.post('/', async (req, res) => {
    const ctx = requirePermission(req, 'amenities.manage');
    const input = parse(amenitySchema, req.body);
    try {
      const a = await Amenity.create({ ...input, location: input.location ?? null, societyId: ctx.societyId });
      await audit(actor(ctx), 'amenities.created', { type: 'Amenity', id: a._id }, `Created amenity ${a.name}`);
      res.status(201).json({ id: String(a._id) });
    } catch (e) {
      if (isDuplicateKeyError(e)) throw conflict('An amenity with that name already exists');
      throw e;
    }
  });

  r.patch('/:id', async (req, res) => {
    const ctx = requirePermission(req, 'amenities.manage');
    const id = idParam(req.params.id, 'Amenity');
    const input = parse(amenitySchema, req.body);
    const current = await Amenity.findOne({ _id: id, societyId: ctx.societyId });
    if (!current) throw notFound('Amenity');
    const scheduleChanged = current.openTime !== input.openTime || current.closeTime !== input.closeTime || current.slotMinutes !== input.slotMinutes;
    if (scheduleChanged && (await Booking.exists({ amenityId: id, status: 'confirmed', slotStart: { $gte: runtime().now() } }))) {
      throw conflict('Hours and slot length cannot change while future bookings exist. Cancel them or create a new amenity.');
    }
    current.set({ ...input, location: input.location ?? null });
    try {
      await current.save();
    } catch (e) {
      if (isDuplicateKeyError(e)) throw conflict('An amenity with that name already exists');
      throw e;
    }
    await audit(actor(ctx), 'amenities.updated', { type: 'Amenity', id }, `Updated amenity ${current.name}`, { active: input.active, capacity: input.capacity });
    res.status(204).end();
  });

  r.get('/:id/availability', async (req, res) => {
    const ctx = requirePermission(req, 'amenities.view');
    const id = idParam(req.params.id, 'Amenity');
    const date = parse(calendarDate, req.query.date);
    const a = await Amenity.findOne({ _id: id, societyId: ctx.societyId }).lean<AmenityLean>();
    if (!a || (!a.active && !can(ctx, 'amenities.manage'))) throw notFound('Amenity');
    const tz = ctx.society.timezone;
    const slots = slotsForDay(a, date, tz);
    const counters = await SlotCounter.find({ amenityId: id, slotStart: { $in: slots.map((s) => s.start) } }).lean();
    const mine = ctx.membership.unitId
      ? await Booking.find({ amenityId: id, unitId: ctx.membership.unitId, status: 'confirmed', slotStart: { $in: slots.map((s) => s.start) } }, { slotStart: 1 }).lean()
      : [];
    const now = runtime().now();
    const out: SlotAvailability[] = slots.map((s) => {
      const booked = counters.find((c) => c.slotStart.getTime() === s.start.getTime())?.count ?? 0;
      let reason: SlotAvailability['reason'] = null;
      if (!a.active) reason = 'inactive';
      else if (s.start.getTime() <= now.getTime()) reason = 'past';
      else if (daysAhead(s.start, now, tz) > a.maxAdvanceDays) reason = 'too_far';
      else if (booked >= a.capacity) reason = 'full';
      return {
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        booked,
        capacity: a.capacity,
        bookable: reason === null,
        reason,
        mine: mine.some((m) => m.slotStart.getTime() === s.start.getTime()),
      };
    });
    res.json(out);
  });

  // ---------------------------------------------------------------- bookings

  r.get('/bookings', async (req, res) => {
    const ctx = requireAnyPermission(req, 'amenities.book', 'bookings.viewAll');
    const { page, pageSize } = pageParams(req.query);
    const now = runtime().now();
    const filter: Record<string, unknown> = { societyId: ctx.societyId };
    if (!can(ctx, 'bookings.viewAll')) filter.unitId = ownUnit(ctx);
    const scope = queryEnum(req.query.scope, ['upcoming', 'past', 'all'] as const) ?? 'upcoming';
    if (scope === 'upcoming') {
      filter.slotEnd = { $gte: now };
      filter.status = 'confirmed';
    } else if (scope === 'past') filter.$or = [{ slotEnd: { $lt: now } }, { status: 'cancelled' }];
    const amenityId = queryString(req.query.amenityId, 24);
    if (amenityId) filter.amenityId = idParam(amenityId, 'Amenity');
    const date = queryString(req.query.date, 10);
    if (date) {
      const day = DateTime.fromISO(parse(calendarDate, date), { zone: ctx.society.timezone }).startOf('day');
      filter.slotStart = { $gte: day.toJSDate(), $lt: day.plus({ days: 1 }).toJSDate() };
    }
    const [rows, total] = await Promise.all([
      Booking.find(filter).sort({ slotStart: scope === 'upcoming' ? 1 : -1 }).skip((page - 1) * pageSize).limit(pageSize).lean<BookingLean[]>(),
      Booking.countDocuments(filter),
    ]);
    res.json({ items: await bookingDtos(ctx, rows), page, pageSize, total } satisfies Paginated<BookingDto>);
  });

  r.post('/bookings', async (req, res) => {
    const ctx = requirePermission(req, 'amenities.book');
    const input = parse(bookingSchema, req.body);
    const unitId = ownUnit(ctx);
    const a = await Amenity.findOne({ _id: oid(input.amenityId), societyId: ctx.societyId, active: true }).lean<AmenityLean>();
    if (!a) throw notFound('Amenity');
    const tz = ctx.society.timezone;
    const now = runtime().now();
    const start = input.slotStart;
    if (!isSlotStart(a, start, tz)) throw badRequest('That time is not one of the bookable slots');
    if (start.getTime() <= now.getTime()) throw badRequest('That slot has already started');
    if (daysAhead(start, now, tz) > a.maxAdvanceDays) throw badRequest(`You can book up to ${a.maxAdvanceDays} days ahead`);
    const activeForUnit = await Booking.countDocuments({ societyId: ctx.societyId, amenityId: a._id, unitId, status: 'confirmed', slotEnd: { $gt: now } });
    if (activeForUnit >= a.maxActiveBookingsPerUnit) {
      throw conflict(`Your household already has ${a.maxActiveBookingsPerUnit} upcoming ${a.name} booking(s)`, 'unit_limit');
    }
    const unit = await Unit.findById(unitId, { label: 1 }).lean();
    if (!unit) throw notFound('Unit');

    // Reserve capacity atomically. When the slot is full the filter matches nothing, the upsert
    // tries to insert a second counter for the same slot, and the unique index rejects it.
    try {
      await SlotCounter.findOneAndUpdate(
        { amenityId: a._id, slotStart: start, count: { $lt: a.capacity } },
        { $inc: { count: 1 }, $setOnInsert: { societyId: ctx.societyId } },
        { upsert: true, new: true },
      );
    } catch (e) {
      if (isDuplicateKeyError(e)) throw conflict('That slot is fully booked', 'slot_full');
      throw e;
    }
    const slotEnd = new Date(start.getTime() + a.slotMinutes * 60_000);
    let booking;
    try {
      booking = await Booking.create({
        societyId: ctx.societyId,
        amenityId: a._id,
        amenityName: a.name,
        unitId,
        unitLabel: unit.label,
        slotStart: start,
        slotEnd,
        bookedBy: ctx.userId,
      });
    } catch (e) {
      // Give the reserved capacity back before reporting the problem.
      await SlotCounter.updateOne({ amenityId: a._id, slotStart: start, count: { $gt: 0 } }, { $inc: { count: -1 } });
      if (isDuplicateKeyError(e)) throw conflict('Your household already holds this slot', 'already_booked');
      throw e;
    }
    await audit(actor(ctx), 'bookings.created', { type: 'Booking', id: booking._id }, `Booked ${a.name} for ${unit.label}`);
    await notify(ctx.societyId, [ctx.userId], {
      type: 'booking.confirmed',
      title: `${a.name} booked`,
      body: DateTime.fromJSDate(start, { zone: tz }).toFormat("ccc d LLL, HH:mm") + ` – ${DateTime.fromJSDate(slotEnd, { zone: tz }).toFormat('HH:mm')}`,
      link: '/app/amenities',
    });
    const [dto] = await bookingDtos(ctx, [booking.toObject() as unknown as BookingLean]);
    res.status(201).json(dto);
  });

  r.post('/bookings/:id/cancel', async (req, res) => {
    const ctx = requireAnyPermission(req, 'amenities.book', 'amenities.manage');
    const id = idParam(req.params.id, 'Booking');
    const manager = can(ctx, 'amenities.manage');
    const filter: Record<string, unknown> = { _id: id, societyId: ctx.societyId };
    if (!manager) filter.unitId = ownUnit(ctx);
    const b = await Booking.findOne(filter).lean<BookingLean>();
    if (!b) throw notFound('Booking');
    const a = await Amenity.findById(b.amenityId, { cancellationCutoffHours: 1 }).lean();
    const now = runtime().now();
    const verdict = canCancelBooking({ status: b.status as BookingStatus, slotStart: b.slotStart, now, cutoffHours: a?.cancellationCutoffHours ?? 0, isManager: manager });
    if (!verdict.ok) throw new AppError(409, verdict.reason, CANCEL_MESSAGES[verdict.reason]);
    const updated = await Booking.findOneAndUpdate(
      { _id: id, status: 'confirmed' },
      { $set: { status: 'cancelled', cancelledAt: now, cancelledBy: ctx.userId } },
      { new: true },
    ).lean<BookingLean>();
    if (!updated) throw new AppError(409, 'already_cancelled', CANCEL_MESSAGES.already_cancelled);
    // Release the capacity this booking held.
    await SlotCounter.updateOne({ amenityId: b.amenityId, slotStart: b.slotStart, count: { $gt: 0 } }, { $inc: { count: -1 } });
    await audit(actor(ctx), 'bookings.cancelled', { type: 'Booking', id }, `Cancelled ${b.amenityName} booking for ${b.unitLabel}`, { byManager: manager && String(b.bookedBy) !== String(ctx.userId) });
    if (String(b.bookedBy) !== String(ctx.userId)) {
      await notify(ctx.societyId, [b.bookedBy], {
        type: 'booking.cancelled',
        title: `${b.amenityName} booking cancelled`,
        body: `Your booking on ${DateTime.fromJSDate(b.slotStart, { zone: ctx.society.timezone }).toFormat("ccc d LLL, HH:mm")} was cancelled by the society office.`,
        link: '/app/amenities',
      });
    }
    const [dto] = await bookingDtos(ctx, [updated]);
    res.json(dto);
  });

  return r;
}
