import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Pin, Plus } from 'lucide-react';
import { ANNOUNCEMENT_PRIORITIES, ROLE_LABELS, SOCIETY_ROLES, type AnnouncementDto, type BuildingDto, type Paginated, type SocietyRole } from '@smart-society/shared';
import { api, errorMessage, qs } from '@/lib/api';
import { fmt, humanise, isoToLocalInput, localInputToIso } from '@/lib/format';
import { handleFormError } from '@/lib/forms';
import { useCan } from '@/hooks/useSession';
import { PageHeader, Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, QueryView } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { Segmented } from '@/components/ui/segmented';
import { Badge } from '@/components/ui/badge';
import { RequirePermission } from '@/features/common/Guard';

const formSchema = z.object({
  title: z.string().trim().min(4, 'At least 4 characters').max(140),
  body: z.string().trim().min(10, 'At least 10 characters').max(8000),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES),
  pinned: z.boolean(),
  roles: z.array(z.enum(SOCIETY_ROLES)),
  buildingIds: z.array(z.string()),
  expiresAt: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

function audienceText(a: AnnouncementDto, buildings: BuildingDto[] | undefined): string {
  const roles = a.audience.roles.length ? a.audience.roles.map((r) => ROLE_LABELS[r]).join(', ') : 'Everyone';
  const b = a.audience.buildingIds.map((id) => buildings?.find((x) => x.id === id)?.name ?? 'a building');
  return b.length ? `${roles}; residents of ${b.join(', ')}` : roles;
}

function Editor({ announcement, open, onOpenChange }: { announcement: AnnouncementDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const buildings = useQuery({ queryKey: ['buildings'], queryFn: () => api.get<BuildingDto[]>('/society/buildings'), enabled: open });
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: announcement
      ? { title: announcement.title, body: announcement.body, priority: announcement.priority, pinned: announcement.pinned, roles: announcement.audience.roles, buildingIds: announcement.audience.buildingIds, expiresAt: announcement.expiresAt ? isoToLocalInput(announcement.expiresAt) : '' }
      : { title: '', body: '', priority: 'normal', pinned: false, roles: [], buildingIds: [], expiresAt: '' },
  });
  const save = useMutation({
    mutationFn: async ({ v, publish }: { v: FormValues; publish: boolean }) => {
      const payload = { title: v.title, body: v.body, priority: v.priority, pinned: v.pinned, audience: { roles: v.roles, buildingIds: v.buildingIds }, expiresAt: v.expiresAt ? localInputToIso(v.expiresAt) : null };
      let id = announcement?.id;
      if (id) await api.patch(`/announcements/${id}`, payload);
      else id = (await api.post<{ id: string }>('/announcements', payload)).id;
      if (publish) return api.post<{ notified: number }>(`/announcements/${id}/publish`);
      return null;
    },
    onSuccess: (r) => {
      toast.success(r ? `Published — ${r.notified} people notified` : 'Saved');
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      onOpenChange(false);
    },
    onError: (e) => handleFormError(e, form.setError, ['title', 'body', 'priority', 'expiresAt']),
  });
  const roles = form.watch('roles');
  const buildingIds = form.watch('buildingIds');
  const toggle = <T extends string>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const e = form.formState.errors;
  const isDraft = !announcement || announcement.status === 'draft';
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={announcement ? 'Edit notice' : 'Write a notice'} description={isDraft ? 'Save as a draft, or publish to notify the audience now.' : 'Edits to a published notice don’t send new notifications.'} wide>
      <form noValidate className="space-y-4" onSubmit={(ev) => ev.preventDefault()}>
        <Field label="Title" error={e.title?.message}>
          <Input {...form.register('title')} />
        </Field>
        <Field label="Message" error={e.body?.message}>
          <Textarea rows={6} {...form.register('body')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Importance">
            <Select {...form.register('priority')}>
              {ANNOUNCEMENT_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanise(p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hide after" optional hint="Leave empty to keep it visible.">
            <Input type="datetime-local" {...form.register('expiresAt')} />
          </Field>
        </div>
        <Checkbox label="Pin to the top" description="Pinned notices also appear on residents’ overview." {...form.register('pinned')} />
        <fieldset>
          <legend className="text-sm font-medium">Who should see it?</legend>
          <p className="text-sm text-muted">Nothing ticked means everyone in the society.</p>
          <div className="mt-2 flex flex-wrap gap-x-5">
            {SOCIETY_ROLES.map((r) => (
              <Checkbox key={r} label={ROLE_LABELS[r]} checked={roles.includes(r)} onChange={() => form.setValue('roles', toggle<SocietyRole>(roles, r))} />
            ))}
          </div>
          {(buildings.data?.length ?? 0) > 0 && (
            <>
              <p className="mt-3 text-sm text-muted">Limit residents to buildings:</p>
              <div className="flex flex-wrap gap-x-5">
                {buildings.data?.map((b) => (
                  <Checkbox key={b.id} label={b.name} checked={buildingIds.includes(b.id)} onChange={() => form.setValue('buildingIds', toggle(buildingIds, b.id))} />
                ))}
              </div>
            </>
          )}
        </fieldset>
        <div className="flex flex-wrap gap-2 pt-2">
          {isDraft && (
            <Button loading={save.isPending && save.variables?.publish === true} onClick={form.handleSubmit((v) => save.mutate({ v, publish: true }))}>
              Publish now
            </Button>
          )}
          <Button variant="secondary" loading={save.isPending && save.variables?.publish === false} onClick={form.handleSubmit((v) => save.mutate({ v, publish: false }))}>
            {isDraft ? 'Save draft' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type StatusFilter = '' | 'draft' | 'published' | 'archived';

export function AnnouncementsPage() {
  const can = useCan();
  const manager = can('announcements.manage');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AnnouncementDto | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ a: AnnouncementDto; action: 'publish' | 'archive' | 'delete' } | null>(null);
  const buildings = useQuery({ queryKey: ['buildings'], queryFn: () => api.get<BuildingDto[]>('/society/buildings'), enabled: manager });
  useEffect(() => {
    if (params.get('new') === '1' && manager) {
      setEditing(null);
      setOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams, manager]);
  const q = useQuery({
    queryKey: ['announcements', status, page],
    queryFn: () => api.get<Paginated<AnnouncementDto>>(`/announcements${qs({ status, page, pageSize: 15 })}`),
    placeholderData: keepPreviousData,
  });
  const act = useMutation({
    mutationFn: async ({ a, action }: { a: AnnouncementDto; action: 'publish' | 'archive' | 'delete' }) => {
      if (action === 'delete') await api.delete(`/announcements/${a.id}`);
      else await api.post(`/announcements/${a.id}/${action}`);
    },
    onSuccess: (_r, v) => {
      toast.success(v.action === 'publish' ? 'Published' : v.action === 'archive' ? 'Archived' : 'Draft deleted');
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <RequirePermission any={['announcements.view']}>
      <PageHeader title="Notices" description={manager ? 'Write, publish and track who has read society notices.' : 'Updates from the society office.'} actions={manager && <Button onClick={() => (setEditing(null), setOpen(true))}><Plus className="size-4" />Write a notice</Button>} />
      {manager && <Segmented<StatusFilter> label="Status" className="mb-6" value={status} onChange={(v) => (setStatus(v), setPage(1))} options={[{ value: '', label: 'All' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }, { value: 'archived', label: 'Archived' }]} />}
      <QueryView query={q}>
        {(data) =>
          data.items.length === 0 ? (
            <Panel>
              <EmptyState title="No notices">{manager ? 'Write the first one — residents are notified when you publish.' : 'Nothing has been posted for you yet.'}</EmptyState>
            </Panel>
          ) : (
            <div className="space-y-4">
              {data.items.map((a) => (
                <Panel key={a.id} className="p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.pinned && <Badge tone="sage"><Pin className="size-3" />Pinned</Badge>}
                    {a.priority !== 'normal' && <Badge tone={a.priority === 'urgent' ? 'danger' : 'terracotta'}>{humanise(a.priority)}</Badge>}
                    {manager && a.status !== 'published' && <Badge>{humanise(a.status)}</Badge>}
                    {!manager && !a.read && <Badge tone="terracotta">New</Badge>}
                  </div>
                  <Link to={`/app/announcements/${a.id}`} className="mt-2 block hover:text-terracotta-ink">
                    <h2 className="text-2xl">{a.title}</h2>
                  </Link>
                  <p className="mt-2 line-clamp-3 max-w-prose whitespace-pre-line text-muted">{a.body}</p>
                  <p className="mt-3 text-sm text-muted">
                    {a.publishedAt ? `Published ${fmt.date(a.publishedAt)}` : `Drafted ${fmt.date(a.createdAt)}`} by {a.author.name}
                    {manager && `, for ${audienceText(a, buildings.data)}`}
                    {a.expiresAt && `, until ${fmt.dateTime(a.expiresAt)}`}
                  </p>
                  {manager && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                      {a.readStats && (
                        <span className="tabular mr-auto text-sm">
                          Read by {a.readStats.read} of {a.readStats.audience}
                        </span>
                      )}
                      {a.status !== 'archived' && (
                        <Button size="sm" variant="ghost" onClick={() => (setEditing(a), setOpen(true))}>
                          Edit
                        </Button>
                      )}
                      {a.status === 'draft' && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => setConfirm({ a, action: 'publish' })}>
                            Publish
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm({ a, action: 'delete' })}>
                            Delete
                          </Button>
                        </>
                      )}
                      {a.status === 'published' && (
                        <Button size="sm" variant="ghost" onClick={() => setConfirm({ a, action: 'archive' })}>
                          Archive
                        </Button>
                      )}
                    </div>
                  )}
                </Panel>
              ))}
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </div>
          )
        }
      </QueryView>
      {manager && <Editor announcement={editing} open={open} onOpenChange={setOpen} />}
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.action === 'publish' ? 'Publish this notice?' : confirm?.action === 'archive' ? 'Archive this notice?' : 'Delete this draft?'}
        description={confirm?.action === 'publish' ? 'Everyone in the audience is notified straight away.' : confirm?.action === 'archive' ? 'It disappears for residents but stays in the record.' : 'Drafts can be deleted; this can’t be undone.'}
        confirmLabel={confirm?.action === 'publish' ? 'Publish' : confirm?.action === 'archive' ? 'Archive' : 'Delete draft'}
        tone={confirm?.action === 'publish' ? 'primary' : 'danger'}
        loading={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
      />
    </RequirePermission>
  );
}

export function AnnouncementDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['announcement', id], queryFn: () => api.get<AnnouncementDto>(`/announcements/${id}`) });
  const markRead = useMutation({
    mutationFn: () => api.post(`/announcements/${id}/read`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const unreadPublished = q.data && !q.data.read && q.data.status === 'published';
  useEffect(() => {
    if (unreadPublished && markRead.isIdle) markRead.mutate();
  }, [unreadPublished, markRead]);
  return (
    <RequirePermission any={['announcements.view']}>
      <Link to="/app/announcements" className="mb-4 inline-flex min-h-11 items-center gap-2 pr-3 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" strokeWidth={1.5} />
        All notices
      </Link>
      <QueryView query={q}>
        {(a) => (
          <article className="mx-auto max-w-2xl">
            <Panel className="p-7 sm:p-10">
              <div className="flex flex-wrap gap-2">
                {a.priority !== 'normal' && <Badge tone={a.priority === 'urgent' ? 'danger' : 'terracotta'}>{humanise(a.priority)}</Badge>}
                {a.pinned && <Badge tone="sage">Pinned</Badge>}
              </div>
              <h1 className="mt-3 text-4xl leading-tight">{a.title}</h1>
              <p className="mt-2 text-sm text-muted">
                {a.author.name}, {fmt.date(a.publishedAt ?? a.createdAt)}
              </p>
              <div className="mt-6 text-[1.08rem] leading-relaxed whitespace-pre-line">{a.body}</div>
            </Panel>
          </article>
        )}
      </QueryView>
    </RequirePermission>
  );
}
