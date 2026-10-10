/**
 * Mongoose models. Every society-owned collection carries `societyId`, and every query in the
 * services filters by it. Uniqueness and "only one active X" rules are enforced with indexes so
 * concurrent requests cannot violate them.
 */
import mongoose, { Schema, type InferSchemaType, type HydratedDocument, type Types } from 'mongoose';
import {
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_STATUSES,
  BOOKING_STATUSES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  HOUSEHOLD_RELATIONS,
  INVITATION_STATUSES,
  MEMBERSHIP_STATUSES,
  NOTIFICATION_TYPES,
  SLOT_TYPES,
  SOCIETY_ROLES,
  UNIT_STATUSES,
  VEHICLE_TYPES,
  VISIT_PURPOSES,
  VISIT_STATUSES,
} from '@smart-society/shared';

const { ObjectId } = Schema.Types;
const opts = { timestamps: true, strict: true } as const;

mongoose.set('strictQuery', true);

// ------------------------------------------------------------------ identity

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: null },
    passwordHash: { type: String, required: true, select: false },
    isPlatformAdmin: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    notificationPrefs: {
      emailEnabled: { type: Boolean, default: false },
      mutedTypes: { type: [String], default: [] },
    },
  },
  opts,
);
userSchema.index({ email: 1 }, { unique: true });

const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true },
    csrfToken: { type: String, required: true },
    userId: { type: ObjectId, ref: 'User', required: true },
    activeMembershipId: { type: ObjectId, ref: 'Membership', default: null },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    userAgent: { type: String, default: null },
  },
  opts,
);
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const passwordResetSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  opts,
);
passwordResetSchema.index({ tokenHash: 1 }, { unique: true });
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });

// ------------------------------------------------------------------ society structure

const societySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    city: { type: String, required: true },
    address: { type: String, required: true },
    timezone: { type: String, required: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    isDemo: { type: Boolean, default: false },
    complaintCounter: { type: Number, default: 0 },
    settings: {
      visitorPolicy: {
        walkInRequiresResidentApproval: { type: Boolean, default: true },
        invitationMaxDaysAhead: { type: Number, default: 30 },
        invitationMaxHours: { type: Number, default: 24 },
        visitorRetentionDays: { type: Number, default: 180 },
      },
      complaintCategories: {
        type: [String],
        default: ['Plumbing', 'Electrical', 'Housekeeping', 'Security', 'Lift', 'Carpentry', 'Other'],
      },
      workingHours: {
        start: { type: String, default: '09:00' },
        end: { type: String, default: '18:00' },
      },
    },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  opts,
);
societySchema.index({ name: 1 });

const membershipSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    societyId: { type: ObjectId, ref: 'Society', required: true },
    role: { type: String, enum: SOCIETY_ROLES, required: true },
    unitId: { type: ObjectId, ref: 'Unit', default: null },
    status: { type: String, enum: MEMBERSHIP_STATUSES, default: 'active' },
    invitedBy: { type: ObjectId, ref: 'User', default: null },
  },
  opts,
);
membershipSchema.index({ userId: 1, societyId: 1 }, { unique: true });
membershipSchema.index({ societyId: 1, role: 1, status: 1 });
membershipSchema.index({ societyId: 1, unitId: 1, status: 1 });

const inviteSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    email: { type: String, required: true, lowercase: true },
    name: { type: String, required: true },
    role: { type: String, enum: SOCIETY_ROLES, required: true },
    unitId: { type: ObjectId, ref: 'Unit', default: null },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    createdBy: { type: ObjectId, ref: 'User', required: true },
  },
  opts,
);
inviteSchema.index({ tokenHash: 1 }, { unique: true });
inviteSchema.index({ societyId: 1, email: 1 });

const buildingSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    floors: { type: Number, required: true },
  },
  opts,
);
buildingSchema.index({ societyId: 1, code: 1 }, { unique: true });

const unitSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    buildingId: { type: ObjectId, ref: 'Building', required: true },
    number: { type: String, required: true },
    /** Denormalised "<building code>-<number>" for display and search. */
    label: { type: String, required: true },
    floor: { type: Number, required: true },
    type: { type: String, default: null },
    status: { type: String, enum: UNIT_STATUSES, default: 'vacant' },
  },
  opts,
);
unitSchema.index({ buildingId: 1, number: 1 }, { unique: true });
unitSchema.index({ societyId: 1, label: 1 });

const householdMemberSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    unitId: { type: ObjectId, ref: 'Unit', required: true },
    name: { type: String, required: true },
    relation: { type: String, enum: HOUSEHOLD_RELATIONS, required: true },
    phone: { type: String, default: null },
    isMinor: { type: Boolean, default: false },
    createdBy: { type: ObjectId, ref: 'User', required: true },
  },
  opts,
);
householdMemberSchema.index({ societyId: 1, unitId: 1 });

// ------------------------------------------------------------------ visitors

const invitationSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    unitId: { type: ObjectId, ref: 'Unit', required: true },
    unitLabel: { type: String, required: true },
    code: { type: String, required: true },
    visitorName: { type: String, required: true },
    visitorPhone: { type: String, default: null },
    purpose: { type: String, enum: VISIT_PURPOSES, required: true },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    guestCount: { type: Number, required: true },
    vehicleNumber: { type: String, default: null },
    note: { type: String, default: null },
    status: { type: String, enum: INVITATION_STATUSES, default: 'active' },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    usedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: ObjectId, ref: 'User', default: null },
    anonymizedAt: { type: Date, default: null },
  },
  opts,
);
invitationSchema.index({ societyId: 1, code: 1 }, { unique: true });
invitationSchema.index({ societyId: 1, status: 1, validFrom: 1 });
invitationSchema.index({ societyId: 1, unitId: 1, validFrom: -1 });

const visitSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    unitId: { type: ObjectId, ref: 'Unit', required: true },
    unitLabel: { type: String, required: true },
    source: { type: String, enum: ['invitation', 'walk_in'], required: true },
    invitationId: { type: ObjectId, ref: 'VisitorInvitation' },
    visitorName: { type: String, required: true },
    visitorPhone: { type: String, default: null },
    purpose: { type: String, enum: VISIT_PURPOSES, required: true },
    guestCount: { type: Number, required: true },
    vehicleNumber: { type: String, default: null },
    status: { type: String, enum: VISIT_STATUSES, required: true },
    decision: {
      type: new Schema(
        {
          by: { type: ObjectId, ref: 'User', default: null },
          method: { type: String, required: true },
          outcome: { type: String, enum: ['approve', 'deny'], required: true },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    registeredBy: { type: ObjectId, ref: 'User', required: true },
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: ObjectId, ref: 'User', default: null },
    checkedOutAt: { type: Date, default: null },
    checkedOutBy: { type: ObjectId, ref: 'User', default: null },
    anonymizedAt: { type: Date, default: null },
  },
  opts,
);
// One visit per invitation: makes double check-in impossible even under concurrency.
visitSchema.index({ invitationId: 1 }, { unique: true, partialFilterExpression: { invitationId: { $exists: true } } });
visitSchema.index({ societyId: 1, status: 1, createdAt: -1 });
visitSchema.index({ societyId: 1, unitId: 1, createdAt: -1 });

// ------------------------------------------------------------------ vehicles & parking

const vehicleSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    unitId: { type: ObjectId, ref: 'Unit', required: true },
    registrationNumber: { type: String, required: true },
    type: { type: String, enum: VEHICLE_TYPES, required: true },
    make: { type: String, default: null },
    model: { type: String, default: null },
    color: { type: String, default: null },
    createdBy: { type: ObjectId, ref: 'User', required: true },
  },
  opts,
);
vehicleSchema.index({ societyId: 1, registrationNumber: 1 }, { unique: true });
vehicleSchema.index({ societyId: 1, unitId: 1 });

const parkingSlotSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    code: { type: String, required: true },
    type: { type: String, enum: SLOT_TYPES, required: true },
    level: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  opts,
);
parkingSlotSchema.index({ societyId: 1, code: 1 }, { unique: true });

const parkingAssignmentSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    slotId: { type: ObjectId, ref: 'ParkingSlot', required: true },
    vehicleId: { type: ObjectId, ref: 'Vehicle', required: true },
    unitId: { type: ObjectId, ref: 'Unit', required: true },
    active: { type: Boolean, default: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    assignedBy: { type: ObjectId, ref: 'User', required: true },
    endedBy: { type: ObjectId, ref: 'User', default: null },
  },
  opts,
);
// A slot holds one vehicle and a vehicle holds one slot at a time.
parkingAssignmentSchema.index({ slotId: 1 }, { unique: true, partialFilterExpression: { active: true } });
parkingAssignmentSchema.index({ vehicleId: 1 }, { unique: true, partialFilterExpression: { active: true } });
parkingAssignmentSchema.index({ societyId: 1, startedAt: -1 });

// ------------------------------------------------------------------ complaints / work orders

const complaintEventSchema = new Schema(
  {
    kind: { type: String, enum: ['created', 'status', 'assigned', 'comment', 'attachment'], required: true },
    actorId: { type: ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true },
    fromStatus: { type: String, enum: COMPLAINT_STATUSES },
    toStatus: { type: String, enum: COMPLAINT_STATUSES },
    body: { type: String },
    internal: { type: Boolean },
    assigneeUserId: { type: ObjectId, ref: 'User' },
    attachmentId: { type: ObjectId, ref: 'Attachment' },
  },
  { _id: true },
);

const complaintSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    number: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    priority: { type: String, enum: COMPLAINT_PRIORITIES, required: true },
    area: { type: String, enum: ['unit', 'common_area'], required: true },
    status: { type: String, enum: COMPLAINT_STATUSES, default: 'open' },
    unitId: { type: ObjectId, ref: 'Unit', default: null },
    unitLabel: { type: String, default: null },
    reporterId: { type: ObjectId, ref: 'User', required: true },
    assigneeMembershipId: { type: ObjectId, ref: 'Membership', default: null },
    assigneeUserId: { type: ObjectId, ref: 'User', default: null },
    dueDate: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    events: { type: [complaintEventSchema], default: [] },
  },
  opts,
);
complaintSchema.index({ societyId: 1, number: 1 }, { unique: true });
complaintSchema.index({ societyId: 1, status: 1, priority: 1, createdAt: -1 });
complaintSchema.index({ societyId: 1, reporterId: 1, createdAt: -1 });
complaintSchema.index({ societyId: 1, assigneeUserId: 1, status: 1 });

const attachmentSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    ownerType: { type: String, enum: ['complaint'], required: true },
    ownerId: { type: ObjectId, required: true },
    storageKey: { type: String, required: true },
    fileName: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    purpose: { type: String, enum: ['report', 'completion'], required: true },
    uploadedBy: { type: ObjectId, ref: 'User', required: true },
  },
  opts,
);
attachmentSchema.index({ societyId: 1, ownerType: 1, ownerId: 1 });
attachmentSchema.index({ storageKey: 1 }, { unique: true });

// ------------------------------------------------------------------ announcements

const announcementSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    priority: { type: String, enum: ANNOUNCEMENT_PRIORITIES, default: 'normal' },
    pinned: { type: Boolean, default: false },
    status: { type: String, enum: ANNOUNCEMENT_STATUSES, default: 'draft' },
    audience: {
      roles: { type: [String], enum: SOCIETY_ROLES, default: [] },
      buildingIds: { type: [ObjectId], ref: 'Building', default: [] },
    },
    publishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    authorId: { type: ObjectId, ref: 'User', required: true },
    updatedBy: { type: ObjectId, ref: 'User', default: null },
  },
  opts,
);
announcementSchema.index({ societyId: 1, status: 1, pinned: -1, publishedAt: -1 });

const announcementReadSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    announcementId: { type: ObjectId, ref: 'Announcement', required: true },
    userId: { type: ObjectId, ref: 'User', required: true },
    readAt: { type: Date, required: true },
  },
  { timestamps: false },
);
announcementReadSchema.index({ announcementId: 1, userId: 1 }, { unique: true });
announcementReadSchema.index({ societyId: 1, userId: 1 });

// ------------------------------------------------------------------ amenities

const amenitySchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    location: { type: String, default: null },
    openTime: { type: String, required: true },
    closeTime: { type: String, required: true },
    slotMinutes: { type: Number, required: true },
    capacity: { type: Number, required: true },
    maxAdvanceDays: { type: Number, required: true },
    maxActiveBookingsPerUnit: { type: Number, required: true },
    cancellationCutoffHours: { type: Number, required: true },
    active: { type: Boolean, default: true },
  },
  opts,
);
amenitySchema.index({ societyId: 1, name: 1 }, { unique: true });

/** Per-slot occupancy counter; the conditional `$inc` upsert is what makes booking race-safe. */
const slotCounterSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    amenityId: { type: ObjectId, ref: 'Amenity', required: true },
    slotStart: { type: Date, required: true },
    count: { type: Number, required: true, min: 0 },
  },
  { timestamps: false },
);
slotCounterSchema.index({ amenityId: 1, slotStart: 1 }, { unique: true });

const bookingSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', required: true },
    amenityId: { type: ObjectId, ref: 'Amenity', required: true },
    amenityName: { type: String, required: true },
    unitId: { type: ObjectId, ref: 'Unit', required: true },
    unitLabel: { type: String, required: true },
    slotStart: { type: Date, required: true },
    slotEnd: { type: Date, required: true },
    status: { type: String, enum: BOOKING_STATUSES, default: 'confirmed' },
    bookedBy: { type: ObjectId, ref: 'User', required: true },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: ObjectId, ref: 'User', default: null },
  },
  opts,
);
// A household cannot hold the same slot twice.
bookingSchema.index(
  { amenityId: 1, slotStart: 1, unitId: 1 },
  { unique: true, partialFilterExpression: { status: 'confirmed' } },
);
bookingSchema.index({ societyId: 1, slotStart: 1 });
bookingSchema.index({ societyId: 1, unitId: 1, status: 1, slotStart: 1 });

// ------------------------------------------------------------------ notifications & audit

const notificationSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', default: null },
    userId: { type: ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    link: { type: String, default: null },
    readAt: { type: Date, default: null },
  },
  opts,
);
notificationSchema.index({ userId: 1, societyId: 1, readAt: 1, createdAt: -1 });

const auditLogSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: 'Society', default: null },
    actorId: { type: ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: ObjectId, default: null },
    summary: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ societyId: 1, createdAt: -1 });
auditLogSchema.index({ societyId: 1, action: 1, createdAt: -1 });

// ------------------------------------------------------------------ exports

export const User = mongoose.model('User', userSchema);
export const Session = mongoose.model('Session', sessionSchema);
export const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);
export const Society = mongoose.model('Society', societySchema);
export const Membership = mongoose.model('Membership', membershipSchema);
export const Invite = mongoose.model('Invite', inviteSchema);
export const Building = mongoose.model('Building', buildingSchema);
export const Unit = mongoose.model('Unit', unitSchema);
export const HouseholdMember = mongoose.model('HouseholdMember', householdMemberSchema);
export const VisitorInvitation = mongoose.model('VisitorInvitation', invitationSchema);
export const Visit = mongoose.model('Visit', visitSchema);
export const Vehicle = mongoose.model('Vehicle', vehicleSchema);
export const ParkingSlot = mongoose.model('ParkingSlot', parkingSlotSchema);
export const ParkingAssignment = mongoose.model('ParkingAssignment', parkingAssignmentSchema);
export const Complaint = mongoose.model('Complaint', complaintSchema);
export const Attachment = mongoose.model('Attachment', attachmentSchema);
export const Announcement = mongoose.model('Announcement', announcementSchema);
export const AnnouncementRead = mongoose.model('AnnouncementRead', announcementReadSchema);
export const Amenity = mongoose.model('Amenity', amenitySchema);
export const SlotCounter = mongoose.model('SlotCounter', slotCounterSchema);
export const Booking = mongoose.model('Booking', bookingSchema);
export const Notification = mongoose.model('Notification', notificationSchema);
export const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export type SessionDoc = HydratedDocument<InferSchemaType<typeof sessionSchema>>;
export type SocietyDoc = HydratedDocument<InferSchemaType<typeof societySchema>>;
export type MembershipDoc = HydratedDocument<InferSchemaType<typeof membershipSchema>>;
export type ComplaintDoc = HydratedDocument<InferSchemaType<typeof complaintSchema>>;
export type ComplaintEventLean = InferSchemaType<typeof complaintEventSchema> & { _id: Types.ObjectId };
export type ComplaintLean = Omit<InferSchemaType<typeof complaintSchema>, 'events'> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  events: ComplaintEventLean[];
};
export type AmenityDoc = HydratedDocument<InferSchemaType<typeof amenitySchema>>;
export type AmenityLean = InferSchemaType<typeof amenitySchema> & { _id: Types.ObjectId };

export const ALL_MODELS = [
  User,
  Session,
  PasswordReset,
  Society,
  Membership,
  Invite,
  Building,
  Unit,
  HouseholdMember,
  VisitorInvitation,
  Visit,
  Vehicle,
  ParkingSlot,
  ParkingAssignment,
  Complaint,
  Attachment,
  Announcement,
  AnnouncementRead,
  Amenity,
  SlotCounter,
  Booking,
  Notification,
  AuditLog,
] as const;
