import type { InvitationDto } from '@smart-society/shared';
import { fmt } from '@/lib/format';
import { PURPOSE_LABELS } from '@/features/common/badges';
import { cn } from '@/lib/cn';

/** The gate pass, shaped like an arched doorway — the code is what the guard asks for. */
export function PassTicket({ invitation, className, compact }: { invitation: Pick<InvitationDto, 'code' | 'visitorName' | 'validFrom' | 'validUntil' | 'purpose' | 'guestCount'>; className?: string; compact?: boolean }) {
  return (
    <div
      className={cn('relative overflow-hidden border border-sage/40 bg-sage-soft text-center', compact ? 'px-4 pt-9 pb-4' : 'px-6 pt-14 pb-6', className)}
      // Elliptical top corners draw a true arch without shrinking the rounded bottom corners.
      style={{ borderRadius: compact ? '50% 50% 20px 20px / 72px 72px 20px 20px' : '50% 50% 24px 24px / 110px 110px 24px 24px' }}
    >
      <p className="text-sm text-sage-ink">{PURPOSE_LABELS[invitation.purpose] ?? invitation.purpose}</p>
      <p className={cn('mt-1 font-serif leading-tight', compact ? 'text-lg' : 'text-2xl')}>{invitation.visitorName}</p>
      <p aria-label={`Pass code ${invitation.code.split('').join(' ')}`} className={cn('tabular mt-3 font-sans font-semibold tracking-[0.3em] text-foreground', compact ? 'text-2xl' : 'text-4xl')}>
        {invitation.code}
      </p>
      <p className="mt-3 text-sm text-muted">
        {fmt.dateShort(invitation.validFrom)}, {fmt.time(invitation.validFrom)}–{fmt.time(invitation.validUntil)}
        {invitation.guestCount > 1 ? `, ${invitation.guestCount} people` : ''}
      </p>
    </div>
  );
}
