import type { ReactNode } from 'react';
import type { Permission } from '@smart-society/shared';
import { useCan, useSession } from '@/hooks/useSession';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';

/**
 * Hides a page from roles that cannot use it. This is a courtesy only: the API enforces
 * every permission independently.
 */
export function RequirePermission({ any, children }: { any: Permission[]; children: ReactNode }) {
  const can = useCan();
  const { data } = useSession();
  if (!data?.membership) {
    return (
      <EmptyState title="No active society" action={<ButtonLink to="/app/profile" variant="secondary">Open your profile</ButtonLink>}>
        Your account isn’t an active member of a society right now. Ask your society office for an invitation.
      </EmptyState>
    );
  }
  if (!any.some(can)) {
    return (
      <EmptyState title="Not available for your role" action={<ButtonLink to="/app" variant="secondary">Back to overview</ButtonLink>}>
        This page is for other members of the society. If you think you should have access, contact your society admin.
      </EmptyState>
    );
  }
  return <>{children}</>;
}
