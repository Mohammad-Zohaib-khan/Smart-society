import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Paperclip } from 'lucide-react';
import {
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUS_LABELS,
  type ComplaintDetailDto,
  type ComplaintEventDto,
  type ComplaintStatus,
  type StaffOption,
} from '@smart-society/shared';
import { api, apiUrl, errorMessage } from '@/lib/api';
import { bytes, fmt, humanise } from '@/lib/format';
import { useCan } from '@/hooks/useSession';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { QueryView } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import { ComplaintStatusBadge, PriorityBadge } from '@/features/common/badges';
import { RequirePermission } from '@/features/common/Guard';

const ACTION_LABELS: Partial<Record<ComplaintStatus, string>> = {
  in_progress: 'Start work',
  on_hold: 'Put on hold',
  resolved: 'Mark resolved',
  closed: 'Close — it’s fixed',
  cancelled: 'Cancel complaint',
};

function actionLabel(from: ComplaintStatus, to: ComplaintStatus): string {
  if (from === 'resolved' && to === 'in_progress') return 'Reopen — not fixed';
  if (from === 'on_hold' && to === 'in_progress') return 'Resume work';
  return ACTION_LABELS[to] ?? COMPLAINT_STATUS_LABELS[to];
}

function needsNote(from: ComplaintStatus, to: ComplaintStatus): 'required' | 'optional' {
  return to === 'resolved' || (from === 'resolved' && to === 'in_progress') ? 'required' : 'optional';
}

function eventText(e: ComplaintEventDto): string {
  switch (e.kind) {
    case 'created':
      return 'reported the issue';
    case 'assigned':
      return `assigned it to ${e.assignee?.name ?? 'staff'}`;
    case 'status':
      return `moved it from ${e.fromStatus ? COMPLAINT_STATUS_LABELS[e.fromStatus].toLowerCase() : '—'} to ${e.toStatus ? COMPLAINT_STATUS_LABELS[e.toStatus].toLowerCase() : '—'}`;
    case 'comment':
      return e.internal ? 'added an internal note' : 'commented';
    case 'attachment':
      return `attached ${e.body ?? 'a file'}`;
  }
}

function TransitionDialog({ complaint, target, onClose }: { complaint: ComplaintDetailDto; target: ComplaintStatus | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<ComplaintDetailDto>(`/complaints/${complaint.id}/status`, { status: target, note }),
    onSuccess: (c) => {
      qc.setQueryData(['complaint', c.id], c);
      void qc.invalidateQueries({ queryKey: ['complaints'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`Complaint #${c.number} is now ${COMPLAINT_STATUS_LABELS[c.status].toLowerCase()}`);
      setNote('');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!target) return null;
  const req = needsNote(complaint.status, target) === 'required';
  const label = actionLabel(complaint.status, target);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={label} description={req ? (target === 'resolved' ? 'Describe the work done — the resident sees this.' : 'Tell the team what is still wrong.') : 'Add a note for the record if useful.'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label={req ? 'Note' : 'Note'} optional={!req}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button type="submit" variant={target === 'cancelled' ? 'danger' : 'primary'} disabled={req && note.trim().length === 0} loading={m.isPending}>
            {label}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AssignPanel({ complaint }: { complaint: ComplaintDetailDto }) {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.get<StaffOption[]>('/society/staff') });
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState(complaint.dueDate ?? '');
  const [priority, setPriority] = useState(complaint.priority);
  const m = useMutation({
    mutationFn: () => api.post<ComplaintDetailDto>(`/complaints/${complaint.id}/assign`, { assigneeMembershipId: assignee, dueDate: due || undefined, priority }),
    onSuccess: (c) => {
      qc.setQueryData(['complaint', c.id], c);
      void qc.invalidateQueries({ queryKey: ['complaints'] });
      toast.success(`Assigned to ${c.assignee?.name ?? 'staff'}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel>
      <PanelHeader title={complaint.assignee ? 'Reassign' : 'Assign'} description="The staff member and the reporter are notified." />
      <form
        className="space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Staff member">
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Choose…</option>
            {staff.data?.map((s) => (
              <option key={s.membershipId} value={s.membershipId}>
                {s.name} ({s.openWorkOrders} open)
              </option>
            ))}
          </Select>
        </Field>
        {staff.data?.length === 0 && <p className="text-sm text-muted">No active maintenance staff. Invite staff from Members first.</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due" optional>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              {COMPLAINT_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanise(p)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button type="submit" className="w-full" disabled={!assignee} loading={m.isPending}>
          {complaint.assignee ? 'Reassign' : 'Assign'}
        </Button>
      </form>
    </Panel>
  );
}

function CommentBox({ complaint }: { complaint: ComplaintDetailDto }) {
  const qc = useQueryClient();
  const can = useCan();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const staffSide = can('complaints.assign') || can('workOrders.update');
  const comment = useMutation({
    mutationFn: () => api.post<ComplaintDetailDto>(`/complaints/${complaint.id}/comments`, { body, internal }),
    onSuccess: (c) => {
      qc.setQueryData(['complaint', c.id], c);
      setBody('');
      setInternal(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const upload = useMutation({
    mutationFn: (files: FileList) => {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append('files', f));
      return api.upload<ComplaintDetailDto>(`/complaints/${complaint.id}/attachments`, form);
    },
    onSuccess: (c) => {
      qc.setQueryData(['complaint', c.id], c);
      toast.success('Attached');
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      if (fileRef.current) fileRef.current.value = '';
    },
  });
  return (
    <form
      className="space-y-3 border-t border-border p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) comment.mutate();
      }}
    >
      <label htmlFor="comment" className="text-sm font-medium">
        Add an update
      </label>
      <Textarea id="comment" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={staffSide ? 'Progress, parts needed, access arrangements…' : 'Anything the team should know'} />
      {staffSide && <Checkbox label="Internal note" description="Hidden from the resident who reported it." checked={internal} onChange={(e) => setInternal(e.target.checked)} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <input
            ref={fileRef}
            id="evidence"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) {
                if (e.target.files.length > 3) toast.error('Attach up to 3 files at a time');
                else upload.mutate(e.target.files);
              }
            }}
          />
          <label htmlFor="evidence" className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-[0.95rem] hover:bg-surface-2 has-[:focus-visible]:outline-2">
            <Paperclip className="size-4" strokeWidth={1.5} />
            {upload.isPending ? 'Uploading…' : 'Attach photo or PDF'}
          </label>
          <p className="px-4 text-xs text-muted">JPEG, PNG, WebP or PDF, up to 5 MB each</p>
        </div>
        <Button type="submit" disabled={!body.trim()} loading={comment.isPending}>
          Post update
        </Button>
      </div>
    </form>
  );
}

export function ComplaintDetailPage() {
  const { id = '' } = useParams();
  const can = useCan();
  const [target, setTarget] = useState<ComplaintStatus | null>(null);
  const q = useQuery({ queryKey: ['complaint', id], queryFn: () => api.get<ComplaintDetailDto>(`/complaints/${id}`) });

  return (
    <RequirePermission any={['complaints.viewOwn', 'complaints.viewAll', 'workOrders.viewAssigned']}>
      <Link to="/app/complaints" className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-full pr-3 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" strokeWidth={1.5} />
        All complaints
      </Link>
      <QueryView query={q}>
        {(c) => (
          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <div className="min-w-0 space-y-6">
              <Panel className="p-6 sm:p-8">
                <div className="flex flex-wrap gap-2">
                  <ComplaintStatusBadge status={c.status} />
                  <PriorityBadge priority={c.priority} />
                  <Badge>{c.category}</Badge>
                </div>
                <h1 className="mt-4 text-3xl leading-tight">
                  <span className="tabular text-muted">#{c.number} </span>
                  {c.title}
                </h1>
                <p className="mt-4 max-w-prose whitespace-pre-line text-[1.05rem]">{c.description}</p>
                <dl className="mt-6 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted">Reported by</dt>
                    <dd>
                      {c.reporter.name}, {fmt.dateTime(c.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Location</dt>
                    <dd>{c.area === 'unit' ? `Home ${c.unitLabel ?? ''}` : `Common area${c.unitLabel ? ` (reported from ${c.unitLabel})` : ''}`}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Assigned to</dt>
                    <dd>{c.assignee?.name ?? 'Not assigned yet'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Due</dt>
                    <dd>{c.dueDate ? fmt.calendarDate(c.dueDate) : 'No due date'}</dd>
                  </div>
                </dl>
                {c.allowedTransitions.length > 0 && (
                  <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-6">
                    {c.allowedTransitions.map((t) => (
                      <Button key={t} variant={t === 'cancelled' ? 'ghost' : t === 'resolved' || t === 'closed' ? 'primary' : 'secondary'} onClick={() => setTarget(t)}>
                        {actionLabel(c.status, t)}
                      </Button>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel>
                <PanelHeader title="History" />
                <ol className="relative space-y-5 p-6 before:absolute before:top-8 before:bottom-8 before:left-[2.05rem] before:w-px before:bg-border">
                  {c.events.map((e) => (
                    <li key={e.id} className="relative flex gap-4">
                      <span className={`relative z-10 mt-1.5 size-3 shrink-0 rounded-full ring-4 ring-surface ${e.kind === 'status' && e.toStatus === 'resolved' ? 'bg-sage' : e.internal ? 'bg-clay' : 'bg-terracotta'}`} aria-hidden />
                      <div className="min-w-0">
                        <p className="text-[0.95rem]">
                          <strong className="font-medium">{e.actor.name}</strong> {eventText(e)}
                          <span className="ml-2 text-sm text-muted">{fmt.dateTime(e.at)}</span>
                        </p>
                        {e.body && e.kind !== 'attachment' && <p className={`mt-1 rounded-2xl px-4 py-2.5 whitespace-pre-line ${e.internal ? 'bg-clay/50' : 'bg-surface-2'}`}>{e.body}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
                {c.canComment && <CommentBox complaint={c} />}
              </Panel>
            </div>

            <div className="space-y-6">
              {c.canAssign && <AssignPanel complaint={c} />}
              <Panel>
                <PanelHeader title="Photos and documents" />
                {c.attachments.length === 0 ? (
                  <p className="p-6 text-sm text-muted">{c.canComment ? 'Attach photos of the problem or of the finished work from the update box.' : 'No files attached.'}</p>
                ) : (
                  <ul className="grid grid-cols-2 gap-3 p-6">
                    {c.attachments.map((a) => (
                      <li key={a.id}>
                        <a href={apiUrl(`/complaints/attachments/${a.id}${a.contentType.startsWith('image/') ? '?inline=1' : ''}`)} target="_blank" rel="noreferrer" className="group block">
                          {a.contentType.startsWith('image/') ? (
                            <img src={apiUrl(`/complaints/attachments/${a.id}?inline=1`)} alt={a.fileName} loading="lazy" className="aspect-square w-full rounded-2xl border border-border object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
                          ) : (
                            <span className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-surface-2 p-2 text-center text-xs">
                              <FileText className="size-6" strokeWidth={1.5} />
                              <span className="line-clamp-2">{a.fileName}</span>
                            </span>
                          )}
                          <span className="mt-1 block truncate text-xs text-muted">
                            {a.purpose === 'completion' ? 'Completion' : 'Report'}, {bytes(a.size)}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              {!can('complaints.assign') && c.status === 'open' && <p className="px-2 text-sm text-muted">The society office will assign someone soon. You’ll be notified at each step.</p>}
            </div>
            <TransitionDialog complaint={c} target={target} onClose={() => setTarget(null)} />
          </div>
        )}
      </QueryView>
    </RequirePermission>
  );
}
