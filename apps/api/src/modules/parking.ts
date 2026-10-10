import { Router } from 'express';
import type { Types } from 'mongoose';
import {
  SLOT_TYPES,
  assignParkingSchema,
  parkingSlotSchema,
  vehicleFitsSlot,
  vehicleRegistration,
  vehicleSchema,
  type GateVehicleLookup,
  type Paginated,
  type ParkingAssignmentDto,
  type ParkingSlotDto,
  type SlotType,
  type VehicleDto,
  type VehicleType,
} from '@smart-society/shared';
import { ParkingAssignment, ParkingSlot, Unit, Vehicle } from '../models/index.js';
import { can, requireAnyPermission, requirePermission, type SocietyContext } from '../lib/context.js';
import { badRequest, conflict, isDuplicateKeyError, notFound } from '../lib/errors.js';
import { escapeRegex, idParam, oid, parse, queryEnum, queryString } from '../lib/validate.js';
import { pageParams } from '../lib/pagination.js';
import { summary, userNames } from '../lib/dto.js';
import { audit } from '../services/audit.js';
import { activeResidentsOfUnit, notify } from '../services/notifications.js';
import { runtime } from '../services/runtime.js';
import { ownUnit } from './society.js';
import type { createLimiters } from '../middleware/rate-limit.js';

const actor = (ctx: SocietyContext) => ({ userId: ctx.userId, societyId: ctx.societyId, ip: ctx.ip });

type VehicleLean = {
  _id: Types.ObjectId;
  registrationNumber: string;
  type: string;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  unitId: Types.ObjectId;
};

async function vehicleDtos(societyId: Types.ObjectId, rows: VehicleLean[]): Promise<VehicleDto[]> {
  const units = await Unit.find({ _id: { $in: rows.map((v) => v.unitId) } }, { label: 1 }).lean();
  const assignments = await ParkingAssignment.find({ societyId, vehicleId: { $in: rows.map((v) => v._id) }, active: true }, { vehicleId: 1, slotId: 1 }).lean();
  const slots = await ParkingSlot.find({ _id: { $in: assignments.map((a) => a.slotId) } }, { code: 1 }).lean();
  return rows.map((v) => {
    const a = assignments.find((x) => String(x.vehicleId) === String(v._id));
    return {
      id: String(v._id),
      registrationNumber: v.registrationNumber,
      type: v.type as VehicleType,
      make: v.make ?? null,
      model: v.model ?? null,
      color: v.color ?? null,
      unitId: String(v.unitId),
      unitLabel: units.find((u) => String(u._id) === String(v.unitId))?.label ?? '',
      slotCode: a ? (slots.find((s) => String(s._id) === String(a.slotId))?.code ?? null) : null,
    };
  });
}

async function slotDtos(societyId: Types.ObjectId, slots: Array<{ _id: Types.ObjectId; code: string; type: string; level?: string | null; active: boolean }>): Promise<ParkingSlotDto[]> {
  const assignments = await ParkingAssignment.find({ societyId, slotId: { $in: slots.map((s) => s._id) }, active: true }).lean();
  const vehicles = await Vehicle.find({ _id: { $in: assignments.map((a) => a.vehicleId) } }, { registrationNumber: 1 }).lean();
  const units = await Unit.find({ _id: { $in: assignments.map((a) => a.unitId) } }, { label: 1 }).lean();
  return slots.map((s) => {
    const a = assignments.find((x) => String(x.slotId) === String(s._id));
    return {
      id: String(s._id),
      code: s.code,
      type: s.type as SlotType,
      level: s.level ?? null,
      active: s.active,
      assignment: a
        ? {
            id: String(a._id),
            vehicleId: String(a.vehicleId),
            registrationNumber: vehicles.find((v) => String(v._id) === String(a.vehicleId))?.registrationNumber ?? '',
            unitLabel: units.find((u) => String(u._id) === String(a.unitId))?.label ?? '',
            since: a.startedAt.toISOString(),
          }
        : null,
    };
  });
}

export function parkingRouter(limiters: ReturnType<typeof createLimiters>): Router {
  const r = Router();

  // ---------------------------------------------------------------- vehicles

  r.get('/vehicles', async (req, res) => {
    const ctx = requireAnyPermission(req, 'vehicles.manageOwn', 'vehicles.viewAll');
    const { page, pageSize } = pageParams(req.query);
    const filter: Record<string, unknown> = { societyId: ctx.societyId };
    if (!can(ctx, 'vehicles.viewAll')) filter.unitId = ownUnit(ctx);
    const q = queryString(req.query.q, 20);
    if (q) filter.registrationNumber = { $regex: escapeRegex(q.toUpperCase().replace(/[\s-]/g, '')) };
    const [rows, total] = await Promise.all([
      Vehicle.find(filter).sort({ registrationNumber: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean<VehicleLean[]>(),
      Vehicle.countDocuments(filter),
    ]);
    res.json({ items: await vehicleDtos(ctx.societyId, rows), page, pageSize, total } satisfies Paginated<VehicleDto>);
  });

  r.post('/vehicles', async (req, res) => {
    const ctx = requirePermission(req, 'vehicles.manageOwn');
    const input = parse(vehicleSchema, req.body);
    const unitId = ownUnit(ctx);
    if ((await Vehicle.countDocuments({ societyId: ctx.societyId, unitId })) >= 10) throw conflict('A unit can register at most 10 vehicles');
    try {
      const v = await Vehicle.create({
        ...input,
        make: input.make ?? null,
        model: input.model ?? null,
        color: input.color ?? null,
        societyId: ctx.societyId,
        unitId,
        createdBy: ctx.userId,
      });
      await audit(actor(ctx), 'vehicles.registered', { type: 'Vehicle', id: v._id }, `Registered vehicle ${v.registrationNumber}`);
      res.status(201).json({ id: String(v._id) });
    } catch (e) {
      if (isDuplicateKeyError(e)) throw conflict('That registration number is already registered in this society');
      throw e;
    }
  });

  r.patch('/vehicles/:id', async (req, res) => {
    const ctx = requirePermission(req, 'vehicles.manageOwn');
    const id = idParam(req.params.id, 'Vehicle');
    const input = parse(vehicleSchema, req.body);
    const filter = { _id: id, societyId: ctx.societyId, unitId: ownUnit(ctx) };
    const current = await Vehicle.findOne(filter);
    if (!current) throw notFound('Vehicle');
    if (input.type !== current.type && (await ParkingAssignment.exists({ vehicleId: id, active: true }))) {
      throw conflict('Release the parking slot before changing the vehicle type');
    }
    current.set({ ...input, make: input.make ?? null, model: input.model ?? null, color: input.color ?? null });
    try {
      await current.save();
    } catch (e) {
      if (isDuplicateKeyError(e)) throw conflict('That registration number is already registered in this society');
      throw e;
    }
    res.status(204).end();
  });

  r.delete('/vehicles/:id', async (req, res) => {
    const ctx = requireAnyPermission(req, 'vehicles.manageOwn', 'parking.manage');
    const id = idParam(req.params.id, 'Vehicle');
    const filter: Record<string, unknown> = { _id: id, societyId: ctx.societyId };
    if (!can(ctx, 'parking.manage')) filter.unitId = ownUnit(ctx);
    if (!(await Vehicle.exists(filter))) throw notFound('Vehicle');
    if (await ParkingAssignment.exists({ vehicleId: id, active: true })) throw conflict('Release the parking slot before removing this vehicle');
    const v = await Vehicle.findOneAndDelete(filter);
    if (v) await audit(actor(ctx), 'vehicles.removed', { type: 'Vehicle', id }, `Removed vehicle ${v.registrationNumber}`);
    res.status(204).end();
  });

  /** Gate lookup by registration: unit label and slot only. */
  r.get('/lookup/:registration', limiters.gateLookup, async (req, res) => {
    const ctx = requirePermission(req, 'vehicles.lookup');
    const reg = parse(vehicleRegistration, req.params.registration);
    const v = await Vehicle.findOne({ societyId: ctx.societyId, registrationNumber: reg }).lean<VehicleLean>();
    if (!v) throw notFound('Vehicle');
    const [dto] = await vehicleDtos(ctx.societyId, [v]);
    if (!dto) throw notFound('Vehicle');
    const out: GateVehicleLookup = { registrationNumber: dto.registrationNumber, unitLabel: dto.unitLabel, slotCode: dto.slotCode, type: dto.type };
    res.json(out);
  });

  // ---------------------------------------------------------------- slots

  r.get('/slots', async (req, res) => {
    const ctx = requirePermission(req, 'parking.manage');
    const filter: Record<string, unknown> = { societyId: ctx.societyId };
    const type = queryEnum(req.query.type, SLOT_TYPES);
    if (type) filter.type = type;
    const slots = await ParkingSlot.find(filter).sort({ code: 1 }).limit(2000).lean();
    let out = await slotDtos(ctx.societyId, slots);
    const occupancy = queryEnum(req.query.occupancy, ['free', 'occupied'] as const);
    if (occupancy) out = out.filter((s) => (occupancy === 'free' ? !s.assignment : Boolean(s.assignment)));
    res.json(out);
  });

  r.post('/slots', async (req, res) => {
    const ctx = requirePermission(req, 'parking.manage');
    const input = parse(parkingSlotSchema, req.body);
    try {
      const s = await ParkingSlot.create({ ...input, level: input.level ?? null, societyId: ctx.societyId });
      await audit(actor(ctx), 'parking.slot_created', { type: 'ParkingSlot', id: s._id }, `Created slot ${s.code}`);
      res.status(201).json({ id: String(s._id) });
    } catch (e) {
      if (isDuplicateKeyError(e)) throw conflict('A slot with that code already exists');
      throw e;
    }
  });

  r.patch('/slots/:id', async (req, res) => {
    const ctx = requirePermission(req, 'parking.manage');
    const id = idParam(req.params.id, 'Slot');
    const input = parse(parkingSlotSchema, req.body);
    const slot = await ParkingSlot.findOne({ _id: id, societyId: ctx.societyId });
    if (!slot) throw notFound('Slot');
    const occupied = await ParkingAssignment.exists({ slotId: id, active: true });
    if (occupied && (!input.active || input.type !== slot.type)) throw conflict('Release the slot before deactivating it or changing its type');
    slot.set({ ...input, level: input.level ?? null });
    try {
      await slot.save();
    } catch (e) {
      if (isDuplicateKeyError(e)) throw conflict('A slot with that code already exists');
      throw e;
    }
    await audit(actor(ctx), 'parking.slot_updated', { type: 'ParkingSlot', id }, `Updated slot ${slot.code}`, { active: slot.active });
    res.status(204).end();
  });

  r.delete('/slots/:id', async (req, res) => {
    const ctx = requirePermission(req, 'parking.manage');
    const id = idParam(req.params.id, 'Slot');
    if (await ParkingAssignment.exists({ slotId: id, societyId: ctx.societyId })) {
      throw conflict('This slot has assignment history; deactivate it instead of deleting');
    }
    const s = await ParkingSlot.findOneAndDelete({ _id: id, societyId: ctx.societyId });
    if (!s) throw notFound('Slot');
    await audit(actor(ctx), 'parking.slot_deleted', { type: 'ParkingSlot', id }, `Deleted slot ${s.code}`);
    res.status(204).end();
  });

  r.post('/slots/:id/assign', async (req, res) => {
    const ctx = requirePermission(req, 'parking.manage');
    const slotId = idParam(req.params.id, 'Slot');
    const { vehicleId } = parse(assignParkingSchema, req.body);
    const [slot, vehicle] = await Promise.all([
      ParkingSlot.findOne({ _id: slotId, societyId: ctx.societyId }),
      Vehicle.findOne({ _id: oid(vehicleId), societyId: ctx.societyId }),
    ]);
    if (!slot) throw notFound('Slot');
    if (!vehicle) throw notFound('Vehicle');
    if (!slot.active) throw conflict('This slot is inactive');
    if (!vehicleFitsSlot(vehicle.type as VehicleType, slot.type as SlotType)) {
      throw badRequest(`A ${vehicle.type.replace('_', ' ')} cannot use a ${slot.type.replace('_', ' ')} slot`);
    }
    try {
      // The partial unique indexes reject a second active assignment for the slot or vehicle,
      // even when two managers assign at the same moment.
      const a = await ParkingAssignment.create({
        societyId: ctx.societyId,
        slotId,
        vehicleId: vehicle._id,
        unitId: vehicle.unitId,
        startedAt: runtime().now(),
        assignedBy: ctx.userId,
      });
      await audit(actor(ctx), 'parking.assigned', { type: 'ParkingAssignment', id: a._id }, `Assigned ${slot.code} to ${vehicle.registrationNumber}`);
      await notify(ctx.societyId, await activeResidentsOfUnit(ctx.societyId, vehicle.unitId), {
        type: 'parking.assigned',
        title: `Parking slot ${slot.code} assigned`,
        body: `${vehicle.registrationNumber} now has slot ${slot.code}${slot.level ? ` (${slot.level})` : ''}.`,
        link: '/app/parking',
      });
      res.status(201).json({ id: String(a._id) });
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        const onVehicle = Boolean(e.keyPattern && 'vehicleId' in e.keyPattern);
        throw conflict(onVehicle ? 'This vehicle already has a slot. Release it first.' : 'This slot is already assigned', onVehicle ? 'vehicle_has_slot' : 'slot_occupied');
      }
      throw e;
    }
  });

  r.post('/slots/:id/release', async (req, res) => {
    const ctx = requirePermission(req, 'parking.manage');
    const slotId = idParam(req.params.id, 'Slot');
    const a = await ParkingAssignment.findOneAndUpdate(
      { slotId, societyId: ctx.societyId, active: true },
      { $set: { active: false, endedAt: runtime().now(), endedBy: ctx.userId } },
      { new: true },
    );
    if (!a) {
      if (!(await ParkingSlot.exists({ _id: slotId, societyId: ctx.societyId }))) throw notFound('Slot');
      throw conflict('This slot is not assigned');
    }
    const slot = await ParkingSlot.findById(slotId, { code: 1 }).lean();
    await audit(actor(ctx), 'parking.released', { type: 'ParkingAssignment', id: a._id }, `Released slot ${slot?.code ?? ''}`);
    await notify(ctx.societyId, await activeResidentsOfUnit(ctx.societyId, a.unitId), {
      type: 'parking.released',
      title: `Parking slot ${slot?.code ?? ''} released`,
      body: 'Your parking assignment has ended.',
      link: '/app/parking',
    });
    res.status(204).end();
  });

  r.get('/assignments', async (req, res) => {
    const ctx = requirePermission(req, 'parking.manage');
    const { page, pageSize } = pageParams(req.query);
    const filter = { societyId: ctx.societyId };
    const [rows, total] = await Promise.all([
      ParkingAssignment.find(filter).sort({ startedAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      ParkingAssignment.countDocuments(filter),
    ]);
    const [slots, vehicles, units, names] = await Promise.all([
      ParkingSlot.find({ _id: { $in: rows.map((a) => a.slotId) } }, { code: 1 }).lean(),
      Vehicle.find({ _id: { $in: rows.map((a) => a.vehicleId) } }, { registrationNumber: 1 }).lean(),
      Unit.find({ _id: { $in: rows.map((a) => a.unitId) } }, { label: 1 }).lean(),
      userNames(rows.flatMap((a) => [a.assignedBy, a.endedBy])),
    ]);
    const items: ParkingAssignmentDto[] = rows.map((a) => ({
      id: String(a._id),
      slotCode: slots.find((s) => String(s._id) === String(a.slotId))?.code ?? '(deleted)',
      registrationNumber: vehicles.find((v) => String(v._id) === String(a.vehicleId))?.registrationNumber ?? '(removed vehicle)',
      unitLabel: units.find((u) => String(u._id) === String(a.unitId))?.label ?? '',
      startedAt: a.startedAt.toISOString(),
      endedAt: a.endedAt ? a.endedAt.toISOString() : null,
      assignedBy: summary(names, a.assignedBy) ?? { id: '', name: 'Unknown' },
      endedBy: summary(names, a.endedBy),
    }));
    res.json({ items, page, pageSize, total } satisfies Paginated<ParkingAssignmentDto>);
  });

  return r;
}
