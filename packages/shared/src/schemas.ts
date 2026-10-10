/**
 * Request schemas shared by the API (authoritative validation) and the web forms
 * (instant feedback). Every object schema is strict so unknown keys are rejected,
 * which also blocks mass-assignment of server-owned fields.
 */
import { z } from 'zod';
import { SOCIETY_ROLES } from './roles.js';
import {
  ANNOUNCEMENT_PRIORITIES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  SLOT_TYPES,
  VEHICLE_TYPES,
  VISIT_PURPOSES,
} from './status.js';
import { CALENDAR_DATE, TIME_OF_DAY } from './schedule.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/** Indian & international numbers: digits with optional leading +, spaces or dashes. */
export const phone = z
  .string()
  .trim()
  .regex(/^\+?[\d\s-]{7,20}$/, 'Enter a valid phone number');
const optionalPhone = phone.optional().or(z.literal('').transform(() => undefined));

export const email = z.email('Enter a valid email address').trim().toLowerCase().max(254);

/** At least 10 characters with a letter and a digit — NIST-style length over composition. */
export const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

export const isoDateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
export const calendarDate = z.string().regex(CALENDAR_DATE, 'Use YYYY-MM-DD');
export const timeOfDay = z.string().regex(TIME_OF_DAY, 'Use HH:mm (24-hour)');

export const vehicleRegistration = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[\s-]+/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9]{4,12}$/, 'Use letters and digits only, e.g. MH12AB1234'));

// ------------------------------------------------------------------ auth & profile

export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });
export const acceptInviteSchema = z.strictObject({
  token: z.string().min(20).max(200),
  name: text(2, 80),
  password,
});
export const requestPasswordResetSchema = z.strictObject({ email });
export const resetPasswordSchema = z.strictObject({ token: z.string().min(20).max(200), password });
export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});
export const updateProfileSchema = z.strictObject({ name: text(2, 80), phone: optionalPhone });
export const switchSocietySchema = z.strictObject({ membershipId: objectId });
export const notificationPrefsSchema = z.strictObject({
  emailEnabled: z.boolean(),
  mutedTypes: z.array(z.string().max(60)).max(30),
});

// ------------------------------------------------------------------ platform

export const createSocietySchema = z.strictObject({
  name: text(3, 120),
  city: text(2, 80),
  address: text(5, 300),
  timezone: text(3, 60),
  adminName: text(2, 80),
  adminEmail: email,
});

// ------------------------------------------------------------------ society structure

export const updateSocietySettingsSchema = z.strictObject({
  name: text(3, 120),
  address: text(5, 300),
  visitorPolicy: z.strictObject({
    walkInRequiresResidentApproval: z.boolean(),
    invitationMaxDaysAhead: z.number().int().min(1).max(90),
    invitationMaxHours: z.number().int().min(1).max(72),
    visitorRetentionDays: z.number().int().min(7).max(730),
  }),
  complaintCategories: z.array(text(2, 40)).min(1).max(30),
  workingHours: z.strictObject({ start: timeOfDay, end: timeOfDay }),
});

export const buildingSchema = z.strictObject({
  name: text(1, 60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,10}$/, 'Use up to 10 letters, digits or dashes'),
  floors: z.number().int().min(1).max(200),
});

export const UNIT_STATUSES = ['occupied', 'vacant'] as const;
export const unitSchema = z.strictObject({
  buildingId: objectId,
  number: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,12}$/, 'Use up to 12 letters, digits or dashes'),
  floor: z.number().int().min(-5).max(200),
  type: optionalText(30),
  status: z.enum(UNIT_STATUSES),
});
export const updateUnitSchema = unitSchema.omit({ buildingId: true });

export const bulkUnitsSchema = z
  .strictObject({
    buildingId: objectId,
    fromFloor: z.number().int().min(0).max(200),
    toFloor: z.number().int().min(0).max(200),
    unitsPerFloor: z.number().int().min(1).max(30),
  })
  .refine((v) => v.toFloor >= v.fromFloor, { message: 'To floor must be ≥ from floor', path: ['toFloor'] })
  .refine((v) => (v.toFloor - v.fromFloor + 1) * v.unitsPerFloor <= 600, {
    message: 'At most 600 units per batch',
    path: ['unitsPerFloor'],
  });

export const inviteMemberSchema = z
  .strictObject({
    email,
    name: text(2, 80),
    role: z.enum(SOCIETY_ROLES),
    unitId: objectId.optional(),
  })
  .refine((v) => v.role !== 'resident' || v.unitId !== undefined, {
    message: 'Residents must be linked to a unit',
    path: ['unitId'],
  });

export const MEMBERSHIP_STATUSES = ['active', 'suspended'] as const;
export const updateMembershipSchema = z.strictObject({
  role: z.enum(SOCIETY_ROLES).optional(),
  unitId: objectId.nullable().optional(),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
});

export const HOUSEHOLD_RELATIONS = ['spouse', 'child', 'parent', 'sibling', 'relative', 'tenant', 'domestic_help', 'other'] as const;
export const householdMemberSchema = z.strictObject({
  name: text(2, 80),
  relation: z.enum(HOUSEHOLD_RELATIONS),
  phone: optionalPhone,
  isMinor: z.boolean(),
});

// ------------------------------------------------------------------ visitors

export const invitationSchema = z
  .strictObject({
    visitorName: text(2, 80),
    visitorPhone: optionalPhone,
    purpose: z.enum(VISIT_PURPOSES),
    validFrom: isoDateTime,
    validUntil: isoDateTime,
    guestCount: z.number().int().min(1).max(20),
    vehicleNumber: vehicleRegistration.optional().or(z.literal('').transform(() => undefined)),
    note: optionalText(300),
  })
  .refine((v) => v.validUntil.getTime() > v.validFrom.getTime(), {
    message: 'End must be after start',
    path: ['validUntil'],
  });

export const walkInSchema = z.strictObject({
  visitorName: text(2, 80),
  visitorPhone: optionalPhone,
  purpose: z.enum(VISIT_PURPOSES),
  unitId: objectId,
  guestCount: z.number().int().min(1).max(20),
  vehicleNumber: vehicleRegistration.optional().or(z.literal('').transform(() => undefined)),
});

export const residentDecisionSchema = z.strictObject({ decision: z.enum(['approve', 'deny']) });
export const guardDecisionSchema = z.strictObject({
  decision: z.enum(['approve', 'deny']),
  method: z.enum(['intercom', 'phone_call', 'in_person']),
  note: optionalText(200),
});
export const verifyPassSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/, 'Pass codes are 6 letters/digits'),
});

// ------------------------------------------------------------------ vehicles & parking

export const vehicleSchema = z.strictObject({
  registrationNumber: vehicleRegistration,
  type: z.enum(VEHICLE_TYPES),
  make: optionalText(40),
  model: optionalText(40),
  color: optionalText(30),
});

export const parkingSlotSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,12}$/, 'Use up to 12 letters, digits or dashes'),
  type: z.enum(SLOT_TYPES),
  level: optionalText(20),
  active: z.boolean(),
});
export const assignParkingSchema = z.strictObject({ vehicleId: objectId });

// ------------------------------------------------------------------ complaints

export const complaintSchema = z.strictObject({
  title: text(4, 120),
  description: text(10, 2000),
  category: text(2, 40),
  priority: z.enum(COMPLAINT_PRIORITIES),
  area: z.enum(['unit', 'common_area']),
});
export const assignComplaintSchema = z.strictObject({
  assigneeMembershipId: objectId,
  dueDate: calendarDate.optional(),
  priority: z.enum(COMPLAINT_PRIORITIES).optional(),
});
export const complaintStatusSchema = z.strictObject({
  status: z.enum(COMPLAINT_STATUSES),
  note: optionalText(1000),
});
export const complaintCommentSchema = z.strictObject({
  body: text(1, 2000),
  internal: z.boolean().default(false),
});

// ------------------------------------------------------------------ announcements

export const announcementSchema = z.strictObject({
  title: text(4, 140),
  body: text(10, 8000),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES),
  pinned: z.boolean(),
  audience: z.strictObject({
    roles: z.array(z.enum(SOCIETY_ROLES)).max(5),
    buildingIds: z.array(objectId).max(50),
  }),
  expiresAt: isoDateTime.optional().nullable(),
});

// ------------------------------------------------------------------ amenities

export const amenitySchema = z
  .strictObject({
    name: text(2, 60),
    description: text(0, 600),
    location: optionalText(80),
    openTime: timeOfDay,
    closeTime: timeOfDay,
    slotMinutes: z.number().int().min(15).max(720),
    capacity: z.number().int().min(1).max(200),
    maxAdvanceDays: z.number().int().min(0).max(90),
    maxActiveBookingsPerUnit: z.number().int().min(1).max(20),
    cancellationCutoffHours: z.number().int().min(0).max(168),
    active: z.boolean(),
  })
  .refine((v) => v.closeTime > v.openTime, { message: 'Closing must be after opening', path: ['closeTime'] });

export const bookingSchema = z.strictObject({ amenityId: objectId, slotStart: isoDateTime });

// ------------------------------------------------------------------ list queries

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type InvitationInput = z.input<typeof invitationSchema>;
export type WalkInInput = z.input<typeof walkInSchema>;
export type VehicleInput = z.input<typeof vehicleSchema>;
export type ComplaintInput = z.input<typeof complaintSchema>;
export type AnnouncementInput = z.input<typeof announcementSchema>;
export type AmenityInput = z.input<typeof amenitySchema>;
export type SettingsInput = z.input<typeof updateSocietySettingsSchema>;
