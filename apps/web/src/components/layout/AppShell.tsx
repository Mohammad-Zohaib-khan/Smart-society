import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import * as RD from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Building2,
  CalendarDays,
  Car,
  ChartColumn,
  DoorOpen,
  Globe,
  House,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  NotebookText,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Wrench,
  X,
  type LucideProps,
} from 'lucide-react';
import { ROLE_LABELS, type Permission, type SessionInfo } from '@smart-society/shared';
import { Brand } from './Brand';
import { ThemeToggle } from './ThemeToggle';
import { IconButton } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { ListSkeleton, ErrorState } from '@/components/ui/states';
import { useSession, useSetSession } from '@/hooks/useSession';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<LucideProps>;
  /** Visible when the role holds any of these permissions. */
  any?: Permission[];
  platform?: boolean;
  end?: boolean;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export function navFor(session: SessionInfo): NavGroup[] {
  const staff = session.membership?.role === 'staff';
  const groups: NavGroup[] = [
    {
      label: null,
      items: [
        { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true, any: [] },
        { to: '/app/gate', label: 'Gate desk', icon: DoorOpen, any: ['gate.operate'] },
        { to: '/app/visitors', label: 'Visitors', icon: ShieldCheck, any: ['visitors.viewOwn', 'visitors.viewAll'] },
        { to: '/app/complaints', label: staff ? 'Work orders' : 'Complaints', icon: Wrench, any: ['complaints.viewOwn', 'complaints.viewAll', 'workOrders.viewAssigned'] },
        { to: '/app/amenities', label: 'Amenities', icon: CalendarDays, any: ['amenities.view'] },
        { to: '/app/parking', label: 'Vehicles & parking', icon: Car, any: ['vehicles.manageOwn', 'parking.manage'] },
        { to: '/app/announcements', label: 'Notices', icon: Megaphone, any: ['announcements.view'] },
      ],
    },
    {
      label: 'Community',
      items: [
        { to: '/app/household', label: 'My household', icon: House, any: ['household.manageOwn'] },
        { to: '/app/members', label: 'Members', icon: Users, any: ['members.view'] },
        { to: '/app/structure', label: 'Buildings & units', icon: Building2, any: ['structure.view'] },
      ],
    },
    {
      label: 'Oversight',
      items: [
        { to: '/app/reports', label: 'Reports', icon: ChartColumn, any: ['reports.view'] },
        { to: '/app/audit', label: 'Audit log', icon: NotebookText, any: ['audit.view'] },
        { to: '/app/settings', label: 'Society settings', icon: Settings, any: ['society.settings.manage'] },
        { to: '/app/platform', label: 'Platform', icon: Globe, platform: true },
      ],
    },
  ];
  const perms = new Set(session.permissions);
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        if (i.platform) return session.user.isPlatformAdmin;
        if (!session.membership) return false;
        // Guards land on the gate desk; their overview would only redirect there.
        if (i.to === '/app' && session.membership.role === 'guard') return false;
        return !i.any || i.any.length === 0 || i.any.some((p) => perms.has(p));
      }),
    }))
    .filter((g) => g.items.length > 0);
}

function SidebarNav({ session, onNavigate }: { session: SessionInfo; onNavigate?: () => void }) {
  return (
    <nav aria-label="App" className="flex flex-col gap-6">
      {navFor(session).map((g, gi) => (
        <div key={gi}>
          {g.label && <p className="mb-2 px-4 text-sm text-muted">{g.label}</p>}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((i) => (
              <li key={i.to}>
                <NavLink
                  to={i.to}
                  end={i.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-11 items-center gap-3 rounded-full px-4 text-[0.95rem] transition-colors duration-300',
                      isActive ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-surface-2 hover:text-foreground',
                    )
                  }
                >
                  <i.icon className="size-[18px] shrink-0" strokeWidth={1.5} aria-hidden />
                  {i.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SocietySwitcher({ session }: { session: SessionInfo }) {
  const setSession = useSetSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: (membershipId: string) => api.post<SessionInfo>('/auth/switch-society', { membershipId }),
    onSuccess: (s) => {
      qc.clear();
      setSession(s);
      navigate('/app');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!session.membership) return null;
  if (session.memberships.length < 2) {
    return (
      <div className="px-4">
        <p className="font-serif text-lg leading-snug">{session.membership.societyName}</p>
        <p className="text-sm text-muted">
          {ROLE_LABELS[session.membership.role]}
          {session.membership.unitLabel ? `, ${session.membership.unitLabel}` : ''}
        </p>
      </div>
    );
  }
  return (
    <div className="px-1">
      <label htmlFor="society-switcher" className="sr-only">
        Active society
      </label>
      <Select id="society-switcher" value={session.membership.id} disabled={m.isPending} onChange={(e) => m.mutate(e.target.value)}>
        {session.memberships.map((ms) => (
          <option key={ms.id} value={ms.id}>
            {ms.societyName} — {ROLE_LABELS[ms.role]}
          </option>
        ))}
      </Select>
    </div>
  );
}

function SidebarFooter({ session }: { session: SessionInfo }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(['session'], null);
      navigate('/login');
    },
  });
  return (
    <div className="flex items-center gap-2 border-t border-border pt-4">
      <NavLink to="/app/profile" className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-full px-3 hover:bg-surface-2">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-clay text-sm font-semibold text-foreground">
          {session.user.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate text-sm">{session.user.name}</span>
      </NavLink>
      <IconButton label="Sign out" onClick={() => logout.mutate()} disabled={logout.isPending}>
        <LogOut className="size-5" strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}

function NotificationBell() {
  const { pathname } = useLocation();
  const count = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 30_000,
  });
  const n = count.data?.count ?? 0;
  return (
    <NavLink
      to="/app/notifications"
      aria-label={n ? `Notifications, ${n} unread` : 'Notifications'}
      className={cn('relative inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-2', pathname === '/app/notifications' && 'bg-surface-2')}
    >
      <Bell className="size-5" strokeWidth={1.5} aria-hidden />
      {n > 0 && (
        <span className="tabular absolute top-1.5 right-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-terracotta px-1 text-[0.7rem] font-semibold text-white">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </NavLink>
  );
}

export function AppShell() {
  const session = useSession();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [location.pathname]);

  if (session.isPending) return <ListSkeleton rows={6} />;
  if (session.isError) return <ErrorState error={session.error} onRetry={() => void session.refetch()} className="min-h-dvh justify-center" />;
  if (!session.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const s = session.data;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17.5rem_1fr]">
      <div className="grain" aria-hidden />
      <a href="#app-main" className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <aside className="sticky top-0 z-20 hidden h-dvh flex-col gap-6 overflow-y-auto border-r border-border bg-surface-2/60 px-4 py-6 lg:flex">
        <Brand to="/app" className="px-3" />
        <SocietySwitcher session={s} />
        <SidebarNav session={s} />
        <div className="mt-auto">
          <SidebarFooter session={s} />
        </div>
      </aside>

      <div className="relative z-10 min-w-0">
        <div className="atmosphere-static pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 opacity-70" aria-hidden />
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-border/60 bg-background/85 px-3 backdrop-blur-md sm:px-6 lg:justify-end lg:border-transparent lg:bg-transparent lg:backdrop-blur-none">
          <div className="flex items-center gap-1 lg:hidden">
            <RD.Root open={drawer} onOpenChange={setDrawer}>
              <RD.Trigger asChild>
                <IconButton label="Open navigation">
                  <Menu className="size-5" strokeWidth={1.5} />
                </IconButton>
              </RD.Trigger>
              <RD.Portal>
                <RD.Overlay className="fixed inset-0 z-50 bg-[#1c241f]/40" />
                <RD.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] flex-col gap-6 overflow-y-auto bg-background px-4 py-5 shadow-lift">
                  <div className="flex items-center justify-between">
                    <RD.Title asChild>
                      <span>
                        <Brand to="/app" className="px-2" />
                      </span>
                    </RD.Title>
                    <RD.Description className="sr-only">Main navigation</RD.Description>
                    <RD.Close asChild>
                      <IconButton label="Close navigation">
                        <X className="size-5" strokeWidth={1.5} />
                      </IconButton>
                    </RD.Close>
                  </div>
                  <SocietySwitcher session={s} />
                  <SidebarNav session={s} onNavigate={() => setDrawer(false)} />
                  <div className="mt-auto">
                    <SidebarFooter session={s} />
                  </div>
                </RD.Content>
              </RD.Portal>
            </RD.Root>
            <span className="font-serif text-lg font-semibold">Smart Society</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {s.membership && <NotificationBell />}
            <NavLink to="/app/profile" aria-label="Your profile" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-2 lg:hidden">
              <UserRound className="size-5" strokeWidth={1.5} aria-hidden />
            </NavLink>
          </div>
        </header>
        <main id="app-main" className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 sm:px-8 lg:pt-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
