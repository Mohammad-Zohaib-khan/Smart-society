import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Copy, UserPlus } from 'lucide-react';
import { ROLE_LABELS, SOCIETY_ROLES, inviteMemberSchema, type CreatedInvite, type MemberDto, type Paginated, type PendingInviteDto, type SocietyRole, type UnitDto } from '@smart-society/shared';
import type { z } from 'zod';
import { api, errorMessage, qs } from '@/lib/api';
import { fmt } from '@/lib/format';
import { handleFormError } from '@/lib/forms';
import { useCan, useSession } from '@/hooks/useSession';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, QueryView } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { Table, Td, Th } from '@/components/ui/table';
import { RequirePermission } from '@/features/common/Guard';

type InviteInput = z.input<typeof inviteMemberSchema>;

function useUnitOptions(enabled: boolean, search = '') {
  return useQuery({ queryKey: ['units', 'options', search], queryFn: () => api.get<Paginated<UnitDto>>(`/society/units${qs({ pageSize: 100, q: search })}`), enabled, placeholderData: keepPreviousData });
}

/** Home picker; a search narrows the list for societies with more than 100 homes. */
function UnitSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const [search, setSearch] = useState('');
  const units = useUnitOptions(true, search).data?.items ?? [];
  return (
    <div className="space-y-2">
      <Input aria-label="Filter homes" placeholder="Filter, e.g. W-3" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Home">
      <option value="">Choose a home…</option>
      {units.map((u) => (
        <option key={u.id} value={u.id}>
          {u.label} {u.residentCount ? `(${u.residentCount} resident${u.residentCount > 1 ? 's' : ''})` : '(vacant)'}
        </option>
      ))}
      </Select>
    </div>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<CreatedInvite | null>(null);
  const form = useForm<InviteInput>({ resolver: zodResolver(inviteMemberSchema), defaultValues: { email: '', name: '', role: 'resident', unitId: undefined } });
  const role = form.watch('role');
  const m = useMutation({
    mutationFn: (v: InviteInput) => api.post<CreatedInvite>('/society/invites', { ...v, unitId: v.role === 'resident' ? v.unitId : undefined }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['invites'] });
    },
    onError: (e) => handleFormError(e, form.setError, ['email', 'name', 'role', 'unitId']),
  });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setResult(null);
      form.reset();
    }
  };
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={close} title={result ? 'Invitation created' : 'Invite a member'} description={result ? undefined : 'They choose their own password when they accept.'}>
      {result ? (
        <div className="space-y-4">
          {result.emailDelivered ? (
            <p>The invitation was emailed. It expires on {fmt.date(result.expiresAt)}.</p>
          ) : (
            <>
              <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning-ink">Email delivery isn’t configured, so share this private link with them yourself. Anyone with the link can accept it until {fmt.date(result.expiresAt)}.</p>
              <Input readOnly value={result.acceptUrl ?? ''} onFocus={(ev) => ev.currentTarget.select()} aria-label="Invitation link" />
              <Button
                variant="secondary"
                onClick={() =>
                  navigator.clipboard.writeText(result.acceptUrl ?? '').then(
                    () => toast.success('Link copied'),
                    () => toast.error('Copying isn’t allowed here — select the link and copy it manually'),
                  )
                }
              >
                <Copy className="size-4" />
                Copy link
              </Button>
            </>
          )}
          <Button onClick={() => close(false)}>Done</Button>
        </div>
      ) : (
        <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <Field label="Name" error={e.name?.message}>
            <Input {...form.register('name')} />
          </Field>
          <Field label="Email" error={e.email?.message}>
            <Input type="email" {...form.register('email')} />
          </Field>
          <Field label="Role">
            <Select {...form.register('role')}>
              {SOCIETY_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          {role === 'resident' && (
            <Field label="Home" error={e.unitId?.message}>
              <UnitSelect value={form.watch('unitId') ?? ''} onChange={(v) => form.setValue('unitId', v || undefined, { shouldValidate: true })} />
            </Field>
          )}
          <Button type="submit" loading={m.isPending}>
            Create invitation
          </Button>
        </form>
      )}
    </Dialog>
  );
}

function EditMemberDialog({ member, onClose }: { member: MemberDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<SocietyRole>('resident');
  const [unitId, setUnitId] = useState('');
  const [prev, setPrev] = useState<string | null>(null);
  if (member && member.membershipId !== prev) {
    setPrev(member.membershipId);
    setRole(member.role);
    setUnitId(member.unitId ?? '');
  }
  const m = useMutation({
    mutationFn: () => api.patch(`/society/members/${member?.membershipId}`, { role, unitId: role === 'resident' ? unitId || null : null }),
    onSuccess: () => {
      toast.success('Member updated');
      void qc.invalidateQueries({ queryKey: ['members'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={Boolean(member)} onOpenChange={(o) => !o && onClose()} title={`Change ${member?.name ?? ''}’s access`} description="They are notified of the change.">
      <div className="space-y-4">
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as SocietyRole)}>
            {SOCIETY_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        {role === 'resident' && (
          <Field label="Home">
            <UnitSelect value={unitId} onChange={setUnitId} />
          </Field>
        )}
        <Button disabled={role === 'resident' && !unitId} loading={m.isPending} onClick={() => m.mutate()}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}

function PendingInvites() {
  const qc = useQueryClient();
  const [revoking, setRevoking] = useState<PendingInviteDto | null>(null);
  const q = useQuery({ queryKey: ['invites'], queryFn: () => api.get<PendingInviteDto[]>('/society/invites') });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/society/invites/${id}`),
    onSuccess: () => {
      toast.success('Invitation revoked — the link no longer works');
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: ['invites'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!q.data?.length) return null;
  return (
    <Panel>
      <PanelHeader title="Waiting to accept" />
      <ul className="divide-y divide-border/70 px-6 pb-3">
        {q.data.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span>
              <span className="block">
                {i.name} <span className="text-muted">({i.email})</span>
              </span>
              <span className="text-sm text-muted">
                {ROLE_LABELS[i.role]}
                {i.unitLabel ? `, ${i.unitLabel}` : ''}, expires {fmt.date(i.expiresAt)}
              </span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setRevoking(i)}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog open={Boolean(revoking)} onOpenChange={(o) => !o && setRevoking(null)} title="Revoke this invitation?" description={`${revoking?.name ?? ''} won’t be able to use the link.`} confirmLabel="Revoke" loading={revoke.isPending} onConfirm={() => revoking && revoke.mutate(revoking.id)} />
    </Panel>
  );
}

export function MembersPage() {
  const can = useCan();
  const { data: session } = useSession();
  const qc = useQueryClient();
  const manage = can('members.manage');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<MemberDto | null>(null);
  const [toggling, setToggling] = useState<MemberDto | null>(null);
  const q = useQuery({
    queryKey: ['members', role, status, search, page],
    queryFn: () => api.get<Paginated<MemberDto>>(`/society/members${qs({ role, status, q: search, page, pageSize: 20 })}`),
    placeholderData: keepPreviousData,
  });
  const toggle = useMutation({
    mutationFn: (m: MemberDto) => api.patch(`/society/members/${m.membershipId}`, { status: m.status === 'active' ? 'suspended' : 'active' }),
    onSuccess: () => {
      toast.success('Access updated');
      setToggling(null);
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <RequirePermission any={['members.view']}>
      <PageHeader title="Members" description={manage ? 'Everyone with access to this society, and the invitations still open.' : 'Members of the society. Contact details are visible to the society admin only.'} actions={manage && <Button onClick={() => setInviting(true)}><UserPlus className="size-4" />Invite a member</Button>} />
      <div className="space-y-6">
        {manage && <PendingInvites />}
        <Panel>
          <div className="flex flex-wrap gap-3 p-6 pb-2">
            <Input aria-label="Search" placeholder="Search name, email or home" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="max-w-xs" />
            <Select aria-label="Role" value={role} onChange={(e) => (setRole(e.target.value), setPage(1))} className="w-auto">
              <option value="">All roles</option>
              {SOCIETY_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <Select aria-label="Access" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="w-auto">
              <option value="">Active and suspended</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
          </div>
          <QueryView query={q}>
            {(data) =>
              data.items.length === 0 ? (
                <EmptyState title="No members match" />
              ) : (
                <>
                  <Table className="mt-2">
                    <thead>
                      <tr>
                        <Th>Name</Th>
                        <Th>Role</Th>
                        <Th>Home</Th>
                        {manage && <Th>Contact</Th>}
                        <Th>Access</Th>
                        {manage && (
                          <Th>
                            <span className="sr-only">Actions</span>
                          </Th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((m) => {
                        const self = m.membershipId === session?.membership?.id;
                        return (
                          <tr key={m.membershipId}>
                            <Td className="font-medium">
                              {m.name}
                              {self && <span className="ml-1 text-sm font-normal text-muted">(you)</span>}
                            </Td>
                            <Td>{ROLE_LABELS[m.role]}</Td>
                            <Td>{m.unitLabel ?? '—'}</Td>
                            {manage && (
                              <Td className="text-sm">
                                <span className="block">{m.email}</span>
                                <span className="text-muted">{m.phone ?? ''}</span>
                              </Td>
                            )}
                            <Td>{m.status === 'active' ? <Badge tone="sage">Active</Badge> : <Badge tone="danger">Suspended</Badge>}</Td>
                            {manage && (
                              <Td className="text-right whitespace-nowrap">
                                {!self && (
                                  <>
                                    <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
                                      Change role
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setToggling(m)}>
                                      {m.status === 'active' ? 'Suspend' : 'Restore'}
                                    </Button>
                                  </>
                                )}
                              </Td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                  <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
                </>
              )
            }
          </QueryView>
        </Panel>
      </div>
      {manage && <InviteDialog open={inviting} onOpenChange={setInviting} />}
      <EditMemberDialog member={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={Boolean(toggling)}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.status === 'active' ? `Suspend ${toggling.name}?` : `Restore ${toggling?.name ?? ''}?`}
        description={toggling?.status === 'active' ? 'They lose access to this society immediately. Their history is kept.' : 'They regain access with their previous role.'}
        confirmLabel={toggling?.status === 'active' ? 'Suspend' : 'Restore'}
        tone={toggling?.status === 'active' ? 'danger' : 'primary'}
        loading={toggle.isPending}
        onConfirm={() => toggling && toggle.mutate(toggling)}
      />
    </RequirePermission>
  );
}
