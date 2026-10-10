/**
 * Single source of truth for society roles and the permissions they grant.
 * The API enforces these server-side; the web app only uses them to shape navigation.
 */

export const SOCIETY_ROLES = ['admin', 'committee', 'guard', 'resident', 'staff'] as const;
export type SocietyRole = (typeof SOCIETY_ROLES)[number];

export const ROLE_LABELS: Record<SocietyRole, string> = {
  admin: 'Society Admin',
  committee: 'Committee Member',
  guard: 'Security Guard',
  resident: 'Resident',
  staff: 'Maintenance Staff',
};

export const PERMISSIONS = [
  'society.settings.manage',
  'structure.view',
  'structure.manage',
  'members.view',
  'members.manage',
  'household.manageOwn',
  'visitors.invite',
  'visitors.viewOwn',
  'visitors.viewAll',
  'visitors.decideOwnUnit',
  'gate.operate',
  'vehicles.manageOwn',
  'vehicles.viewAll',
  'vehicles.lookup',
  'parking.manage',
  'parking.viewOwn',
  'complaints.create',
  'complaints.viewOwn',
  'complaints.viewAll',
  'complaints.assign',
  'workOrders.viewAssigned',
  'workOrders.update',
  'announcements.view',
  'announcements.manage',
  'amenities.view',
  'amenities.book',
  'amenities.manage',
  'bookings.viewAll',
  'reports.view',
  'reports.export',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<SocietyRole, readonly Permission[]> = {
  admin: [
    'society.settings.manage',
    'structure.view',
    'structure.manage',
    'members.view',
    'members.manage',
    'visitors.viewAll',
    'gate.operate',
    'vehicles.viewAll',
    'vehicles.lookup',
    'parking.manage',
    'complaints.create',
    'complaints.viewAll',
    'complaints.assign',
    'workOrders.update',
    'announcements.view',
    'announcements.manage',
    'amenities.view',
    'amenities.manage',
    'bookings.viewAll',
    'reports.view',
    'reports.export',
    'audit.view',
  ],
  committee: [
    'structure.view',
    'members.view',
    'complaints.viewAll',
    'announcements.view',
    'announcements.manage',
    'amenities.view',
    'bookings.viewAll',
    'reports.view',
    'reports.export',
  ],
  guard: ['gate.operate', 'vehicles.lookup', 'announcements.view'],
  resident: [
    'household.manageOwn',
    'visitors.invite',
    'visitors.viewOwn',
    'visitors.decideOwnUnit',
    'vehicles.manageOwn',
    'parking.viewOwn',
    'complaints.create',
    'complaints.viewOwn',
    'announcements.view',
    'amenities.view',
    'amenities.book',
  ],
  staff: ['workOrders.viewAssigned', 'workOrders.update', 'announcements.view'],
};

export function permissionsFor(role: SocietyRole): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function hasPermission(role: SocietyRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Roles that require the membership to be bound to a unit. */
export function roleRequiresUnit(role: SocietyRole): boolean {
  return role === 'resident';
}

export function isSocietyRole(value: unknown): value is SocietyRole {
  return typeof value === 'string' && (SOCIETY_ROLES as readonly string[]).includes(value);
}
