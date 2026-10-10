import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ClipboardPlus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { COMPLAINT_PRIORITIES, complaintSchema, type ComplaintDetailDto, type ComplaintDto, type ComplaintInput, type Paginated, type SocietySettings } from '@smart-society/shared';
import { api, qs } from '@/lib/api';
import { fmt, humanise } from '@/lib/format';
import { handleFormError } from '@/lib/forms';
import { useCan, useSession } from '@/hooks/useSession';
import { PageHeader, Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, QueryView } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { Segmented } from '@/components/ui/segmented';
import { ComplaintStatusBadge, PriorityBadge } from '@/features/common/badges';
import { RequirePermission } from '@/features/common/Guard';

export function useSocietySettings() {
  return useQuery({ queryKey: ['society-settings'], queryFn: () => api.get<SocietySettings>('/society/settings'), staleTime: 5 * 60_000 });
}

function NewComplaintDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const settings = useSocietySettings();
  const { data: session } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const hasUnit = Boolean(session?.membership?.unitId);
  const form = useForm<ComplaintInput>({
    resolver: zodResolver(complaintSchema),
    defaultValues: { title: '', description: '', category: '', priority: 'medium', area: hasUnit ? 'unit' : 'common_area' },
  });
  const m = useMutation({
    mutationFn: (v: ComplaintInput) => api.post<ComplaintDetailDto>('/complaints', v),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['complaints'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onOpenChange(false);
      form.reset();
      navigate(`/app/complaints/${c.id}`);
    },
    onError: (e) => handleFormError(e, form.setError, ['title', 'description', 'category', 'priority', 'area']),
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Report an issue" description="The society office reviews it and assigns someone. You can add photos on the next screen." wide>
      <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <Field label="What’s wrong?" hint="A short summary, e.g. “Bathroom tap leaking”" error={e.title?.message}>
          <Input {...form.register('title')} />
        </Field>
        <Field label="Details" hint="Where exactly, since when, anything already tried." error={e.description?.message}>
          <Textarea rows={4} {...form.register('description')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Category" error={e.category?.message ? 'Choose a category' : undefined}>
            <Select {...form.register('category')}>
              <option value="">Choose…</option>
              {settings.data?.complaintCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Urgency">
            <Select {...form.register('priority')}>
              {COMPLAINT_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanise(p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location" error={e.area?.message}>
            <Select {...form.register('area')}>
              {hasUnit && <option value="unit">Inside my home</option>}
              <option value="common_area">Common area</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" size="lg" loading={m.isPending}>
          Submit complaint
        </Button>
      </form>
    </Dialog>
  );
}

type StatusFilter = 'active' | 'resolved' | 'closed' | '';

export function ComplaintsPage() {
  const can = useCan();
  const staff = can('workOrders.viewAssigned');
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('active');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState(params.get('assignee') ?? '');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (params.get('new') === '1' && can('complaints.create')) {
      setCreating(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams, can]);

  const q = useQuery({
    queryKey: ['complaints', status, priority, assignee, search, page],
    queryFn: () => api.get<Paginated<ComplaintDto>>(`/complaints${qs({ status, priority, assignee, q: search, page, pageSize: 20 })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <RequirePermission any={['complaints.viewOwn', 'complaints.viewAll', 'workOrders.viewAssigned']}>
      <PageHeader
        title={staff ? 'Work orders' : 'Complaints'}
        description={staff ? 'Jobs assigned to you by the society office.' : can('complaints.viewAll') ? 'Everything reported in the society, from leaks to lifts.' : 'Issues you or your household reported.'}
        actions={
          can('complaints.create') && (
            <Button onClick={() => setCreating(true)}>
              <ClipboardPlus className="size-4" strokeWidth={1.5} />
              Report an issue
            </Button>
          )
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented<StatusFilter>
          label="Status"
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'closed', label: 'Closed' },
            { value: '', label: 'All' },
          ]}
        />
        <Select aria-label="Priority" value={priority} onChange={(e) => (setPriority(e.target.value), setPage(1))} className="w-auto">
          <option value="">Any priority</option>
          {COMPLAINT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {humanise(p)}
            </option>
          ))}
        </Select>
        {can('complaints.assign') && (
          <Select aria-label="Assignment" value={assignee} onChange={(e) => (setAssignee(e.target.value), setPage(1))} className="w-auto">
            <option value="">Assigned or not</option>
            <option value="none">Not yet assigned</option>
          </Select>
        )}
        <Input aria-label="Search" placeholder="Search title, home or #number" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="max-w-xs" />
      </div>
      <Panel>
        <QueryView query={q}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState title="Nothing here" action={can('complaints.create') ? <Button size="sm" onClick={() => setCreating(true)}>Report an issue</Button> : undefined}>
                {status === 'active' ? 'No active complaints match these filters.' : 'Try a different filter.'}
              </EmptyState>
            ) : (
              <>
                <ul className="divide-y divide-border/70">
                  {data.items.map((c) => (
                    <li key={c.id}>
                      <Link to={`/app/complaints/${c.id}`} className="grid gap-2 px-6 py-4 transition-colors duration-300 hover:bg-surface-2/60 sm:grid-cols-[1fr_auto] sm:items-center">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            <span className="tabular mr-2 text-muted">#{c.number}</span>
                            {c.title}
                          </span>
                          <span className="text-sm text-muted">
                            {c.category}, {c.unitLabel ?? 'common area'}
                            {c.area === 'common_area' && c.unitLabel ? ' (common area)' : ''}, {fmt.relative(c.createdAt)}
                            {c.assignee ? `, with ${c.assignee.name}` : ''}
                            {c.dueDate ? `, due ${fmt.calendarDate(c.dueDate)}` : ''}
                          </span>
                        </span>
                        <span className="flex gap-2">
                          <PriorityBadge priority={c.priority} />
                          <ComplaintStatusBadge status={c.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
              </>
            )
          }
        </QueryView>
      </Panel>
      <NewComplaintDialog open={creating} onOpenChange={setCreating} />
    </RequirePermission>
  );
}
