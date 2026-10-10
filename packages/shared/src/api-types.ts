/** Response shapes returned by the API. Dates are ISO strings on the wire. */
import type { Permission, SocietyRole } from './roles.js';
import type {
  AnnouncementPriority,
  AnnouncementStatus,
  BookingStatus,
  ComplaintPriority,
  ComplaintStatus,
  InvitationStatus,
  NotificationType,
  SlotType,
  VehicleType,
  VisitPurpose,
  VisitStatus,
} from './status.js';

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface UserSummary {
  id: string;
  name: string;
}

// ------------------------------------------------------------------ session

export interface MembershipSummary {
  id: string;
  role: SocietyRole;
  societyId: string;
  societyName: string;
  unitId: string | null;
  unitLabel: string | null;
}

export interface SessionInfo {
  user: { id: string; name: string; email: string; phone: string | null; isPlatformAdmin: boolean };
  membership: (MembershipSummary & { timezone: string }) | null;
  memberships: MembershipSummary[];
  permissions: Permission[];
  notificationPrefs: { emailEnabled: boolean; mutedTypes: string[] };
}

// ------------------------------------------------------------------ platform

export interface SocietyOverview {
  id: string;
  name: string;
  city: string;
  timezone: string;
  status: 'active' | 'suspended';
  createdAt: string;
  counts: { buildings: number; units: number; members: number };
}

export interface CreatedInvite {
  inviteId: string;
  /** Present only when no email provider delivered it, so the admin can share it manually. */
  acceptUrl: string | null;
  emailDelivered: boolean;
  expiresAt: string;
}

// ------------------------------------------------------------------ society

export interface SocietySettings {
  id: string;
  name: string;
  address: string;
  city: string;
  timezone: string;
  visitorPolicy: {
    walkInRequiresResidentApproval: boolean;
    invitationMaxDaysAhead: number;
    invitationMaxHours: number;
    visitorRetentionDays: number;
  };
  complaintCategories: string[];
  workingHours: { start: string; end: string };
}

export interface BuildingDto {
  id: string;
  name: string;
  code: string;
  floors: number;
  unitCount: number;
}

export interface UnitDto {
  id: string;
  buildingId: string;
  buildingCode: string;
  number: string;
  label: string;
  floor: number;
  type: string | null;
  status: 'occupied' | 'vacant';
  residentCount: number;
}

/** Minimal unit view for guards: no names or phone numbers. */
export interface GateUnitDto {
  id: string;
  label: string;
  hasActiveResidents: boolean;
}

export interface MemberDto {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  role: SocietyRole;
  status: 'active' | 'suspended';
  unitId: string | null;
  unitLabel: string | null;
  joinedAt: string;
}

export interface PendingInviteDto {
  id: string;
  email: string;
  name: string;
  role: SocietyRole;
  unitLabel: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface HouseholdMemberDto {
  id: string;
  name: string;
  relation: string;
  phone: string | null;
  isMinor: boolean;
}

export interface StaffOption {
  membershipId: string;
  name: string;
  openWorkOrders: number;
}

// ------------------------------------------------------------------ visitors

export interface InvitationDto {
  id: string;
  code: string;
  visitorName: string;
  visitorPhone: string | null;
  purpose: VisitPurpose;
  validFrom: string;
  validUntil: string;
  guestCount: number;
  vehicleNumber: string | null;
  note: string | null;
  status: InvitationStatus;
  unitLabel: string;
  createdBy: UserSummary;
  createdAt: string;
}

export interface VisitDto {
  id: string;
  source: 'invitation' | 'walk_in';
  status: VisitStatus;
  visitorName: string;
  /** Masked unless the viewer is the host unit or an admin. */
  visitorPhone: string | null;
  purpose: VisitPurpose;
  guestCount: number;
  vehicleNumber: string | null;
  unitId: string;
  unitLabel: string;
  decision: { by: UserSummary | null; method: string; at: string; outcome: 'approve' | 'deny' } | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  checkedInBy: UserSummary | null;
  checkedOutBy: UserSummary | null;
  createdAt: string;
}

export interface PassVerification {
  invitation: Pick<
    InvitationDto,
    'id' | 'code' | 'visitorName' | 'purpose' | 'validFrom' | 'validUntil' | 'guestCount' | 'vehicleNumber' | 'unitLabel'
  >;
  checkIn: { ok: true } | { ok: false; reason: 'not_yet_valid' | 'expired' | 'cancelled' | 'already_used' };
}

export interface GateBoard {
  expectedToday: PassVerification['invitation'][];
  awaitingApproval: VisitDto[];
  inside: VisitDto[];
}

// ------------------------------------------------------------------ vehicles & parking

export interface VehicleDto {
  id: string;
  registrationNumber: string;
  type: VehicleType;
  make: string | null;
  model: string | null;
  color: string | null;
  unitId: string;
  unitLabel: string;
  slotCode: string | null;
}

export interface ParkingSlotDto {
  id: string;
  code: string;
  type: SlotType;
  level: string | null;
  active: boolean;
  assignment: {
    id: string;
    vehicleId: string;
    registrationNumber: string;
    unitLabel: string;
    since: string;
  } | null;
}

export interface ParkingAssignmentDto {
  id: string;
  slotCode: string;
  registrationNumber: string;
  unitLabel: string;
  startedAt: string;
  endedAt: string | null;
  assignedBy: UserSummary;
  endedBy: UserSummary | null;
}

export interface GateVehicleLookup {
  registrationNumber: string;
  unitLabel: string;
  slotCode: string | null;
  type: VehicleType;
}

// ------------------------------------------------------------------ complaints

export interface ComplaintEventDto {
  id: string;
  kind: 'created' | 'status' | 'assigned' | 'comment' | 'attachment';
  actor: UserSummary;
  at: string;
  fromStatus?: ComplaintStatus;
  toStatus?: ComplaintStatus;
  body?: string;
  internal?: boolean;
  assignee?: UserSummary;
  attachmentId?: string;
}

export interface AttachmentDto {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  purpose: 'report' | 'completion';
  uploadedBy: UserSummary;
  createdAt: string;
}

export interface ComplaintDto {
  id: string;
  number: number;
  title: string;
  description: string;
  category: string;
  priority: ComplaintPriority;
  area: 'unit' | 'common_area';
  status: ComplaintStatus;
  unitLabel: string | null;
  reporter: UserSummary;
  assignee: UserSummary | null;
  dueDate: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Transitions the current viewer may perform right now. */
  allowedTransitions: ComplaintStatus[];
  canAssign: boolean;
  canComment: boolean;
}

export interface ComplaintDetailDto extends ComplaintDto {
  events: ComplaintEventDto[];
  attachments: AttachmentDto[];
}

// ------------------------------------------------------------------ announcements

export interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  pinned: boolean;
  status: AnnouncementStatus;
  audience: { roles: SocietyRole[]; buildingIds: string[] };
  publishedAt: string | null;
  expiresAt: string | null;
  author: UserSummary;
  createdAt: string;
  read: boolean;
  /** Only for managers. */
  readStats?: { read: number; audience: number };
}

// ------------------------------------------------------------------ amenities

export interface AmenityDto {
  id: string;
  name: string;
  description: string;
  location: string | null;
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  capacity: number;
  maxAdvanceDays: number;
  maxActiveBookingsPerUnit: number;
  cancellationCutoffHours: number;
  active: boolean;
}

export interface SlotAvailability {
  start: string;
  end: string;
  booked: number;
  capacity: number;
  bookable: boolean;
  reason: 'full' | 'past' | 'too_far' | 'inactive' | null;
  /** True when the viewer's unit already holds this slot. */
  mine: boolean;
}

export interface BookingDto {
  id: string;
  amenityId: string;
  amenityName: string;
  slotStart: string;
  slotEnd: string;
  status: BookingStatus;
  unitLabel: string;
  bookedBy: UserSummary;
  cancelledAt: string | null;
  cancelledBy: UserSummary | null;
  createdAt: string;
  canCancel: boolean;
}

// ------------------------------------------------------------------ notifications & audit

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ChannelStatus {
  channel: 'in_app' | 'email' | 'sms' | 'whatsapp' | 'push';
  state: 'active' | 'console_dev' | 'not_configured';
  detail: string;
}

export interface AuditLogDto {
  id: string;
  action: string;
  actor: UserSummary | null;
  targetType: string;
  targetId: string | null;
  summary: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

// ------------------------------------------------------------------ dashboards & reports

export interface CountByKey {
  key: string;
  count: number;
}

export interface AdminDashboard {
  units: { total: number; occupied: number };
  members: number;
  complaints: { open: number; urgentOpen: number; overdue: number; byStatus: CountByKey[] };
  visitors: { expectedToday: number; inside: number; awaitingApproval: number };
  bookingsToday: number;
  parking: { slots: number; occupied: number };
  recentActivity: AuditLogDto[];
}

export interface ResidentDashboard {
  unitLabel: string | null;
  upcomingInvitations: InvitationDto[];
  visitsAwaitingMe: VisitDto[];
  insideNow: VisitDto[];
  openComplaints: ComplaintDto[];
  upcomingBookings: BookingDto[];
  pinnedAnnouncements: AnnouncementDto[];
  unreadNotifications: number;
}

export interface StaffDashboard {
  assigned: number;
  inProgress: number;
  onHold: number;
  overdue: number;
  dueSoon: ComplaintDto[];
}

export interface ReportSummary {
  range: { from: string; to: string };
  visitorsPerDay: CountByKey[];
  visitorsBySource: CountByKey[];
  complaintsByCategory: CountByKey[];
  complaintsByStatus: CountByKey[];
  averageResolutionHours: number | null;
  amenityUtilisation: { amenity: string; bookings: number; capacitySlots: number }[];
  parking: { slots: number; occupied: number };
}

export type DashboardResponse =
  | { role: 'admin' | 'committee'; admin: AdminDashboard }
  | { role: 'resident'; resident: ResidentDashboard }
  | { role: 'staff'; staff: StaffDashboard }
  | { role: 'guard' };
