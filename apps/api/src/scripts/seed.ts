/**
 * DEMO DATA SEED — development and demonstration only.
 *
 *   npm run seed            create the demo society if it does not exist (idempotent)
 *   npm run seed -- --reset delete and recreate ONLY the demo society and demo accounts
 *
 * Everything created here is clearly labelled as demo data. Real societies are never touched:
 * the script only reads/writes records linked to the society flagged `isDemo: true` and the
 * demo user accounts on the reserved `@demo.smartsociety.invalid` domain (".invalid" can never
 * receive mail).
 */
import mongoose, { type Types } from 'mongoose';
import { DateTime } from 'luxon';
import { loadEnv } from '../config/env.js';
import { connectDatabase } from '../db.js';
import { hashPassword, passCode } from '../lib/crypto.js';
import {
  Amenity,
  Announcement,
  AnnouncementRead,
  AuditLog,
  Attachment,
  Booking,
  Building,
  Complaint,
  HouseholdMember,
  Invite,
  Membership,
  Notification,
  ParkingAssignment,
  ParkingSlot,
  Session,
  SlotCounter,
  Society,
  Unit,
  User,
  Vehicle,
  Visit,
  VisitorInvitation,
} from '../models/index.js';
import type { SocietyRole } from '@smart-society/shared';

const DEMO_DOMAIN = 'demo.smartsociety.invalid';
const DEMO_SOCIETY = 'Willow Grove Residences (Demo)';
const TZ = 'Asia/Kolkata';

async function resetDemo(): Promise<void> {
  const society = await Society.findOne({ isDemo: true, name: DEMO_SOCIETY });
  if (society) {
    const scoped = { societyId: society._id };
    await Promise.all(
      [Building, Unit, Membership, Invite, HouseholdMember, VisitorInvitation, Visit, Vehicle, ParkingSlot, ParkingAssignment, Complaint, Attachment, Announcement, AnnouncementRead, Amenity, SlotCounter, Booking, Notification, AuditLog].map(
        (m) => (m as unknown as mongoose.Model<unknown>).deleteMany(scoped),
      ),
    );
    await society.deleteOne();
  }
  const demoUsers = await User.find({ email: { $regex: `@${DEMO_DOMAIN.replace(/\./g, '\\.')}$` } }, { _id: 1 }).lean();
  const ids = demoUsers.map((u) => u._id);
  await Promise.all([Session.deleteMany({ userId: { $in: ids } }), Notification.deleteMany({ userId: { $in: ids } }), Membership.deleteMany({ userId: { $in: ids } })]);
  await User.deleteMany({ _id: { $in: ids } });
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data with NODE_ENV=production.');
  }
  const password = process.env.SEED_DEMO_PASSWORD ?? 'demo-pass-2026';
  await connectDatabase(env.MONGODB_URI);

  if (process.argv.includes('--reset')) {
    await resetDemo();
    console.log('Removed existing demo society and demo accounts.');
  } else if (await Society.exists({ isDemo: true, name: DEMO_SOCIETY })) {
    console.log('Demo society already exists — nothing to do. Use `npm run seed -- --reset` to recreate it.');
    await mongoose.disconnect();
    return;
  }

  const now = DateTime.now().setZone(TZ);
  const hash = await hashPassword(password);

  const society = await Society.create({
    name: DEMO_SOCIETY,
    city: 'Pune',
    address: 'Plot 14, Baner–Pashan Link Road, Pune 411045 (fictional demo address)',
    timezone: TZ,
    isDemo: true,
    settings: {
      visitorPolicy: { walkInRequiresResidentApproval: true, invitationMaxDaysAhead: 30, invitationMaxHours: 24, visitorRetentionDays: 180 },
      complaintCategories: ['Plumbing', 'Electrical', 'Housekeeping', 'Security', 'Lift', 'Garden', 'Other'],
      workingHours: { start: '09:00', end: '18:00' },
    },
  });
  const sid = society._id;

  // ------------------------------------------------------------- structure
  const towers = await Building.insertMany([
    { societyId: sid, name: 'Willow Tower', code: 'W', floors: 8 },
    { societyId: sid, name: 'Cedar Tower', code: 'C', floors: 6 },
  ]);
  const unitDocs = [];
  for (const b of towers) {
    for (let floor = 1; floor <= b.floors; floor++) {
      for (let n = 1; n <= 4; n++) {
        const number = `${floor}${String(n).padStart(2, '0')}`;
        unitDocs.push({ societyId: sid, buildingId: b._id, number, label: `${b.code}-${number}`, floor, type: n <= 2 ? '2 BHK' : '3 BHK', status: 'vacant' });
      }
    }
  }
  const units = await Unit.insertMany(unitDocs);
  const unit = (label: string) => {
    const u = units.find((x) => x.label === label);
    if (!u) throw new Error(`missing unit ${label}`);
    return u._id;
  };

  // ------------------------------------------------------------- people
  type Person = { key: string; name: string; role: SocietyRole | null; unit?: string; platform?: boolean };
  const people: Person[] = [
    { key: 'platform', name: 'Priya Platform (Demo)', role: null, platform: true },
    { key: 'admin', name: 'Anjali Deshmukh', role: 'admin' },
    { key: 'committee', name: 'Vikram Kulkarni', role: 'committee' },
    { key: 'guard', name: 'Ramesh Yadav', role: 'guard' },
    { key: 'guard2', name: 'Sunita Pawar', role: 'guard' },
    { key: 'resident', name: 'Neha Iyer', role: 'resident', unit: 'W-302' },
    { key: 'resident2', name: 'Arjun Mehta', role: 'resident', unit: 'W-501' },
    { key: 'resident3', name: 'Fatima Shaikh', role: 'resident', unit: 'C-204' },
    { key: 'resident4', name: 'Rahul Joshi', role: 'resident', unit: 'C-401' },
    { key: 'resident5', name: 'Kavya Nair', role: 'resident', unit: 'W-302' },
    { key: 'staff', name: 'Mahesh Patil', role: 'staff' },
    { key: 'staff2', name: 'Imran Qureshi', role: 'staff' },
  ];
  const users: Record<string, Types.ObjectId> = {};
  const memberships: Record<string, Types.ObjectId> = {};
  for (const p of people) {
    const user = await User.create({
      email: `${p.key}@${DEMO_DOMAIN}`,
      name: p.name,
      passwordHash: hash,
      isPlatformAdmin: Boolean(p.platform),
      phone: p.role === 'resident' ? `+91 90000 0${String(Object.keys(users).length).padStart(4, '0')}` : null,
    });
    users[p.key] = user._id;
    if (p.role) {
      const m = await Membership.create({ userId: user._id, societyId: sid, role: p.role, unitId: p.unit ? unit(p.unit) : null });
      memberships[p.key] = m._id;
      if (p.unit) await Unit.updateOne({ _id: unit(p.unit) }, { $set: { status: 'occupied' } });
    }
  }
  const uid = (k: string) => users[k] as Types.ObjectId;
  await HouseholdMember.insertMany([
    { societyId: sid, unitId: unit('W-302'), name: 'Aarav Iyer', relation: 'child', isMinor: true, createdBy: uid('resident') },
    { societyId: sid, unitId: unit('W-302'), name: 'Lakshmi Iyer', relation: 'parent', isMinor: false, createdBy: uid('resident') },
  ]);

  // ------------------------------------------------------------- vehicles & parking
  const vehicles = await Vehicle.insertMany([
    { societyId: sid, unitId: unit('W-302'), registrationNumber: 'MH12DE4521', type: 'car', make: 'Hyundai', model: 'Creta', color: 'White', createdBy: uid('resident') },
    { societyId: sid, unitId: unit('W-302'), registrationNumber: 'MH12QX0912', type: 'two_wheeler', make: 'Honda', model: 'Activa', color: 'Grey', createdBy: uid('resident') },
    { societyId: sid, unitId: unit('W-501'), registrationNumber: 'MH14EV2210', type: 'ev_car', make: 'Tata', model: 'Nexon EV', color: 'Teal', createdBy: uid('resident2') },
    { societyId: sid, unitId: unit('C-204'), registrationNumber: 'MH12GH7788', type: 'car', make: 'Maruti', model: 'Baleno', color: 'Red', createdBy: uid('resident3') },
  ]);
  const vehicleAt = (i: number) => {
    const v = vehicles[i];
    if (!v) throw new Error(`missing vehicle ${i}`);
    return v._id;
  };
  const slots = await ParkingSlot.insertMany([
    ...Array.from({ length: 10 }, (_, i) => ({ societyId: sid, code: `B1-${String(i + 1).padStart(2, '0')}`, type: 'car', level: 'Basement 1', active: true })),
    ...Array.from({ length: 4 }, (_, i) => ({ societyId: sid, code: `EV-${i + 1}`, type: 'ev', level: 'Basement 1', active: true })),
    ...Array.from({ length: 8 }, (_, i) => ({ societyId: sid, code: `TW-${String(i + 1).padStart(2, '0')}`, type: 'two_wheeler', level: 'Ground', active: true })),
    { societyId: sid, code: 'V-01', type: 'visitor', level: 'Ground', active: true },
  ]);
  const slot = (code: string) => slots.find((s) => s.code === code)?._id as Types.ObjectId;
  await ParkingAssignment.insertMany([
    { societyId: sid, slotId: slot('B1-03'), vehicleId: vehicleAt(0), unitId: unit('W-302'), startedAt: now.minus({ months: 5 }).toJSDate(), assignedBy: uid('admin') },
    { societyId: sid, slotId: slot('TW-02'), vehicleId: vehicleAt(1), unitId: unit('W-302'), startedAt: now.minus({ months: 5 }).toJSDate(), assignedBy: uid('admin') },
    { societyId: sid, slotId: slot('EV-1'), vehicleId: vehicleAt(2), unitId: unit('W-501'), startedAt: now.minus({ months: 2 }).toJSDate(), assignedBy: uid('admin') },
  ]);

  // ------------------------------------------------------------- visitors
  const today = now.startOf('day');
  await VisitorInvitation.insertMany([
    { societyId: sid, unitId: unit('W-302'), unitLabel: 'W-302', code: passCode(), visitorName: 'Sanjay Iyer', visitorPhone: '+91 98200 11111', purpose: 'guest', validFrom: today.plus({ hours: 9 }).toJSDate(), validUntil: today.plus({ hours: 22 }).toJSDate(), guestCount: 3, vehicleNumber: 'MH01AB2020', note: 'Family visiting for dinner', createdBy: uid('resident') },
    { societyId: sid, unitId: unit('W-501'), unitLabel: 'W-501', code: passCode(), visitorName: 'CoolAir Services', visitorPhone: '+91 98200 22222', purpose: 'service', validFrom: today.plus({ hours: 8 }).toJSDate(), validUntil: today.plus({ hours: 20 }).toJSDate(), guestCount: 2, createdBy: uid('resident2') },
    { societyId: sid, unitId: unit('C-204'), unitLabel: 'C-204', code: passCode(), visitorName: 'Zoya Shaikh', purpose: 'guest', validFrom: today.plus({ days: 2, hours: 10 }).toJSDate(), validUntil: today.plus({ days: 2, hours: 18 }).toJSDate(), guestCount: 1, createdBy: uid('resident3') },
  ]);
  // Two weeks of history for the reports (inserted with explicit timestamps).
  const history = [];
  const names = ['Swiggy delivery', 'Amazon courier', 'Urban Company', 'Ola driver', 'Relatives', 'Tutor', 'Electrician', 'Friend'];
  const purposes = ['delivery', 'delivery', 'service', 'cab', 'guest', 'guest', 'service', 'guest'];
  const hosts = ['W-302', 'W-501', 'C-204', 'C-401'];
  for (let d = 14; d >= 1; d--) {
    const count = 3 + ((d * 7) % 5);
    for (let i = 0; i < count; i++) {
      const at = today.minus({ days: d }).plus({ hours: 9 + ((i * 3) % 11), minutes: (i * 17) % 60 });
      const host = hosts[(d + i) % hosts.length] as string;
      const idx = (d + i) % names.length;
      const walkIn = i % 3 !== 0;
      history.push({
        societyId: sid,
        unitId: unit(host),
        unitLabel: host,
        source: walkIn ? 'walk_in' : 'invitation',
        visitorName: names[idx],
        visitorPhone: null,
        purpose: purposes[idx],
        guestCount: 1,
        vehicleNumber: null,
        status: 'checked_out',
        decision: { by: walkIn ? uid('guard') : uid('resident'), method: walkIn ? 'intercom' : 'pre_approved', outcome: 'approve', at: at.toJSDate() },
        registeredBy: uid(i % 2 ? 'guard' : 'guard2'),
        checkedInAt: at.toJSDate(),
        checkedInBy: uid('guard'),
        checkedOutAt: at.plus({ minutes: 20 + i * 7 }).toJSDate(),
        checkedOutBy: uid('guard'),
        anonymizedAt: null,
        createdAt: at.toJSDate(),
        updatedAt: at.plus({ minutes: 20 + i * 7 }).toJSDate(),
      });
    }
  }
  await Visit.collection.insertMany(history);
  await Visit.create({
    societyId: sid, unitId: unit('C-401'), unitLabel: 'C-401', source: 'walk_in', visitorName: 'Blue Dart courier', purpose: 'delivery', guestCount: 1,
    status: 'awaiting_approval', registeredBy: uid('guard'),
  });
  await Visit.create({
    societyId: sid, unitId: unit('W-501'), unitLabel: 'W-501', source: 'walk_in', visitorName: 'Plumber (Kumar)', purpose: 'service', guestCount: 1,
    status: 'inside', registeredBy: uid('guard'), decision: { by: uid('resident2'), method: 'resident_app', outcome: 'approve', at: now.minus({ minutes: 40 }).toJSDate() },
    checkedInAt: now.minus({ minutes: 40 }).toJSDate(), checkedInBy: uid('guard'),
  });

  // ------------------------------------------------------------- complaints
  const mk = (n: number, data: Record<string, unknown>, events: Record<string, unknown>[], createdDaysAgo: number) => {
    const created = now.minus({ days: createdDaysAgo });
    return {
      societyId: sid, number: n, events: events.map((e, i) => ({ ...e, at: created.plus({ hours: i * 6 }).toJSDate() })),
      createdAt: created.toJSDate(), updatedAt: created.plus({ hours: (events.length - 1) * 6 }).toJSDate(), ...data,
    };
  };
  const staffM = memberships.staff as Types.ObjectId;
  const staff2M = memberships.staff2 as Types.ObjectId;
  const complaints = [
    mk(1, { title: 'Bathroom ceiling seepage', description: 'Water stain spreading on the bathroom ceiling, likely from the unit above.', category: 'Plumbing', priority: 'high', area: 'unit', status: 'in_progress', unitId: unit('W-302'), unitLabel: 'W-302', reporterId: uid('resident'), assigneeMembershipId: staffM, assigneeUserId: uid('staff'), dueDate: today.plus({ days: 1 }).toISODate(), resolvedAt: null, closedAt: null },
      [{ kind: 'created', actorId: uid('resident'), toStatus: 'open' }, { kind: 'assigned', actorId: uid('admin'), fromStatus: 'open', toStatus: 'assigned', assigneeUserId: uid('staff') }, { kind: 'status', actorId: uid('staff'), fromStatus: 'assigned', toStatus: 'in_progress', body: 'Inspected from W-402; joint needs resealing.' }], 3),
    mk(2, { title: 'Lift B stops at floor 3', description: 'Cedar Tower lift jerks and stops at the third floor intermittently.', category: 'Lift', priority: 'urgent', area: 'common_area', status: 'open', unitId: unit('C-204'), unitLabel: 'C-204', reporterId: uid('resident3'), assigneeMembershipId: null, assigneeUserId: null, dueDate: null, resolvedAt: null, closedAt: null },
      [{ kind: 'created', actorId: uid('resident3'), toStatus: 'open' }], 0),
    mk(3, { title: 'Corridor light flickering', description: 'Tube light outside W-501 flickers all evening.', category: 'Electrical', priority: 'low', area: 'common_area', status: 'resolved', unitId: unit('W-501'), unitLabel: 'W-501', reporterId: uid('resident2'), assigneeMembershipId: staff2M, assigneeUserId: uid('staff2'), dueDate: today.minus({ days: 3 }).toISODate(), resolvedAt: now.minus({ days: 4 }).toJSDate(), closedAt: null },
      [{ kind: 'created', actorId: uid('resident2'), toStatus: 'open' }, { kind: 'assigned', actorId: uid('admin'), fromStatus: 'open', toStatus: 'assigned', assigneeUserId: uid('staff2') }, { kind: 'status', actorId: uid('staff2'), fromStatus: 'assigned', toStatus: 'in_progress' }, { kind: 'status', actorId: uid('staff2'), fromStatus: 'in_progress', toStatus: 'resolved', body: 'Replaced starter and tube.' }], 6),
    mk(4, { title: 'Garden sprinkler broken', description: 'Sprinkler near the children’s play area sprays onto the path.', category: 'Garden', priority: 'medium', area: 'common_area', status: 'assigned', unitId: unit('C-401'), unitLabel: 'C-401', reporterId: uid('resident4'), assigneeMembershipId: staff2M, assigneeUserId: uid('staff2'), dueDate: today.minus({ days: 1 }).toISODate(), resolvedAt: null, closedAt: null },
      [{ kind: 'created', actorId: uid('resident4'), toStatus: 'open' }, { kind: 'assigned', actorId: uid('admin'), fromStatus: 'open', toStatus: 'assigned', assigneeUserId: uid('staff2') }], 5),
    mk(5, { title: 'Stairwell needs cleaning', description: 'Wet leaves and dust collected in the Willow Tower stairwell.', category: 'Housekeeping', priority: 'low', area: 'common_area', status: 'closed', unitId: unit('W-302'), unitLabel: 'W-302', reporterId: uid('resident'), assigneeMembershipId: staffM, assigneeUserId: uid('staff'), dueDate: null, resolvedAt: now.minus({ days: 9 }).toJSDate(), closedAt: now.minus({ days: 8 }).toJSDate() },
      [{ kind: 'created', actorId: uid('resident'), toStatus: 'open' }, { kind: 'assigned', actorId: uid('admin'), fromStatus: 'open', toStatus: 'assigned', assigneeUserId: uid('staff') }, { kind: 'status', actorId: uid('staff'), fromStatus: 'assigned', toStatus: 'in_progress' }, { kind: 'status', actorId: uid('staff'), fromStatus: 'in_progress', toStatus: 'resolved', body: 'Swept and mopped.' }, { kind: 'status', actorId: uid('resident'), fromStatus: 'resolved', toStatus: 'closed' }], 11),
  ];
  await Complaint.collection.insertMany(complaints);
  await Society.updateOne({ _id: sid }, { $set: { complaintCounter: complaints.length } });

  // ------------------------------------------------------------- announcements
  const published = now.minus({ days: 1 }).toJSDate();
  await Announcement.insertMany([
    { societyId: sid, title: 'Water tank cleaning this Saturday', body: 'Overhead tanks in both towers will be cleaned on Saturday between 10:00 and 14:00. Please store water in advance. Supply resumes by 15:00.', priority: 'important', pinned: true, status: 'published', publishedAt: published, authorId: uid('admin'), audience: { roles: [], buildingIds: [] } },
    { societyId: sid, title: 'Diwali get-together in the clubhouse', body: 'Join neighbours for snacks, rangoli and music on the clubhouse lawn. Children’s rangoli contest at 18:00 — register with the office.', priority: 'normal', pinned: false, status: 'published', publishedAt: now.minus({ days: 3 }).toJSDate(), authorId: uid('committee'), audience: { roles: [], buildingIds: [] } },
    { societyId: sid, title: 'Gate shift handover checklist', body: 'Guards: record active visitors in the handover log and confirm the visitor parking count before each shift change.', priority: 'normal', pinned: false, status: 'published', publishedAt: now.minus({ days: 2 }).toJSDate(), authorId: uid('admin'), audience: { roles: ['guard'], buildingIds: [] } },
    { societyId: sid, title: 'Draft: AGM agenda', body: 'Agenda items for the annual general meeting — budget review, solar panel proposal, parking policy changes.', priority: 'normal', pinned: false, status: 'draft', authorId: uid('committee'), audience: { roles: [], buildingIds: [] } },
  ]);

  // ------------------------------------------------------------- amenities & bookings
  const [hall, court] = await Amenity.insertMany([
    { societyId: sid, name: 'Clubhouse Hall', description: 'Air-conditioned hall for gatherings of up to 60 people.', location: 'Clubhouse, ground floor', openTime: '09:00', closeTime: '22:00', slotMinutes: 180, capacity: 1, maxAdvanceDays: 30, maxActiveBookingsPerUnit: 1, cancellationCutoffHours: 24, active: true },
    { societyId: sid, name: 'Badminton Court', description: 'Indoor synthetic court with lights. Non-marking shoes only.', location: 'Clubhouse, first floor', openTime: '06:00', closeTime: '22:00', slotMinutes: 60, capacity: 2, maxAdvanceDays: 7, maxActiveBookingsPerUnit: 2, cancellationCutoffHours: 2, active: true },
    { societyId: sid, name: 'Swimming Pool', description: 'Lap pool. Lifeguard on duty 07:00–11:00 and 16:00–20:00.', location: 'Podium level', openTime: '06:00', closeTime: '21:00', slotMinutes: 60, capacity: 12, maxAdvanceDays: 3, maxActiveBookingsPerUnit: 2, cancellationCutoffHours: 1, active: true },
  ]);
  const book = async (amenity: typeof court, unitLabel: string, by: string, start: DateTime) => {
    if (!amenity) return;
    const startDate = start.toJSDate();
    await SlotCounter.updateOne({ amenityId: amenity._id, slotStart: startDate }, { $inc: { count: 1 }, $setOnInsert: { societyId: sid } }, { upsert: true });
    await Booking.create({ societyId: sid, amenityId: amenity._id, amenityName: amenity.name, unitId: unit(unitLabel), unitLabel, slotStart: startDate, slotEnd: start.plus({ minutes: amenity.slotMinutes }).toJSDate(), bookedBy: uid(by) });
  };
  await book(court, 'W-302', 'resident', today.plus({ days: 1, hours: 18 }));
  await book(court, 'C-204', 'resident3', today.plus({ days: 1, hours: 18 }));
  await book(hall, 'W-501', 'resident2', today.plus({ days: 5, hours: 18 }));

  await AuditLog.create({ societyId: sid, actorId: null, action: 'demo.seeded', targetType: 'Society', targetId: sid, summary: 'Demo data created by the seed script', metadata: { demo: true } });

  console.log('\nDemo data ready (DEVELOPMENT ONLY).');
  console.log(`Society: ${DEMO_SOCIETY}`);
  console.log(`Password for every demo account: ${password}`);
  for (const p of people) console.log(`  ${(p.role ?? 'platform admin').padEnd(15)} ${p.key}@${DEMO_DOMAIN}`);
  await mongoose.disconnect();
}

main().catch(async (err: unknown) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
