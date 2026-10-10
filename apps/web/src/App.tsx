import type React from 'react';
import { createBrowserRouter, createHashRouter, RouterProvider } from 'react-router';
import { STATIC_PREVIEW } from '@/lib/preview';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { AppShell } from '@/components/layout/AppShell';
import { NotFoundPage } from '@/pages/NotFoundPage';

/** Each authenticated page is its own chunk, loaded on first visit. */
const page = (load: () => Promise<Record<string, unknown>>, name: string) => ({
  lazy: async () => ({ Component: (await load())[name] as React.ComponentType }),
});

export const routes = [
  {
    element: <PublicLayout />,
    children: [
      { path: '/', ...page(() => import('@/pages/HomePage'), 'HomePage') },
      { path: '/privacy', ...page(() => import('@/pages/PrivacyPage'), 'PrivacyPage') },
      { path: '/login', ...page(() => import('@/features/auth/LoginPage'), 'LoginPage') },
      { path: '/accept-invite', ...page(() => import('@/features/auth/AcceptInvitePage'), 'AcceptInvitePage') },
      { path: '/forgot-password', ...page(() => import('@/features/auth/PasswordResetPages'), 'ForgotPasswordPage') },
      { path: '/reset-password', ...page(() => import('@/features/auth/PasswordResetPages'), 'ResetPasswordPage') },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/app',
    element: <AppShell />,
    children: [
      { index: true, ...page(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage') },
      { path: 'gate', ...page(() => import('@/features/gate/GatePage'), 'GatePage') },
      { path: 'visitors', ...page(() => import('@/features/visitors/VisitorsPage'), 'VisitorsPage') },
      { path: 'complaints', ...page(() => import('@/features/complaints/ComplaintsPage'), 'ComplaintsPage') },
      { path: 'complaints/:id', ...page(() => import('@/features/complaints/ComplaintDetailPage'), 'ComplaintDetailPage') },
      { path: 'amenities', ...page(() => import('@/features/amenities/AmenitiesPage'), 'AmenitiesPage') },
      { path: 'parking', ...page(() => import('@/features/parking/ParkingPage'), 'ParkingPage') },
      { path: 'announcements', ...page(() => import('@/features/announcements/AnnouncementsPage'), 'AnnouncementsPage') },
      { path: 'announcements/:id', ...page(() => import('@/features/announcements/AnnouncementsPage'), 'AnnouncementDetailPage') },
      { path: 'notifications', ...page(() => import('@/features/notifications/NotificationsPage'), 'NotificationsPage') },
      { path: 'members', ...page(() => import('@/features/society/MembersPage'), 'MembersPage') },
      { path: 'structure', ...page(() => import('@/features/society/StructurePage'), 'StructurePage') },
      { path: 'household', ...page(() => import('@/features/society/HouseholdPage'), 'HouseholdPage') },
      { path: 'settings', ...page(() => import('@/features/society/SettingsPage'), 'SettingsPage') },
      { path: 'reports', ...page(() => import('@/features/reports/ReportsPage'), 'ReportsPage') },
      { path: 'audit', ...page(() => import('@/features/reports/AuditPage'), 'AuditPage') },
      { path: 'profile', ...page(() => import('@/features/profile/ProfilePage'), 'ProfilePage') },
      { path: 'platform', ...page(() => import('@/features/platform/PlatformPage'), 'PlatformPage') },
      { path: '*', element: <NotFoundPage inApp /> },
    ],
  },
];

// The static preview is hosted under an arbitrary path with no server rewrites, so it uses hash URLs.
const router = STATIC_PREVIEW ? createHashRouter(routes) : createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
