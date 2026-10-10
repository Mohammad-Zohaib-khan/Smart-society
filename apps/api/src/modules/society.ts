import { Router } from 'express';
import type { Types } from 'mongoose';
import {
  ROLE_LABELS,
  SOCIETY_ROLES,
  UNIT_STATUSES,
  buildingSchema,
  bulkUnitsSchema,
  householdMemberSchema,
  inviteMemberSchema,
  roleRequiresUnit,
  unitSchema,
  updateMembershipSchema,
  updateSocietySettingsSchema,
  updateUnitSchema,
  type BuildingDto,
  type GateUnitDto,
  type HouseholdMemberDto,
  type MemberDto,
  type Paginated,
  type PendingInviteDto,
  type SocietyRole,
  type SocietySettings,
  type StaffOption,
  type UnitDto,
} from '@smart-society/shared';
import {
  Booking,
  Building,
  Complaint,
  HouseholdMember,
  Invite,
  Membership,
  Session,
  Unit,
  User,
  Vehicle,
  VisitorInvitation,
  type SocietyDoc,
} from '../models/index.js';
import { requireAnyPermission, requirePermission, requireSociety, type SocietyContext } from '../lib/context.js';
import { badRequest, conflict, forbidden, isDuplicateKeyError, notFound } from '../lib/errors.js';
import { escapeRegex, idParam, oid, parse, queryEnum, queryString } from '../lib/validate.js';
import { pageParams } from '../lib/pagination.js';
import { audit } from '../services/audit.js';
import { createInvite } from '../services/invites.js';
import { notify } from '../services/notifications.js';

const actor = (ctx: SocietyContext) => ({ userId: ctx.userId, societyId: ctx.societyId, ip: ctx.ip });

function settingsDto(s: SocietyDoc): SocietySettings {
  const vp = s.settings?.visitorPolicy;
  return {
    id: String(s._id),
    name: s.name,
    address: s.address,
    city: s.city,
    timezone: s.timezone,
    visitorPolicy: {
      walkInRequiresResidentApproval: vp?.walkInRequiresResidentApproval ?? true,
      invitationMaxDaysAhead: vp?.invitationMaxDaysAhead ?? 30,
      invitationMaxHours: vp?.invitationMaxHours ?? 24,
      visitorRetentionDays: vp?.visitorRetentionDays ?? 180,
    },
    complaintCategories: s.settings?.complaintCategories ?? [],
    workingHours: { start: s.settings?.workingHours?.start ?? '09:00', end: s.settings?.workingHours?.end ?? '18:00' },
  };
}

/** Resident unit, or 403 when the caller's membership has none. */
export function ownUnit(ctx: SocietyContext): Types.ObjectId {
  if (!ctx.membership.unitId) throw forbidden('Your membership is not linked to a unit');
  return ctx.membership.unitId;
}

async function unitDtos(societyId: Types.ObjectId, units: Array<{ _id: Types.ObjectId; buildingId: Types.ObjectId; number: string; label: string; floor: number; type?: string | null; status: string }>): Promise<UnitDto[]> {
  const buildingIds = [...new Set(units.map((u) => String(u.buildingId)))];
  const buildings = await Building.find({ societyId, _id: { $in: buildingIds } }, { code: 1 }).lean();
  const counts = await Membership.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { societyId, unitId: { $in: units.map((u) => u._id) }, status: 'active', role: 'resident' } },
    { $group: { _id: '$unitId', n: { $sum: 1 } } },
  ]);
  const bMap = new Map(buildings.map((b) => [String(b._id), b.code]));
  const cMap = new Map(counts.map((c) => [String(c._id), c.n]));
  return units.map((u) => ({
    id: String(u._id),
    buildingId: String(u.buildingId),
    buildingCode: bMap.get(String(u.buildingId)) ?? '',
    number: u.number,
    label: u.label,
    floor: u.floor,
    type: u.type ?? null,
    status: u.status as UnitDto['status'],
    residentCount: cMap.get(String(u._id)) ?? 0,
  }));
}

async function ensureAnotherAdmin(societyId: Types.ObjectId, excludingMembershipId: Types.ObjectId): Promise<void> {
  const others = await Membership.countDocuments({ societyId, role: 'admin', status: 'active', _id: { $ne: excludingMembershipId } });
  if (others === 0) throw conflict('A society must keep at least one active admin');
}

export function societyRouter(): Router {
  const r = Router();

  // ---------------------------------------------------------------- settings

  r.get('/settings', (req, res) => {
    const ctx = requireSociety(req);
    res.json(settingsDto(ctx.society));
  });

  r.put('/settings', async (req, res) => {
    const ctx = requirePermission(req, 'society.settings.manage');
    const input = parse(updateSocietySettingsSchema, req.body);
    const categories = [...new Set(input.complaintCategories)];
    ctx.society.set({
      name: input.name,
      address: input.address,
      'settings.visitorPolicy': input.visitorPolicy,
      'settings.complaintCategories': categories,
      'settings.workingHours': input.workingHours,
    });
    await ctx.society.save();
    await audit(actor(ctx), 'society.settings_updated', { type: 'Society', id: ctx.societyId }, 'Updated society settings', {
      walkInRequiresResidentApproval: input.visitorPolicy.walkInRequiresResidentApproval,
      visitorRetentionDays: input.visitorPolicy.visitorRetentionDays,
    });
    res.json(settingsDto(ctx.society));
  });

  // ---------------------------------------------------------------- buildings

  r.get('/buildings', async (req, res) => {
    const ctx = requireAnyPermission(req, 'structure.view', 'announcements.manage');
    const buildings = await Building.find({ societyId: ctx.societyId }).sort({ code: 1 }).lean();
    const counts = await Unit.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { societyId: ctx.societyId } },
      { $group: { _id: '$buildingId', n: { $sum: 1 } } },
    ]);
    const out: BuildingDto[] = buildings.map((b) => ({
      id: String(b._id),
      name: b.name,
      code: b.code,
      floors: b.floors,
      unitCount: counts.find((c) => String(c._id) === String(b._id))?.n ?? 0,
    }));
    res.json(out);
  });

  r.post('/buildings', async (req, res) => {
    const ctx = requirePermission(req, 'structure.manage');
    const input = parse(buildingSchema, req.body);
    try {
      const b = await Building.create({ ...input, societyId: ctx.societyId });
      await audit(actor(ctx), 'structure.building_created', { type: 'Building', id: b._id }, `Created building ${b.code}`);
      res.status(201).json({ id: String(b._id) });
    } catch (e) {
      if (isDuplicateKeyError(e)) throw conflict('A building with that code already exists');
      throw e;
    }
  });

  r.patch('/buildings/:id', async (req, res) => {
    const ctx = requirePermission(req, 'structure.manage');
    const id = idParam(req.params.id, 'Building');
    // The code is part of every unit label, so it is fixed after creation.
    const input = parse(buildingSchema.omit({ code: true }), req.body);
    const b = await Building.findOneAndUpdate({ _id: id, societyId: ctx.societyId }, { $set: input }, { new: true });
    if (!b) throw notFound('Building');
    await audit(actor(ctx), 'structure.building_updated', { type: 'Building', id }, `Updated building ${b.code}`);
    res.status(204).end();
  });

  r.delete('/buildings/:id', async (req, res) => {
    const ctx = requirePermission(req, 'structure.manage');
    const id = idParam(req.params.id, 'Building');
    if (await Unit.exists({ societyId: ctx.societyId, buildingId: id })) throw conflict('Remove the units in this building first');
    const b = await Building.findOneAndDelete({ _id: id, societyId: ctx.societyId });
    if (!b) throw notFound('Building');
    await audit(actor(ctx), 'structure.building_deleted', { type: 'Building', id }, `Deleted building ${b.code}`);
    res.status(204).end();
  });

  // ---------------------------------------------------------------- units

  r.get('/units', async (req, res) => {
    const ctx = requirePermission(req, 'structure.view');
    const { page, pageSize } = pageParams(req.query);
    const filter: Record<string, unknown> = { societyId: ctx.societyId };
    const buildingId = queryString(req.query.buildingId, 24);
    if (buildingId) filter.buildingId = idParam(buildingId, 'Building');
    const status = queryEnum(req.query.status, UNIT_STATUSES);
    if (status) filter.status = status;
    const q = queryString(req.query.q, 20);
    if (q) filter.label = { $regex: escapeRegex(q.toUpperCase()) };
    const [units, total] = await Promise.all([
      Unit.find(filter).sort({ label: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Unit.countDocuments(filter),
    ]);
    const out: Paginated<UnitDto> = { items: await unitDtos(ctx.societyId, units), page, pageSize, total };
    res.json(out);
  });

  r.post('/units', async (req, res) => {
    const ctx = requirePermission(req, 'structure.manage');
    const input = parse(unitSchema, req.body);
    const building = await Building.findOne({ _id: oid(input.buildingId), societyId: ctx.societyId });
    if (!building) throw notFound('Building');
    if (input.floor > building.floors) throw badRequest('Floor exceeds the building height', { floor: `This building has ${building.floors} floors` });
    try {
      const u = await Unit.create({ ...input, buildingId: building._id, label: `${building.code}-${input.number}`, societyId: ctx.societyId, type: input.type ?? null });
      await audit(actor(ctx), 'structure.unit_created', { type: 'Unit', id: u._id }, `Created unit ${u.label}`);
      res.status(201).json({ id: String(u._id) });
    } catch (e) {
      if (isDuplicateKeyError(e)) throw conflict('That unit number already exists in this building');
      throw e;
    }
  });

  r.post('/units/bulk', async (req, res) => {
    const ctx = requirePermission(req, 'structure.manage');
    const input = parse(bulkUnitsSchema, req.body);
    const building = await Building.findOne({ _id: oid(input.buildingId), societyId: ctx.societyId });
    if (!building) throw notFound('Building');
    if (input.toFloor > building.floors) throw badRequest('Floor exceeds the building height', { toFloor: `This building has ${building.floors} floors` });
    const docs = [];
    for (let floor = input.fromFloor; floor <= input.toFloor; floor++) {
      for (let n = 1; n <= input.unitsPerFloor; n++) {
        const number = `${floor}${String(n).padStart(2, '0')}`;
        docs.push({ societyId: ctx.societyId, buildingId: building._id, number, label: `${building.code}-${number}`, floor, status: 'vacant' });
      }
    }
    let created = 0;
    try {
      const result = await Unit.insertMany(docs, { ordered: false });
      created = result.length;
    } catch (e) {
      // Existing unit numbers are skipped; everything else is inserted.
      const inserted = (e as { insertedDocs?: unknown[] }).insertedDocs;
      if (!isDuplicateKeyError(e) && !Array.isArray(inserted)) throw e;
      created = Array.isArray(inserted) ? inserted.length : 0;
    }
    await audit(actor(ctx), 'structure.units_bulk_created', { type: 'Building', id: building._id }, `Generated ${created} units in ${building.code}`, { created });
    res.status(201).json({ created, skipped: docs.length - created });
  });

  r.patch('/units/:id', async (req, res) => {
    const ctx = requirePermission(req, 'structure.manage');
    const id = idParam(req.params.id, 'Unit');
    const input = parse(updateUnitSchema, req.body);
    const unit = await Unit.findOne({ _id: id, societyId: ctx.societyId });
    if (!unit) throw notFound('Unit');
    const building = await Building.findById(unit.buildingId);
    if (!building) throw notFound('Building');
    if (input.floor > building.floors) throw badRequest('Floor exceeds the building height', { floor: `This building has ${building.floors} floors` });
    if (input.status === 'vacant' && (await Membership.exists({ societyId: ctx.societyId, unitId: id, status: 'active', role: 'resident' }))) {
      throw conflict('Move residents out before marking the unit vacant');
    }
    unit.set({ number: input.number, label: `${building.code}-${input.number}`, floor: input.floor, type: input.type ?? null, status: input.status });
    try {
      await unit.save();
    } catch (e) {
      if (isDuplicateKeyError(e)) throw conflict('That unit number already exists in this building');
      throw e;
    }
    await audit(actor(ctx), 'structure.unit_updated', { type: 'Unit', id }, `Updated unit ${unit.label}`);
    res.status(204).end();
  });

  r.delete('/units/:id', async (req, res) => {
    const ctx = requirePermission(req, 'structure.manage');
    const id = idParam(req.params.id, 'Unit');
    const scope = { societyId: ctx.societyId, unitId: id };
    const inUse = await Promise.all([
      Membership.exists(scope),
      Vehicle.exists(scope),
      VisitorInvitation.exists(scope),
      Complaint.exists(scope),
      Booking.exists(scope),
    ]);
    if (inUse.some(Boolean)) throw conflict('This unit has history (members, vehicles, visits, complaints or bookings) and cannot be deleted');
    const unit = await Unit.findOneAndDelete({ _id: id, societyId: ctx.societyId });
    if (!unit) throw notFound('Unit');
    await audit(actor(ctx), 'structure.unit_deleted', { type: 'Unit', id }, `Deleted unit ${unit.label}`);
    res.status(204).end();
  });

  /** Minimal unit search for gate staff: labels only, no names or contact details. */
  r.get('/gate-units', async (req, res) => {
    const ctx = requirePermission(req, 'gate.operate');
    const q = queryString(req.query.q, 20);
    const filter: Record<string, unknown> = { societyId: ctx.societyId };
    if (q) filter.label = { $regex: escapeRegex(q.toUpperCase()) };
    const units = await Unit.find(filter, { label: 1 }).sort({ label: 1 }).limit(15).lean();
    const occupied = await Membership.distinct('unitId', { societyId: ctx.societyId, role: 'resident', status: 'active', unitId: { $in: units.map((u) => u._id) } });
    const occ = new Set(occupied.map(String));
    const out: GateUnitDto[] = units.map((u) => ({ id: String(u._id), label: u.label, hasActiveResidents: occ.has(String(u._id)) }));
    res.json(out);
  });

  // ---------------------------------------------------------------- members

  r.get('/members', async (req, res) => {
    const ctx = requirePermission(req, 'members.view');
    const { page, pageSize } = pageParams(req.query);
    const filter: Record<string, unknown> = { societyId: ctx.societyId };
    const role = queryEnum(req.query.role, SOCIETY_ROLES);
    if (role) filter.role = role;
    const status = queryEnum(req.query.status, ['active', 'suspended'] as const);
    if (status) filter.status = status;
    const q = queryString(req.query.q, 60);
    if (q) {
      const rx = { $regex: escapeRegex(q), $options: 'i' };
      const users = await User.find({ $or: [{ name: rx }, { email: rx }] }, { _id: 1 }).limit(500).lean();
      const units = await Unit.find({ societyId: ctx.societyId, label: { $regex: escapeRegex(q.toUpperCase()) } }, { _id: 1 }).lean();
      filter.$or = [{ userId: { $in: users.map((u) => u._id) } }, { unitId: { $in: units.map((u) => u._id) } }];
    }
    const [rows, total] = await Promise.all([
      Membership.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Membership.countDocuments(filter),
    ]);
    const users = await User.find({ _id: { $in: rows.map((m) => m.userId) } }, { name: 1, email: 1, phone: 1 }).lean();
    const units = await Unit.find({ _id: { $in: rows.map((m) => m.unitId).filter(Boolean) } }, { label: 1 }).lean();
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    const unitMap = new Map(units.map((u) => [String(u._id), u.label]));
    // Contact details are visible to admins only; the committee sees names and units.
    const showContact = ctx.role === 'admin';
    const items: MemberDto[] = rows.map((m) => {
      const u = uMap.get(String(m.userId));
      return {
        membershipId: String(m._id),
        userId: String(m.userId),
        name: u?.name ?? 'Unknown',
        email: showContact ? (u?.email ?? '') : '',
        phone: showContact ? (u?.phone ?? null) : null,
        role: m.role as SocietyRole,
        status: m.status as MemberDto['status'],
        unitId: m.unitId ? String(m.unitId) : null,
        unitLabel: m.unitId ? (unitMap.get(String(m.unitId)) ?? null) : null,
        joinedAt: m.createdAt.toISOString(),
      };
    });
    res.json({ items, page, pageSize, total } satisfies Paginated<MemberDto>);
  });

  r.patch('/members/:id', async (req, res) => {
    const ctx = requirePermission(req, 'members.manage');
    const id = idParam(req.params.id, 'Member');
    const input = parse(updateMembershipSchema, req.body);
    const m = await Membership.findOne({ _id: id, societyId: ctx.societyId });
    if (!m) throw notFound('Member');
    if (String(m._id) === String(ctx.membership.id) && (input.role !== undefined || input.status !== undefined)) {
      throw forbidden('You cannot change your own role or status');
    }
    const nextRole = (input.role ?? m.role) as SocietyRole;
    const nextUnit = input.unitId === undefined ? m.unitId : input.unitId ? oid(input.unitId) : null;
    if (nextUnit && !(await Unit.exists({ _id: nextUnit, societyId: ctx.societyId }))) throw notFound('Unit');
    if (roleRequiresUnit(nextRole) && !nextUnit) throw badRequest('Residents must be linked to a unit', { unitId: 'Choose a unit' });
    const losingAdmin = m.role === 'admin' && m.status === 'active' && (nextRole !== 'admin' || input.status === 'suspended');
    if (losingAdmin) await ensureAnotherAdmin(ctx.societyId, m._id);

    const before = { role: m.role, status: m.status, unit: m.unitId ? String(m.unitId) : null };
    m.set({ role: nextRole, unitId: roleRequiresUnit(nextRole) ? nextUnit : nextUnit ?? null, status: input.status ?? m.status });
    await m.save();
    if (nextUnit) await Unit.updateOne({ _id: nextUnit }, { $set: { status: 'occupied' } });
    if (input.status === 'suspended') {
      // Sessions pointing at a suspended membership fall back to the user's other societies.
      await Session.updateMany({ activeMembershipId: m._id }, { $set: { activeMembershipId: null } });
    }
    await audit(actor(ctx), 'members.updated', { type: 'Membership', id: m._id }, `Updated member (${before.role} → ${nextRole})`, {
      fromRole: before.role,
      toRole: nextRole,
      fromStatus: before.status,
      toStatus: m.status,
      unitChanged: before.unit !== (m.unitId ? String(m.unitId) : null),
    });
    await notify(ctx.societyId, [m.userId], {
      type: 'membership.updated',
      title: 'Your membership changed',
      body: `Your access is now ${ROLE_LABELS[nextRole]}${m.status === 'suspended' ? ' (suspended)' : ''}.`,
    });
    res.status(204).end();
  });

  r.get('/invites', async (req, res) => {
    const ctx = requirePermission(req, 'members.manage');
    const invites = await Invite.find({ societyId: ctx.societyId, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const units = await Unit.find({ _id: { $in: invites.map((i) => i.unitId).filter(Boolean) } }, { label: 1 }).lean();
    const uMap = new Map(units.map((u) => [String(u._id), u.label]));
    const out: PendingInviteDto[] = invites.map((i) => ({
      id: String(i._id),
      email: i.email,
      name: i.name,
      role: i.role as SocietyRole,
      unitLabel: i.unitId ? (uMap.get(String(i.unitId)) ?? null) : null,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));
    res.json(out);
  });

  r.post('/invites', async (req, res) => {
    const ctx = requirePermission(req, 'members.manage');
    const input = parse(inviteMemberSchema, req.body);
    const unitId = input.unitId ? oid(input.unitId) : null;
    if (unitId && !(await Unit.exists({ _id: unitId, societyId: ctx.societyId }))) throw notFound('Unit');
    const existingUser = await User.findOne({ email: input.email }, { _id: 1 }).lean();
    if (existingUser && (await Membership.exists({ userId: existingUser._id, societyId: ctx.societyId }))) {
      throw conflict('That person is already a member of this society');
    }
    const invite = await createInvite({
      societyId: ctx.societyId,
      email: input.email,
      name: input.name,
      role: input.role,
      unitId: roleRequiresUnit(input.role) ? unitId : null,
      createdBy: ctx.userId,
    });
    await audit(actor(ctx), 'members.invited', { type: 'Invite', id: oid(invite.inviteId) }, `Invited ${input.name} as ${ROLE_LABELS[input.role]}`, { role: input.role });
    res.status(201).json(invite);
  });

  r.delete('/invites/:id', async (req, res) => {
    const ctx = requirePermission(req, 'members.manage');
    const id = idParam(req.params.id, 'Invitation');
    const inv = await Invite.findOneAndUpdate({ _id: id, societyId: ctx.societyId, acceptedAt: null, revokedAt: null }, { $set: { revokedAt: new Date() } });
    if (!inv) throw notFound('Invitation');
    await audit(actor(ctx), 'members.invite_revoked', { type: 'Invite', id }, `Revoked invitation for ${inv.name}`);
    res.status(204).end();
  });

  r.get('/staff', async (req, res) => {
    const ctx = requirePermission(req, 'complaints.assign');
    const staff = await Membership.find({ societyId: ctx.societyId, role: 'staff', status: 'active' }).lean();
    const users = await User.find({ _id: { $in: staff.map((s) => s.userId) } }, { name: 1 }).lean();
    const load = await Complaint.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { societyId: ctx.societyId, assigneeMembershipId: { $in: staff.map((s) => s._id) }, status: { $in: ['assigned', 'in_progress', 'on_hold'] } } },
      { $group: { _id: '$assigneeMembershipId', n: { $sum: 1 } } },
    ]);
    const out: StaffOption[] = staff.map((s) => ({
      membershipId: String(s._id),
      name: users.find((u) => String(u._id) === String(s.userId))?.name ?? 'Unknown',
      openWorkOrders: load.find((l) => String(l._id) === String(s._id))?.n ?? 0,
    }));
    res.json(out.sort((a, b) => a.name.localeCompare(b.name)));
  });

  // ---------------------------------------------------------------- household

  r.get('/household', async (req, res) => {
    const ctx = requirePermission(req, 'household.manageOwn');
    const rows = await HouseholdMember.find({ societyId: ctx.societyId, unitId: ownUnit(ctx) }).sort({ createdAt: 1 }).lean();
    const out: HouseholdMemberDto[] = rows.map((h) => ({ id: String(h._id), name: h.name, relation: h.relation, phone: h.phone ?? null, isMinor: h.isMinor }));
    res.json(out);
  });

  r.post('/household', async (req, res) => {
    const ctx = requirePermission(req, 'household.manageOwn');
    const input = parse(householdMemberSchema, req.body);
    const unitId = ownUnit(ctx);
    if ((await HouseholdMember.countDocuments({ societyId: ctx.societyId, unitId })) >= 15) throw conflict('A household can list at most 15 members');
    const h = await HouseholdMember.create({ ...input, phone: input.phone ?? null, societyId: ctx.societyId, unitId, createdBy: ctx.userId });
    res.status(201).json({ id: String(h._id) });
  });

  r.patch('/household/:id', async (req, res) => {
    const ctx = requirePermission(req, 'household.manageOwn');
    const id = idParam(req.params.id, 'Household member');
    const input = parse(householdMemberSchema, req.body);
    const h = await HouseholdMember.findOneAndUpdate({ _id: id, societyId: ctx.societyId, unitId: ownUnit(ctx) }, { $set: { ...input, phone: input.phone ?? null } });
    if (!h) throw notFound('Household member');
    res.status(204).end();
  });

  r.delete('/household/:id', async (req, res) => {
    const ctx = requirePermission(req, 'household.manageOwn');
    const id = idParam(req.params.id, 'Household member');
    const h = await HouseholdMember.findOneAndDelete({ _id: id, societyId: ctx.societyId, unitId: ownUnit(ctx) });
    if (!h) throw notFound('Household member');
    res.status(204).end();
  });

  return r;
}

