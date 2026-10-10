import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { HOUSEHOLD_RELATIONS, householdMemberSchema, type HouseholdMemberDto } from '@smart-society/shared';
import type { z } from 'zod';
import { api, errorMessage } from '@/lib/api';
import { humanise } from '@/lib/format';
import { handleFormError } from '@/lib/forms';
import { useSession } from '@/hooks/useSession';
import { PageHeader, Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, QueryView } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { RequirePermission } from '@/features/common/Guard';

type Input_ = z.input<typeof householdMemberSchema>;

function MemberDialog({ member, open, onOpenChange }: { member: HouseholdMemberDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<Input_>({
    resolver: zodResolver(householdMemberSchema),
    values: member ? { name: member.name, relation: member.relation as Input_['relation'], phone: member.phone ?? '', isMinor: member.isMinor } : { name: '', relation: 'spouse', phone: '', isMinor: false },
  });
  const m = useMutation({
    mutationFn: (v: Input_) => (member ? api.patch(`/society/household/${member.id}`, v) : api.post('/society/household', v)),
    onSuccess: () => {
      toast.success(member ? 'Updated' : 'Added to your household');
      void qc.invalidateQueries({ queryKey: ['household'] });
      onOpenChange(false);
    },
    onError: (e) => handleFormError(e, form.setError, ['name', 'relation', 'phone']),
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={member ? `Edit ${member.name}` : 'Add a household member'} description="People who live with you but don’t need their own sign-in. Visible to you and the society admin.">
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <Field label="Name" error={e.name?.message}>
          <Input {...form.register('name')} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Relation">
            <Select {...form.register('relation')}>
              {HOUSEHOLD_RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {humanise(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone" optional error={e.phone?.message}>
            <Input type="tel" {...form.register('phone')} />
          </Field>
        </div>
        <Checkbox label="Under 18" {...form.register('isMinor')} />
        <Button type="submit" loading={m.isPending}>
          Save
        </Button>
      </form>
    </Dialog>
  );
}

export function HouseholdPage() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['household'], queryFn: () => api.get<HouseholdMemberDto[]>('/society/household') });
  const [editing, setEditing] = useState<HouseholdMemberDto | null>(null);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<HouseholdMemberDto | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/society/household/${id}`),
    onSuccess: () => {
      toast.success('Removed');
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: ['household'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <RequirePermission any={['household.manageOwn']}>
      <PageHeader title="My household" description={`Who lives at ${session?.membership?.unitLabel ?? 'your home'}.`} actions={<Button onClick={() => (setEditing(null), setOpen(true))}><Plus className="size-4" />Add a member</Button>} />
      <Panel>
        <QueryView query={q}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState title="Just you so far">Add family members or live-in help so the office knows who lives here.</EmptyState>
            ) : (
              <ul className="divide-y divide-border/70">
                {list.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                    <span>
                      <span className="block font-medium">{h.name}</span>
                      <span className="text-sm text-muted">
                        {humanise(h.relation)}
                        {h.phone ? `, ${h.phone}` : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      {h.isMinor && <Badge>Under 18</Badge>}
                      <Button size="sm" variant="ghost" onClick={() => (setEditing(h), setOpen(true))}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(h)}>
                        Remove
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryView>
      </Panel>
      <p className="mt-4 text-sm text-muted">Other adults who need their own sign-in should be invited by the society office.</p>
      <MemberDialog member={editing} open={open} onOpenChange={setOpen} />
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} title={`Remove ${removing?.name ?? ''}?`} description="They’ll no longer be listed for your home." confirmLabel="Remove" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)} />
    </RequirePermission>
  );
}
