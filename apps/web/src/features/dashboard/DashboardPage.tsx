import { Link, Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { CalendarPlus, ClipboardPlus, Megaphone, UserPlus } from 'lucide-react';
import { COMPLAINT_STATUS_LABELS, type AdminDashboard, type ComplaintStatus, type DashboardResponse, type ResidentDashboard, type StaffDashboard } from '@smart-society/shared';
import { api } from '@/lib/api';
import { displayZone, fmt } from '@/lib/format';
import { useCan, useSession } from '@/hooks/useSession';
import { PageHeader, Panel, PanelHeader, Stat } from '@/components/ui/panel';
import { Button, ButtonLink } from '@/components/ui/button';
import { EmptyState, QueryView, Skeleton } from '@/components/ui/states';
import { ComplaintStatusBadge, PriorityBadge, PURPOSE_LABELS } from '@/features/common/badges';
import { PassTicket } from '@/features/visitors/PassTicket';
import { useVisitDecision } from '@/features/visitors/useVisitDecision';

function greeting(name: string) {
  const h = DateTime.now().setZone(displayZone()).hour;
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name.split(' ')[0]}`;
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading overview">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-32 rounded-3xl" />
      ))}
    </div>
  );
}

function AdminView({ d }: { d: AdminDashboard }) {
  const can = useCan();
  const maxStatus = Math.max(1, ...d.complaints.byStatus.map((s) => s.count));
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open complaints" value={d.complaints.open} tone={d.complaints.urgentOpen ? 'attention' : 'plain'} detail={`${d.complaints.urgentOpen} urgent, ${d.complaints.overdue} past due`} />
        <Stat label="Visitors inside" value={d.visitors.inside} detail={`${d.visitors.expectedToday} expected today, ${d.visitors.awaitingApproval} waiting at the gate`} />
        <Stat label="Amenity bookings today" value={d.bookingsToday} />
        <Stat label="Parking in use" value={`${d.parking.occupied}/${d.parking.slots}`} tone="calm" detail={`${d.units.occupied} of ${d.units.total} homes occupied`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Panel>
          <PanelHeader title="Complaints by status" description="Every complaint and work order in the society." action={<ButtonLink to="/app/complaints" variant="secondary" size="sm">Open list</ButtonLink>} />
          <div className="p-6">
            {d.complaints.byStatus.length === 0 ? (
              <p className="text-muted">No complaints yet.</p>
            ) : (
              <ul className="space-y-3">
                {d.complaints.byStatus.map((s) => (
                  <li key={s.key} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                    <span>{COMPLAINT_STATUS_LABELS[s.key as ComplaintStatus] ?? s.key}</span>
                    <span className="h-2.5 rounded-full bg-surface-2" aria-hidden>
                      <span className="block h-full rounded-full bg-sage" style={{ width: `${(s.count / maxStatus) * 100}%` }} />
                    </span>
                    <span className="tabular text-right">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Recent activity" description={can('audit.view') ? 'Latest recorded actions.' : 'The audit log is visible to society admins.'} action={can('audit.view') ? <ButtonLink to="/app/audit" variant="secondary" size="sm">Audit log</ButtonLink> : undefined} />
          {d.recentActivity.length === 0 ? (
            <p className="p-6 text-muted">{can('audit.view') ? 'Nothing recorded yet.' : 'Reports and complaint lists remain available to you.'}</p>
          ) : (
            <ul className="divide-y divide-border/70 px-6 pb-4">
              {d.recentActivity.map((a) => (
                <li key={a.id} className="py-3">
                  <p className="text-[0.95rem]">{a.summary}</p>
                  <p className="text-sm text-muted">
                    {a.actor?.name ?? 'System'}, {fmt.relative(a.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="flex flex-wrap gap-2">
        {can('announcements.manage') && <ButtonLink to="/app/announcements?new=1" variant="secondary"><Megaphone className="size-4" strokeWidth={1.5} />Write a notice</ButtonLink>}
        {can('gate.operate') && <ButtonLink to="/app/gate" variant="secondary">Open the gate desk</ButtonLink>}
        {can('members.manage') && <ButtonLink to="/app/members" variant="secondary"><UserPlus className="size-4" strokeWidth={1.5} />Invite a member</ButtonLink>}
      </div>
    </div>
  );
}

function ResidentView({ d }: { d: ResidentDashboard }) {
  const decide = useVisitDecision();
  return (
    <div className="space-y-8">
      {d.visitsAwaitingMe.length > 0 && (
        <Panel className="border-terracotta/40 bg-terracotta-soft/60">
          <PanelHeader title="Someone is at the gate for you" description="The guard is waiting for your answer." />
          <ul className="space-y-3 p-6">
            {d.visitsAwaitingMe.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-4">
                <div>
                  <p className="font-medium">{v.visitorName}</p>
                  <p className="text-sm text-muted">
                    {PURPOSE_LABELS[v.purpose]}, {v.guestCount} {v.guestCount === 1 ? 'person' : 'people'}, arrived {fmt.relative(v.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="danger" size="sm" loading={decide.isPending && decide.variables?.id === v.id && decide.variables.decision === 'deny'} onClick={() => decide.mutate({ id: v.id, decision: 'deny' })}>
                    Deny
                  </Button>
                  <Button size="sm" loading={decide.isPending && decide.variables?.id === v.id && decide.variables.decision === 'approve'} onClick={() => decide.mutate({ id: v.id, decision: 'approve' })}>
                    Let them in
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <ButtonLink to="/app/visitors?new=1" variant="secondary" size="lg" className="justify-start"><UserPlus className="size-5" strokeWidth={1.5} />Invite a visitor</ButtonLink>
        <ButtonLink to="/app/complaints?new=1" variant="secondary" size="lg" className="justify-start"><ClipboardPlus className="size-5" strokeWidth={1.5} />Report an issue</ButtonLink>
        <ButtonLink to="/app/amenities" variant="secondary" size="lg" className="justify-start"><CalendarPlus className="size-5" strokeWidth={1.5} />Book an amenity</ButtonLink>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Upcoming visitor passes" action={<ButtonLink to="/app/visitors" variant="ghost" size="sm">All passes</ButtonLink>} />
          {d.upcomingInvitations.length === 0 ? (
            <EmptyState title="No passes waiting" action={<ButtonLink to="/app/visitors?new=1" size="sm">Invite a visitor</ButtonLink>}>
              Create a pass and share the code — the guard checks it at the gate.
            </EmptyState>
          ) : (
            <div className="grid gap-4 p-6 sm:grid-cols-2">
              {d.upcomingInvitations.slice(0, 4).map((i) => (
                <PassTicket key={i.id} invitation={i} compact />
              ))}
            </div>
          )}
          {d.insideNow.length > 0 && (
            <p className="border-t border-border px-6 py-4 text-sm text-muted">
              Inside now: {d.insideNow.map((v) => v.visitorName).join(', ')}
            </p>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Your open complaints" action={<ButtonLink to="/app/complaints" variant="ghost" size="sm">All complaints</ButtonLink>} />
          {d.openComplaints.length === 0 ? (
            <EmptyState title="Nothing outstanding">If something needs fixing, report it and follow progress here.</EmptyState>
          ) : (
            <ul className="divide-y divide-border/70 px-6 pb-3">
              {d.openComplaints.map((c) => (
                <li key={c.id}>
                  <Link to={`/app/complaints/${c.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-terracotta-ink">
                    <span className="min-w-0">
                      <span className="block truncate">{c.title}</span>
                      <span className="text-sm text-muted">#{c.number}, updated {fmt.relative(c.updatedAt)}</span>
                    </span>
                    <ComplaintStatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Your bookings" action={<ButtonLink to="/app/amenities" variant="ghost" size="sm">Amenities</ButtonLink>} />
          {d.upcomingBookings.length === 0 ? (
            <p className="p-6 text-muted">No upcoming bookings.</p>
          ) : (
            <ul className="divide-y divide-border/70 px-6 pb-3">
              {d.upcomingBookings.map((b) => (
                <li key={b.id} className="flex justify-between gap-3 py-3">
                  <span>{b.amenityName}</span>
                  <span className="tabular text-muted">
                    {fmt.dateShort(b.slotStart)}, {fmt.time(b.slotStart)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Pinned notices" action={<ButtonLink to="/app/announcements" variant="ghost" size="sm">All notices</ButtonLink>} />
          {d.pinnedAnnouncements.length === 0 ? (
            <p className="p-6 text-muted">Nothing pinned by the office.</p>
          ) : (
            <ul className="space-y-1 px-3 pb-4">
              {d.pinnedAnnouncements.map((a) => (
                <li key={a.id}>
                  <Link to={`/app/announcements/${a.id}`} className="block rounded-2xl px-3 py-3 hover:bg-surface-2">
                    <span className="flex items-center gap-2 font-medium">
                      {!a.read && <span className="size-2 rounded-full bg-terracotta" aria-label="Unread" />}
                      {a.title}
                    </span>
                    <span className="line-clamp-2 text-sm text-muted">{a.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function StaffView({ d }: { d: StaffDashboard }) {
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Waiting to start" value={d.assigned} />
        <Stat label="In progress" value={d.inProgress} />
        <Stat label="On hold" value={d.onHold} />
        <Stat label="Past due" value={d.overdue} tone={d.overdue ? 'attention' : 'calm'} />
      </div>
      <Panel>
        <PanelHeader title="Your queue" description="Ordered by due date." action={<ButtonLink to="/app/complaints?assignee=me" variant="secondary" size="sm">All my work orders</ButtonLink>} />
        {d.dueSoon.length === 0 ? (
          <EmptyState title="Queue is clear">New work orders appear here when the office assigns them to you.</EmptyState>
        ) : (
          <ul className="divide-y divide-border/70 px-6 pb-3">
            {d.dueSoon.map((c) => (
              <li key={c.id}>
                <Link to={`/app/complaints/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 py-4 hover:text-terracotta-ink">
                  <span className="min-w-0">
                    <span className="block">{c.title}</span>
                    <span className="text-sm text-muted">
                      #{c.number}, {c.unitLabel ?? 'common area'}
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
        )}
      </Panel>
    </div>
  );
}

export function DashboardPage() {
  const { data: session } = useSession();
  const dashboard = useQuery({
    queryKey: ['dashboard', session?.membership?.id],
    queryFn: () => api.get<DashboardResponse>('/dashboard'),
    enabled: Boolean(session?.membership),
    refetchInterval: 30_000,
  });
  if (!session) return null;
  if (!session.membership) {
    return (
      <>
        <PageHeader title={greeting(session.user.name)} />
        <EmptyState
          title={session.user.isPlatformAdmin ? 'You manage the platform' : 'No active society'}
          action={session.user.isPlatformAdmin ? <ButtonLink to="/app/platform">Open platform admin</ButtonLink> : undefined}
        >
          {session.user.isPlatformAdmin ? 'Onboard societies and invite their first admin from the platform page.' : 'Your account isn’t an active member of a society. Ask your society office for an invitation.'}
        </EmptyState>
      </>
    );
  }
  if (session.membership.role === 'guard') return <Navigate to="/app/gate" replace />;
  const m = session.membership;
  return (
    <>
      <PageHeader
        title={greeting(session.user.name)}
        description={m.role === 'resident' ? `${m.societyName}${m.unitLabel ? `, home ${m.unitLabel}` : ''}` : `${m.societyName} — ${fmt.weekdayDate(new Date().toISOString())}`}
      />
      <QueryView query={dashboard} loading={<DashboardSkeleton />}>
        {(d) =>
          d.role === 'resident' ? <ResidentView d={d.resident} /> : d.role === 'staff' ? <StaffView d={d.staff} /> : d.role === 'guard' ? <Navigate to="/app/gate" replace /> : <AdminView d={d.admin} />
        }
      </QueryView>
    </>
  );
}
