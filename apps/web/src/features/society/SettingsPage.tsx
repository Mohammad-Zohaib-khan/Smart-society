import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { updateSocietySettingsSchema, type ChannelStatus, type SocietySettings } from '@smart-society/shared';
import { api } from '@/lib/api';
import { handleFormError } from '@/lib/forms';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/field';
import { QueryView } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { RequirePermission } from '@/features/common/Guard';
import { useSocietySettings } from '@/features/complaints/ComplaintsPage';

const formSchema = updateSocietySettingsSchema.omit({ complaintCategories: true }).extend({ categories: z.string().min(2, 'List at least one category') });
type FormValues = z.input<typeof formSchema>;

const CHANNEL: Record<ChannelStatus['channel'], string> = { in_app: 'In-app', email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', push: 'Push' };

function SettingsForm({ settings }: { settings: SocietySettings }) {
  const qc = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: { name: settings.name, address: settings.address, visitorPolicy: settings.visitorPolicy, workingHours: settings.workingHours, categories: settings.complaintCategories.join('\n') },
  });
  const m = useMutation({
    mutationFn: (v: FormValues) => {
      const { categories, ...rest } = v;
      return api.put<SocietySettings>('/society/settings', { ...rest, complaintCategories: categories.split('\n').map((c) => c.trim()).filter(Boolean) });
    },
    onSuccess: (s) => {
      qc.setQueryData(['society-settings'], s);
      toast.success('Settings saved');
    },
    onError: (e) => handleFormError(e, form.setError),
  });
  const e = form.formState.errors;
  const num = (n: 'visitorPolicy.invitationMaxDaysAhead' | 'visitorPolicy.invitationMaxHours' | 'visitorPolicy.visitorRetentionDays') => form.register(n, { valueAsNumber: true });
  return (
    <form noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-6">
      <Panel>
        <PanelHeader title="Society" description={`Time zone ${settings.timezone}. All times in the app use it.`} />
        <div className="grid gap-4 p-6 sm:grid-cols-2">
          <Field label="Name" error={e.name?.message}>
            <Input {...form.register('name')} />
          </Field>
          <Field label="Address" error={e.address?.message}>
            <Input {...form.register('address')} />
          </Field>
          <Field label="Office opens" error={e.workingHours?.start?.message}>
            <Input type="time" {...form.register('workingHours.start')} />
          </Field>
          <Field label="Office closes" error={e.workingHours?.end?.message}>
            <Input type="time" {...form.register('workingHours.end')} />
          </Field>
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Visitor policy" />
        <div className="space-y-4 p-6">
          <Checkbox label="Walk-ins need the resident’s approval" description="Guards must get an answer in the app, by intercom or by phone. When off, guards may also decide on the spot." {...form.register('visitorPolicy.walkInRequiresResidentApproval')} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Passes can start up to (days ahead)" error={e.visitorPolicy?.invitationMaxDaysAhead?.message}>
              <Input type="number" min={1} max={90} {...num('visitorPolicy.invitationMaxDaysAhead')} />
            </Field>
            <Field label="Longest pass (hours)" error={e.visitorPolicy?.invitationMaxHours?.message}>
              <Input type="number" min={1} max={72} {...num('visitorPolicy.invitationMaxHours')} />
            </Field>
            <Field label="Keep visitor details for (days)" hint="After this, names, phones and vehicle numbers are erased from the log." error={e.visitorPolicy?.visitorRetentionDays?.message}>
              <Input type="number" min={7} max={730} {...num('visitorPolicy.visitorRetentionDays')} />
            </Field>
          </div>
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Complaint categories" description="One per line. Residents choose from this list." />
        <div className="p-6">
          <Field label="Categories" error={e.categories?.message}>
            <Textarea rows={7} {...form.register('categories')} />
          </Field>
        </div>
      </Panel>
      <Button type="submit" size="lg" loading={m.isPending}>
        Save settings
      </Button>
    </form>
  );
}

export function SettingsPage() {
  const settings = useSocietySettings();
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api.get<ChannelStatus[]>('/notifications/channels') });
  return (
    <RequirePermission any={['society.settings.manage']}>
      <PageHeader title="Society settings" description="Rules that shape the gate, complaints and record keeping. Changes are recorded in the audit log." />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <QueryView query={settings}>{(s) => <SettingsForm settings={s} />}</QueryView>
        <Panel className="h-fit">
          <PanelHeader title="Notification channels" description="What this deployment can actually deliver." />
          <QueryView query={channels}>
            {(list) => (
              <ul className="space-y-4 p-6">
                {list.map((c) => (
                  <li key={c.channel}>
                    <p className="flex items-center justify-between gap-2 font-medium">
                      {CHANNEL[c.channel]}
                      <Badge tone={c.state === 'active' ? 'sage' : c.state === 'console_dev' ? 'warning' : 'neutral'}>{c.state === 'active' ? 'On' : c.state === 'console_dev' ? 'Test mode' : 'Not set up'}</Badge>
                    </p>
                    <p className="text-sm text-muted">{c.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </QueryView>
        </Panel>
      </div>
    </RequirePermission>
  );
}
