import {
  COMPLAINT_STATUS_LABELS,
  VISIT_STATUS_LABELS,
  type ComplaintPriority,
  type ComplaintStatus,
  type InvitationStatus,
  type VisitStatus,
} from '@smart-society/shared';
import { Badge, type Tone } from '@/components/ui/badge';
import { humanise } from '@/lib/format';

const complaintTone: Record<ComplaintStatus, Tone> = {
  open: 'terracotta',
  assigned: 'warning',
  in_progress: 'warning',
  on_hold: 'neutral',
  resolved: 'sage',
  closed: 'neutral',
  cancelled: 'neutral',
};
export const ComplaintStatusBadge = ({ status }: { status: ComplaintStatus }) => <Badge tone={complaintTone[status]}>{COMPLAINT_STATUS_LABELS[status]}</Badge>;

const priorityTone: Record<ComplaintPriority, Tone> = { low: 'neutral', medium: 'sage', high: 'terracotta', urgent: 'danger' };
export const PriorityBadge = ({ priority }: { priority: ComplaintPriority }) => <Badge tone={priorityTone[priority]}>{humanise(priority)}</Badge>;

const visitTone: Record<VisitStatus, Tone> = { awaiting_approval: 'terracotta', inside: 'sage', checked_out: 'neutral', denied: 'danger', withdrawn: 'neutral' };
export const VisitStatusBadge = ({ status }: { status: VisitStatus }) => <Badge tone={visitTone[status]}>{VISIT_STATUS_LABELS[status]}</Badge>;

const inviteTone: Record<InvitationStatus, Tone> = { active: 'sage', used: 'neutral', cancelled: 'neutral', expired: 'neutral' };
const inviteLabel: Record<InvitationStatus, string> = { active: 'Active', used: 'Used', cancelled: 'Cancelled', expired: 'Expired' };
export const InvitationStatusBadge = ({ status }: { status: InvitationStatus }) => <Badge tone={inviteTone[status]}>{inviteLabel[status]}</Badge>;

export const PURPOSE_LABELS: Record<string, string> = { guest: 'Guest', delivery: 'Delivery', service: 'Service visit', cab: 'Cab / ride', other: 'Other' };
