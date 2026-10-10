import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Copy, UserPlus } from 'lucide-react';
import { VISIT_PURPOSES, VISIT_STATUSES, VISIT_STATUS_LABELS, type InvitationDto, type Paginated, type VisitDto } from '@smart-society/shared';
import { api, errorMessage, qs } from '@/lib/api';
import { fmt, localInputToIso, nowLocalInput } from '@/lib/format';
import { handleFormError } from '@/lib/forms';
import { useCan } from '@/hooks/useSession';
import { PageHeader, Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, QueryView } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { Segmented } from '@/components/ui/segmented';
import { Table, Td, Th } from '@/components/ui/table';
import { InvitationStatusBadge, PURPOSE_LABELS, VisitStatusBadge } from '@/features/common/badges';
import { RequirePermission } from '@/features/common/Guard';
import { PassTicket } from './PassTicket';
import { useVisitDecision } from './useVisitDecision';

const formSchema = z
  .object({
    visitorName: z.string().trim().min(2, 'Enter the visitor’s name').max(80),
    visitorPhone: z.string().trim().max(20).regex(/^$|^\+?[\d\s-]{7,20}$/, 'Enter a valid phone number'),
    purpose: z.enum(VISIT_PURPOSES),
    from: z.string().min(1, 'Choose a start time'),
    until: z.string().min(1, 'Choose an end time'),
    guestCount: z.number({ message: 'Enter a number' }).int().min(1).max(20),
    vehicleNumber: z.string().trim().max(14),
    note: z.string().trim().max(300),
  })
  .refine((v) => v.until > v.from, { message: 'End must be after start', path: ['until'] });
type FormValues = z.infer<typeof formSchema>;

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [created, setCreated] = useState<InvitationDto | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { visitorName: '', visitorPhone: '', purpose: 'guest', from: nowLocalInput(), until: nowLocalInput(240), guestCount: 1, vehicleNumber: '', note: '' },
  });
  const m = useMutation({
    mutationFn: (v: FormValues) =>
      api.post<InvitationDto>('/visitors/invitations', {
        visitorName: v.visitorName,
        visitorPhone: v.visitorPhone,
        purpose: v.purpose,
        validFrom: localInputToIso(v.from),
        validUntil: localInputToIso(v.until),
        guestCount: v.guestCount,
        vehicleNumber: v.vehicleNumber,
        note: v.note,
      }),
    onSuccess: (inv) => {
      setCreated(inv);
      void qc.invalidateQueries({ queryKey: ['invitations'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => {
      const known = ['visitorName', 'visitorPhone', 'guestCount', 'vehicleNumber', 'note'];
      handleFormError(e, form.setError, known);
    },
  });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setCreated(null);
      form.reset({ ...form.getValues(), visitorName: '', visitorPhone: '', vehicleNumber: '', note: '', from: nowLocalInput(), until: nowLocalInput(240) });
    }
  };
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={close} title={created ? 'Pass ready' : 'Invite a visitor'} description={created ? 'Share the code with your visitor. The guard checks it at the gate.' : 'The guard will see the visitor’s name, your home and the time window.'} wide={!created}>
      {created ? (
        <div className="space-y-5">
          <PassTicket invitation={created} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <CopyPassButton invitation={created} />
            <Button className="flex-1" onClick={() => close(false)}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Visitor name" error={e.visitorName?.message}>
              <Input autoComplete="off" {...form.register('visitorName')} />
            </Field>
            <Field label="Purpose">
              <Select {...form.register('purpose')}>
                {VISIT_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {PURPOSE_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Arriving from" error={e.from?.message}>
              <Input type="datetime-local" {...form.register('from')} />
            </Field>
            <Field label="Pass valid until" error={e.until?.message}>
              <Input type="datetime-local" {...form.register('until')} />
            </Field>
            <Field label="Number of people" error={e.guestCount?.message}>
              <Input type="number" min={1} max={20} {...form.register('guestCount', { valueAsNumber: true })} />
            </Field>
            <Field label="Visitor phone" optional hint="Shown in full only to your household and the society admin." error={e.visitorPhone?.message}>
              <Input type="tel" autoComplete="off" {...form.register('visitorPhone')} />
            </Field>
            <Field label="Vehicle number" optional error={e.vehicleNumber?.message}>
              <Input autoComplete="off" {...form.register('vehicleNumber')} />
            </Field>
          </div>
          <Field label="Note for the guard" optional error={e.note?.message}>
            <Textarea rows={2} className="min-h-20" {...form.register('note')} />
          </Field>
          <Button type="submit" size="lg" className="w-full sm:w-auto" loading={m.isPending}>
            Create pass
          </Button>
        </form>
      )}
    </Dialog>
  );
}

function CopyPassButton({ invitation }: { invitation: InvitationDto }) {
  return (
    <Button
      variant="secondary"
      className="flex-1"
      onClick={() => {
        const text = `Your gate pass for ${invitation.unitLabel}: ${invitation.code}\nValid ${fmt.dateTime(invitation.validFrom)} – ${fmt.dateTime(invitation.validUntil)}`;
        navigator.clipboard.writeText(text).then(
          () => toast.success('Pass details copied'),
          () => toast.error('Copying isn’t allowed in this browser — read the code out instead'),
        );
      }}
    >
      <Copy className="size-4" strokeWidth={1.5} />
      Copy pass details
    </Button>
  );
}

function Passes({ scope }: { scope: 'upcoming' | 'past' }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState<InvitationDto | null>(null);
  const q = useQuery({
    queryKey: ['invitations', scope, page],
    queryFn: () => api.get<Paginated<InvitationDto>>(`/visitors/invitations${qs({ scope, page, pageSize: 12 })}`),
    placeholderData: keepPreviousData,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/visitors/invitations/${id}/cancel`),
    onSuccess: () => {
      toast.success('Pass cancelled — the code no longer works');
      setCancelling(null);
      void qc.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel>
      <QueryView query={q}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title={scope === 'upcoming' ? 'No upcoming passes' : 'No past passes yet'}>
              {scope === 'upcoming' ? 'Create a pass before a guest arrives and they won’t wait at the gate.' : 'Used, cancelled and expired passes appear here.'}
            </EmptyState>
          ) : (
            <>
              <ul className="grid gap-5 p-6 sm:grid-cols-2 lg:grid-cols-3">
                {data.items.map((i) => (
                  <li key={i.id} className="flex flex-col gap-3">
                    <PassTicket invitation={i} compact className={scope === 'past' ? 'opacity-75' : ''} />
                    <div className="flex items-center justify-between gap-2 px-1">
                      <InvitationStatusBadge status={i.status} />
                      {i.status === 'active' && (
                        <span className="flex gap-1">
                          <CopyMini invitation={i} />
                          <Button size="sm" variant="ghost" onClick={() => setCancelling(i)}>
                            Cancel
                          </Button>
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </>
          )
        }
      </QueryView>
      <ConfirmDialog
        open={Boolean(cancelling)}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this pass?"
        description={cancelling ? `${cancelling.visitorName}’s code ${cancelling.code} will stop working at the gate.` : ''}
        confirmLabel="Cancel pass"
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
      />
    </Panel>
  );
}

function CopyMini({ invitation }: { invitation: InvitationDto }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`Copy pass details for ${invitation.visitorName}`}
      onClick={() =>
        navigator.clipboard.writeText(`Gate pass for ${invitation.unitLabel}: ${invitation.code} (valid ${fmt.dateTime(invitation.validFrom)} – ${fmt.dateTime(invitation.validUntil)})`).then(
          () => toast.success('Copied'),
          () => toast.error('Copying isn’t allowed in this browser'),
        )
      }
    >
      <Copy className="size-4" strokeWidth={1.5} />
      Copy
    </Button>
  );
}

function VisitLog({ resident }: { resident: boolean }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const decide = useVisitDecision();
  const q = useQuery({
    queryKey: ['visits', page, status, source, search, from, to],
    queryFn: () => api.get<Paginated<VisitDto>>(`/visitors/visits${qs({ page, pageSize: 20, status, source, q: search, from, to })}`),
    placeholderData: keepPreviousData,
    refetchInterval: resident ? 20_000 : false,
  });
  const reset = () => setPage(1);
  return (
    <Panel>
      <div className="flex flex-wrap gap-3 p-6 pb-4">
        <Input aria-label="Search visitor or home" placeholder="Search visitor or home" value={search} onChange={(e) => (setSearch(e.target.value), reset())} className="max-w-xs" />
        <Select aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), reset())} className="w-auto">
          <option value="">Any status</option>
          {VISIT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {VISIT_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Entry type" value={source} onChange={(e) => (setSource(e.target.value), reset())} className="w-auto">
          <option value="">Pre-approved and walk-in</option>
          <option value="invitation">Pre-approved</option>
          <option value="walk_in">Walk-in</option>
        </Select>
        <Input type="date" aria-label="From date" value={from} onChange={(e) => (setFrom(e.target.value), reset())} className="w-auto" />
        <Input type="date" aria-label="To date" value={to} onChange={(e) => (setTo(e.target.value), reset())} className="w-auto" />
      </div>
      <QueryView query={q}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="No visits match">Visits appear once the guard checks someone in.</EmptyState>
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>Visitor</Th>
                    {!resident && <Th>Home</Th>}
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th>In</Th>
                    <Th>Out</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((v) => (
                    <tr key={v.id}>
                      <Td>
                        <span className="block font-medium">{v.visitorName}</span>
                        <span className="text-sm text-muted">
                          {PURPOSE_LABELS[v.purpose]}
                          {v.visitorPhone ? `, ${v.visitorPhone}` : ''}
                        </span>
                      </Td>
                      {!resident && <Td className="tabular">{v.unitLabel}</Td>}
                      <Td className="text-sm">{v.source === 'invitation' ? 'Pre-approved' : 'Walk-in'}</Td>
                      <Td>
                        {resident && v.status === 'awaiting_approval' ? (
                          <span className="flex gap-1">
                            <Button size="sm" onClick={() => decide.mutate({ id: v.id, decision: 'approve' })}>
                              Let in
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => decide.mutate({ id: v.id, decision: 'deny' })}>
                              Deny
                            </Button>
                          </span>
                        ) : (
                          <VisitStatusBadge status={v.status} />
                        )}
                      </Td>
                      <Td className="tabular text-sm">{v.checkedInAt ? fmt.dateTime(v.checkedInAt) : '—'}</Td>
                      <Td className="tabular text-sm">{v.checkedOutAt ? fmt.time(v.checkedOutAt) : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </>
          )
        }
      </QueryView>
    </Panel>
  );
}

export function VisitorsPage() {
  const can = useCan();
  const resident = can('visitors.invite');
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'upcoming' | 'past' | 'log'>(resident ? 'upcoming' : 'log');
  const [inviting, setInviting] = useState(false);
  useEffect(() => {
    if (params.get('new') === '1' && resident) {
      setInviting(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, resident, setParams]);

  return (
    <RequirePermission any={['visitors.viewOwn', 'visitors.viewAll']}>
      <PageHeader
        title="Visitors"
        description={resident ? 'Passes you’ve created and everyone who has come to your home.' : 'Every entry recorded at the gate.'}
        actions={
          resident && (
            <Button onClick={() => setInviting(true)}>
              <UserPlus className="size-4" strokeWidth={1.5} />
              Invite a visitor
            </Button>
          )
        }
      />
      {resident && (
        <Segmented
          label="Show"
          className="mb-6"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'upcoming', label: 'Upcoming passes' },
            { value: 'past', label: 'Past passes' },
            { value: 'log', label: 'Visit history' },
          ]}
        />
      )}
      {tab === 'log' ? <VisitLog resident={resident} /> : <Passes scope={tab} />}
      {resident && <InviteDialog open={inviting} onOpenChange={setInviting} />}
    </RequirePermission>
  );
}
