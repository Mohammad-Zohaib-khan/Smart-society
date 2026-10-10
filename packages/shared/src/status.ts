/**
 * State machines for the operational records. The API is the only place that applies
 * transitions; the client reads these to decide which actions to offer.
 */

// ---------------------------------------------------------------- complaints / work orders

export const COMPLAINT_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'on_hold',
  'resolved',
  'closed',
  'cancelled',
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In progress',
  on_hold: 'On hold',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/** Who is acting on a complaint, relative to that complaint. */
export type ComplaintActor = 'reporter' | 'manager' | 'assignee';

interface ComplaintTransitionRule {
  to: ComplaintStatus;
  actors: readonly ComplaintActor[];
}

/**
 * `assigned` is reached only through the dedicated assign action (which also sets the assignee),
 * so it is intentionally absent from the generic status-change table.
 */
const COMPLAINT_TRANSITIONS: Record<ComplaintStatus, readonly ComplaintTransitionRule[]> = {
  open: [{ to: 'cancelled', actors: ['reporter', 'manager'] }],
  assigned: [
    { to: 'in_progress', actors: ['assignee', 'manager'] },
    { to: 'cancelled', actors: ['manager'] },
  ],
  in_progress: [
    { to: 'on_hold', actors: ['assignee', 'manager'] },
    { to: 'resolved', actors: ['assignee', 'manager'] },
  ],
  on_hold: [
    { to: 'in_progress', actors: ['assignee', 'manager'] },
    { to: 'cancelled', actors: ['manager'] },
  ],
  resolved: [
    { to: 'closed', actors: ['reporter', 'manager'] },
    // Re-opening after an unsatisfactory fix sends the work back to the assignee.
    { to: 'in_progress', actors: ['reporter', 'manager'] },
  ],
  closed: [],
  cancelled: [],
};

export function canTransitionComplaint(
  from: ComplaintStatus,
  to: ComplaintStatus,
  actors: readonly ComplaintActor[],
): boolean {
  return COMPLAINT_TRANSITIONS[from].some(
    (rule) => rule.to === to && rule.actors.some((a) => actors.includes(a)),
  );
}

export function allowedComplaintTransitions(
  from: ComplaintStatus,
  actors: readonly ComplaintActor[],
): ComplaintStatus[] {
  return COMPLAINT_TRANSITIONS[from]
    .filter((rule) => rule.actors.some((a) => actors.includes(a)))
    .map((rule) => rule.to);
}

/** Assignment is possible while work has not been finished. */
export function canAssignComplaint(status: ComplaintStatus): boolean {
  return status === 'open' || status === 'assigned' || status === 'on_hold' || status === 'in_progress';
}

export function isComplaintTerminal(status: ComplaintStatus): boolean {
  return status === 'closed' || status === 'cancelled';
}

// ---------------------------------------------------------------- visitors

export const INVITATION_STATUSES = ['active', 'used', 'cancelled', 'expired'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const VISIT_STATUSES = ['awaiting_approval', 'denied', 'inside', 'checked_out', 'withdrawn'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  awaiting_approval: 'Awaiting resident',
  denied: 'Denied',
  inside: 'Inside',
  checked_out: 'Checked out',
  withdrawn: 'Withdrawn',
};

export const VISIT_PURPOSES = ['guest', 'delivery', 'service', 'cab', 'other'] as const;
export type VisitPurpose = (typeof VISIT_PURPOSES)[number];

/** Effective invitation state, accounting for the validity window at `now`. */
export function effectiveInvitationStatus(
  stored: InvitationStatus,
  validUntil: Date,
  now: Date,
): InvitationStatus {
  if (stored === 'active' && validUntil.getTime() < now.getTime()) return 'expired';
  return stored;
}

export type InvitationCheckInDecision =
  | { ok: true }
  | { ok: false; reason: 'not_yet_valid' | 'expired' | 'cancelled' | 'already_used' };

export function evaluateInvitationForCheckIn(
  stored: InvitationStatus,
  validFrom: Date,
  validUntil: Date,
  now: Date,
): InvitationCheckInDecision {
  if (stored === 'cancelled') return { ok: false, reason: 'cancelled' };
  if (stored === 'used') return { ok: false, reason: 'already_used' };
  if (stored === 'expired' || validUntil.getTime() < now.getTime()) return { ok: false, reason: 'expired' };
  if (validFrom.getTime() > now.getTime()) return { ok: false, reason: 'not_yet_valid' };
  return { ok: true };
}

const VISIT_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  awaiting_approval: ['inside', 'denied', 'withdrawn'],
  inside: ['checked_out'],
  denied: [],
  checked_out: [],
  withdrawn: [],
};

export function canTransitionVisit(from: VisitStatus, to: VisitStatus): boolean {
  return VISIT_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------- bookings

export const BOOKING_STATUSES = ['confirmed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * Residents may cancel until `cutoffHours` before the slot starts; managers may always cancel
 * a booking that has not started yet.
 */
export function canCancelBooking(args: {
  status: BookingStatus;
  slotStart: Date;
  now: Date;
  cutoffHours: number;
  isManager: boolean;
}): { ok: true } | { ok: false; reason: 'already_cancelled' | 'started' | 'past_cutoff' } {
  if (args.status === 'cancelled') return { ok: false, reason: 'already_cancelled' };
  if (args.slotStart.getTime() <= args.now.getTime()) return { ok: false, reason: 'started' };
  if (args.isManager) return { ok: true };
  const cutoff = args.slotStart.getTime() - args.cutoffHours * 3_600_000;
  if (args.now.getTime() > cutoff) return { ok: false, reason: 'past_cutoff' };
  return { ok: true };
}

// ---------------------------------------------------------------- announcements

export const ANNOUNCEMENT_PRIORITIES = ['normal', 'important', 'urgent'] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

export const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

// ---------------------------------------------------------------- parking & vehicles

export const VEHICLE_TYPES = ['car', 'two_wheeler', 'ev_car', 'other'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const SLOT_TYPES = ['car', 'two_wheeler', 'ev', 'visitor'] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

/** Which vehicle types may occupy which slot types. */
export function vehicleFitsSlot(vehicle: VehicleType, slot: SlotType): boolean {
  switch (slot) {
    case 'car':
      return vehicle === 'car' || vehicle === 'ev_car' || vehicle === 'other';
    case 'ev':
      return vehicle === 'ev_car';
    case 'two_wheeler':
      return vehicle === 'two_wheeler';
    case 'visitor':
      return false;
  }
}

// ---------------------------------------------------------------- notifications

export const NOTIFICATION_TYPES = [
  'visitor.arrived',
  'visitor.approval_requested',
  'visitor.checked_out',
  'complaint.updated',
  'complaint.assigned',
  'announcement.published',
  'booking.confirmed',
  'booking.cancelled',
  'parking.assigned',
  'parking.released',
  'membership.updated',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
