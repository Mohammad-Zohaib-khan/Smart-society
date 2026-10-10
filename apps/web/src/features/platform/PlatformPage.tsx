import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Copy, Plus } from 'lucide-react';
import { createSocietySchema, type CreatedInvite, type SocietyOverview } from '@smart-society/shared';
import type { z } from 'zod';
import { api, errorMessage } from '@/lib/api';
import { fmt } from '@/lib/format';
import { handleFormError } from '@/lib/forms';
import { useSession } from '@/hooks/useSession';
import { PageHeader, Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, QueryView } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th } from '@/components/ui/table';

type Input_ = z.input<typeof createSocietySchema>;

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [invite, setInvite] = useState<CreatedInvite | null>(null);
  const form = useForm<Input_>({ resolver: zodResolver(createSocietySchema), defaultValues: { name: '', city: '', address: '', timezone: 'Asia/Kolkata', adminName: '', adminEmail: '' } });
  const m = useMutation({
    mutationFn: (v: Input_) => api.post<{ societyId: string; invite: CreatedInvite }>('/platform/societies', v),
    onSuccess: (r) => {
      setInvite(r.invite);
      void qc.invalidateQueries({ queryKey: ['platform-societies'] });
    },
    onError: (e) => handleFormError(e, form.setError, Object.keys(form.getValues())),
  });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setInvite(null);
      form.reset();
    }
  };
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={close} title={invite ? 'Society created' : 'Onboard a society'} description={invite ? undefined : 'The first admin receives an invitation and sets up the rest.'} wide={!invite}>
      {invite ? (
        <div className="space-y-4">
          {invite.emailDelivered ? (
            <p>The admin invitation was emailed.</p>
          ) : (
            <>
              <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning-ink">Email isn’t configured. Send this private link to the society’s admin yourself.</p>
              <Input readOnly value={invite.acceptUrl ?? ''} aria-label="Invitation link" onFocus={(ev) => ev.currentTarget.select()} />
              <Button variant="secondary" onClick={() => navigator.clipboard.writeText(invite.acceptUrl ?? '').then(() => toast.success('Copied'), () => toast.error('Copy the link manually'))}>
                <Copy className="size-4" />
                Copy link
              </Button>
            </>
          )}
          <Button onClick={() => close(false)}>Done</Button>
        </div>
      ) : (
        <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <Field label="Society name" error={e.name?.message}>
            <Input {...form.register('name')} />
          </Field>
          <Field label="City" error={e.city?.message}>
            <Input {...form.register('city')} />
          </Field>
          <Field label="Address" className="sm:col-span-2" error={e.address?.message}>
            <Input {...form.register('address')} />
          </Field>
          <Field label="Time zone" hint="IANA name, e.g. Asia/Kolkata" error={e.timezone?.message}>
            <Input {...form.register('timezone')} />
          </Field>
          <div />
          <Field label="First admin’s name" error={e.adminName?.message}>
            <Input {...form.register('adminName')} />
          </Field>
          <Field label="First admin’s email" error={e.adminEmail?.message}>
            <Input type="email" {...form.register('adminEmail')} />
          </Field>
          <Button type="submit" className="sm:col-span-2 sm:w-fit" loading={m.isPending}>
            Create society
          </Button>
        </form>
      )}
    </Dialog>
  );
}

export function PlatformPage() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState<SocietyOverview | null>(null);
  const q = useQuery({ queryKey: ['platform-societies'], queryFn: () => api.get<SocietyOverview[]>('/platform/societies'), enabled: Boolean(session?.user.isPlatformAdmin) });
  const toggle = useMutation({
    mutationFn: (s: SocietyOverview) => api.patch(`/platform/societies/${s.id}/status`, { status: s.status === 'active' ? 'suspended' : 'active' }),
    onSuccess: () => {
      toast.success('Society updated');
      setToggling(null);
      void qc.invalidateQueries({ queryKey: ['platform-societies'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!session?.user.isPlatformAdmin) return <EmptyState title="Platform administrators only" />;
  return (
    <>
      <PageHeader title="Platform" description="Societies on this deployment. You see counts only — never residents’ records." actions={<Button onClick={() => setOpen(true)}><Plus className="size-4" />Onboard a society</Button>} />
      <Panel>
        <QueryView query={q}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState title="No societies yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Society</Th>
                    <Th>Buildings</Th>
                    <Th>Homes</Th>
                    <Th>Members</Th>
                    <Th>Status</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id}>
                      <Td>
                        <span className="block font-medium">{s.name}</span>
                        <span className="text-sm text-muted">
                          {s.city}, since {fmt.date(s.createdAt)}
                        </span>
                      </Td>
                      <Td className="tabular">{s.counts.buildings}</Td>
                      <Td className="tabular">{s.counts.units}</Td>
                      <Td className="tabular">{s.counts.members}</Td>
                      <Td>{s.status === 'active' ? <Badge tone="sage">Active</Badge> : <Badge tone="danger">Suspended</Badge>}</Td>
                      <Td className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setToggling(s)}>
                          {s.status === 'active' ? 'Suspend' : 'Reactivate'}
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          }
        </QueryView>
      </Panel>
      <CreateDialog open={open} onOpenChange={setOpen} />
      <ConfirmDialog
        open={Boolean(toggling)}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.status === 'active' ? `Suspend ${toggling.name}?` : `Reactivate ${toggling?.name ?? ''}?`}
        description={toggling?.status === 'active' ? 'Every member loses access until it is reactivated. No data is deleted.' : 'Members regain access immediately.'}
        confirmLabel={toggling?.status === 'active' ? 'Suspend' : 'Reactivate'}
        tone={toggling?.status === 'active' ? 'danger' : 'primary'}
        loading={toggle.isPending}
        onConfirm={() => toggling && toggle.mutate(toggling)}
      />
    </>
  );
}
