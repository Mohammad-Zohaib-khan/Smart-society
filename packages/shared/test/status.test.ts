import { describe, expect, it } from 'vitest';
import {
  allowedComplaintTransitions,
  canCancelBooking,
  canTransitionComplaint,
  canTransitionVisit,
  effectiveInvitationStatus,
  evaluateInvitationForCheckIn,
  vehicleFitsSlot,
} from '../src/status.js';
import { hasPermission, permissionsFor } from '../src/roles.js';

describe('complaint transitions', () => {
  it('lets the assignee start and resolve work but not close it', () => {
    expect(canTransitionComplaint('assigned', 'in_progress', ['assignee'])).toBe(true);
    expect(canTransitionComplaint('in_progress', 'resolved', ['assignee'])).toBe(true);
    expect(canTransitionComplaint('resolved', 'closed', ['assignee'])).toBe(false);
  });
  it('lets the reporter close or reopen a resolved complaint', () => {
    expect(allowedComplaintTransitions('resolved', ['reporter']).sort()).toEqual(['closed', 'in_progress']);
  });
  it('never allows leaving a terminal state', () => {
    expect(allowedComplaintTransitions('closed', ['manager', 'reporter', 'assignee'])).toEqual([]);
    expect(allowedComplaintTransitions('cancelled', ['manager'])).toEqual([]);
  });
  it('does not let a reporter cancel once work is assigned', () => {
    expect(canTransitionComplaint('assigned', 'cancelled', ['reporter'])).toBe(false);
    expect(canTransitionComplaint('open', 'cancelled', ['reporter'])).toBe(true);
  });
  it('cannot jump straight to assigned through a status change', () => {
    expect(canTransitionComplaint('open', 'assigned', ['manager'])).toBe(false);
  });
});

describe('visitor invitations', () => {
  const from = new Date('2026-10-10T10:00:00Z');
  const until = new Date('2026-10-10T14:00:00Z');
  it('accepts check-in inside the window', () => {
    expect(evaluateInvitationForCheckIn('active', from, until, new Date('2026-10-10T11:00:00Z'))).toEqual({ ok: true });
  });
  it('rejects early, late, used and cancelled passes with a reason', () => {
    expect(evaluateInvitationForCheckIn('active', from, until, new Date('2026-10-10T09:00:00Z'))).toEqual({ ok: false, reason: 'not_yet_valid' });
    expect(evaluateInvitationForCheckIn('active', from, until, new Date('2026-10-10T15:00:00Z'))).toEqual({ ok: false, reason: 'expired' });
    expect(evaluateInvitationForCheckIn('used', from, until, new Date('2026-10-10T11:00:00Z'))).toEqual({ ok: false, reason: 'already_used' });
    expect(evaluateInvitationForCheckIn('cancelled', from, until, new Date('2026-10-10T11:00:00Z'))).toEqual({ ok: false, reason: 'cancelled' });
  });
  it('derives expiry from the window', () => {
    expect(effectiveInvitationStatus('active', until, new Date('2026-10-11T00:00:00Z'))).toBe('expired');
    expect(effectiveInvitationStatus('used', until, new Date('2026-10-11T00:00:00Z'))).toBe('used');
  });
  it('only allows forward visit transitions', () => {
    expect(canTransitionVisit('awaiting_approval', 'inside')).toBe(true);
    expect(canTransitionVisit('inside', 'checked_out')).toBe(true);
    expect(canTransitionVisit('checked_out', 'inside')).toBe(false);
    expect(canTransitionVisit('denied', 'inside')).toBe(false);
  });
});

describe('booking cancellation', () => {
  const slotStart = new Date('2026-10-10T10:00:00Z');
  it('enforces the resident cutoff', () => {
    expect(canCancelBooking({ status: 'confirmed', slotStart, now: new Date('2026-10-10T07:00:00Z'), cutoffHours: 2, isManager: false })).toEqual({ ok: true });
    expect(canCancelBooking({ status: 'confirmed', slotStart, now: new Date('2026-10-10T09:00:00Z'), cutoffHours: 2, isManager: false })).toEqual({ ok: false, reason: 'past_cutoff' });
  });
  it('lets managers cancel until the slot starts', () => {
    expect(canCancelBooking({ status: 'confirmed', slotStart, now: new Date('2026-10-10T09:59:00Z'), cutoffHours: 2, isManager: true })).toEqual({ ok: true });
    expect(canCancelBooking({ status: 'confirmed', slotStart, now: new Date('2026-10-10T10:00:00Z'), cutoffHours: 2, isManager: true })).toEqual({ ok: false, reason: 'started' });
  });
  it('rejects double cancellation', () => {
    expect(canCancelBooking({ status: 'cancelled', slotStart, now: new Date('2026-10-09T00:00:00Z'), cutoffHours: 0, isManager: true })).toEqual({ ok: false, reason: 'already_cancelled' });
  });
});

describe('roles', () => {
  it('keeps guards away from resident directories and reports', () => {
    expect(hasPermission('guard', 'members.view')).toBe(false);
    expect(hasPermission('guard', 'reports.view')).toBe(false);
    expect(hasPermission('guard', 'gate.operate')).toBe(true);
  });
  it('keeps the committee read-only for operations', () => {
    const p = permissionsFor('committee');
    expect(p.has('complaints.assign')).toBe(false);
    expect(p.has('members.manage')).toBe(false);
    expect(p.has('reports.export')).toBe(true);
  });
  it('limits staff to work orders', () => {
    expect([...permissionsFor('staff')].sort()).toEqual(['announcements.view', 'workOrders.update', 'workOrders.viewAssigned']);
  });
});

describe('parking fit', () => {
  it('matches vehicles to slot types', () => {
    expect(vehicleFitsSlot('two_wheeler', 'car')).toBe(false);
    expect(vehicleFitsSlot('ev_car', 'ev')).toBe(true);
    expect(vehicleFitsSlot('car', 'ev')).toBe(false);
    expect(vehicleFitsSlot('car', 'visitor')).toBe(false);
  });
});
