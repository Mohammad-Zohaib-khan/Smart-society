import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { NOTIFICATION_TYPES, ROLE_LABELS, password, updateProfileSchema, type ChannelStatus, type NotificationType, type SessionInfo } from '@smart-society/shared';
import { api, errorMessage } from '@/lib/api';
import { handleFormError } from '@/lib/forms';
import { useSession, useSetSession } from '@/hooks/useSession';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { useThemeContext } from '@/providers';
import { Segmented } from '@/components/ui/segmented';

const TYPE_LABELS: Record<NotificationType, string> = {
  'visitor.arrived': 'A visitor arrives',
  'visitor.approval_requested': 'A walk-in needs my approval',
  'visitor.checked_out': 'A visitor leaves',
  'complaint.updated': 'Complaint updates',
  'complaint.assigned': 'Work assigned to me',
  'announcement.published': 'New notices',
  'booking.confirmed': 'Booking confirmations',
  'booking.cancelled': 'Bookings cancelled by the office',
  'parking.assigned': 'Parking slot assigned',
  'parking.released': 'Parking slot released',
  'membership.updated': 'Changes to my access',
};

type ProfileValues = z.input<typeof updateProfileSchema>;
const pwSchema = z.object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: password, confirm: z.string() }).refine((v) => v.newPassword === v.confirm, { message: 'Passwords don’t match', path: ['confirm'] });
type PwValues = z.infer<typeof pwSchema>;

function ProfileForm({ session }: { session: SessionInfo }) {
  const setSession = useSetSession();
  const form = useForm<ProfileValues>({ resolver: zodResolver(updateProfileSchema), values: { name: session.user.name, phone: session.user.phone ?? '' } });
  const m = useMutation({
    mutationFn: (v: ProfileValues) => api.patch<SessionInfo>('/auth/profile', v),
    onSuccess: (s) => {
      setSession(s);
      toast.success('Profile saved');
    },
    onError: (e) => handleFormError(e, form.setError, ['name', 'phone']),
  });
  return (
    <Panel>
      <PanelHeader title="Your details" description={`Signed in as ${session.user.email}`} />
      <form noValidate className="space-y-4 p-6" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <Field label="Name" error={form.formState.errors.name?.message}>
          <Input autoComplete="name" {...form.register('name')} />
        </Field>
        <Field label="Phone" optional hint="Visible to your society admin only." error={form.formState.errors.phone?.message}>
          <Input type="tel" autoComplete="tel" {...form.register('phone')} />
        </Field>
        <Button type="submit" loading={m.isPending}>
          Save details
        </Button>
      </form>
    </Panel>
  );
}

function PasswordForm() {
  const form = useForm<PwValues>({ resolver: zodResolver(pwSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const m = useMutation({
    mutationFn: (v: PwValues) => api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => {
      toast.success('Password changed. Other devices were signed out.');
      form.reset();
    },
    onError: (e) => handleFormError(e, form.setError, ['currentPassword', 'newPassword']),
  });
  const e = form.formState.errors;
  return (
    <Panel>
      <PanelHeader title="Password" description="Changing it signs you out everywhere else." />
      <form noValidate className="space-y-4 p-6" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <Field label="Current password" error={e.currentPassword?.message}>
          <Input type="password" autoComplete="current-password" {...form.register('currentPassword')} />
        </Field>
        <Field label="New password" hint="At least 10 characters, with a letter and a number." error={e.newPassword?.message}>
          <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
        </Field>
        <Field label="Repeat new password" error={e.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" loading={m.isPending}>
          Change password
        </Button>
      </form>
    </Panel>
  );
}

function NotificationPrefs({ session }: { session: SessionInfo }) {
  const setSession = useSetSession();
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api.get<ChannelStatus[]>('/notifications/channels') });
  const email = channels.data?.find((c) => c.channel === 'email');
  const prefs = session.notificationPrefs;
  const m = useMutation({
    mutationFn: (next: SessionInfo['notificationPrefs']) => api.put<SessionInfo>('/auth/notification-prefs', next),
    onSuccess: (s) => setSession(s),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggleType = (t: string) => {
    const muted = prefs.mutedTypes.includes(t) ? prefs.mutedTypes.filter((x) => x !== t) : [...prefs.mutedTypes, t];
    m.mutate({ ...prefs, mutedTypes: muted });
  };
  return (
    <Panel>
      <PanelHeader title="Notifications" description="Choose what reaches your notification centre." />
      <div className="p-6">
        <Checkbox
          label="Also send me an email copy"
          description={email ? (email.state === 'not_configured' ? 'Email isn’t set up for this deployment yet, so nothing will be sent.' : email.detail) : undefined}
          checked={prefs.emailEnabled}
          disabled={m.isPending}
          onChange={(e) => m.mutate({ ...prefs, emailEnabled: e.target.checked })}
        />
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Tell me when</legend>
          <div className="mt-1 grid sm:grid-cols-2">
            {NOTIFICATION_TYPES.map((t) => (
              <Checkbox key={t} label={TYPE_LABELS[t]} checked={!prefs.mutedTypes.includes(t)} disabled={m.isPending} onChange={() => toggleType(t)} />
            ))}
          </div>
        </fieldset>
      </div>
    </Panel>
  );
}

function Appearance() {
  const { choice, set } = useThemeContext();
  return (
    <Panel>
      <PanelHeader title="Appearance" />
      <div className="p-6">
        <Segmented label="Theme" value={choice} onChange={set} options={[{ value: 'system', label: 'Match device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </div>
    </Panel>
  );
}

export function ProfilePage() {
  const { data: session } = useSession();
  if (!session) return null;
  return (
    <>
      <PageHeader title="Your profile" description={session.membership ? `${ROLE_LABELS[session.membership.role]} at ${session.membership.societyName}` : undefined} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileForm session={session} />
        <PasswordForm />
        {session.membership && <NotificationPrefs session={session} />}
        <Appearance />
      </div>
    </>
  );
}
