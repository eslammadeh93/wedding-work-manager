import type { SaaSRole } from './types';

export const PERMISSIONS = [
  'platform:companies:read',
  'platform:companies:write',
  'platform:users:read',
  'platform:users:write',
  'platform:audit_logs:read',
  'company:dashboard:read',
  'company:orders:read',
  'company:orders:write',
  'company:customers:read',
  'company:customers:write',
  'company:workers:read',
  'company:workers:write',
  'company:inventory:read',
  'company:inventory:write',
  'company:expenses:read',
  'company:expenses:write',
  'company:categories:read',
  'company:categories:write',
  'company:activity_logs:read',
  'company:reports:read',
  'company:settings:read',
  'company:settings:write',
  'company:members:read',
  'company:members:write',
  'company:notifications:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const companyAdminPermissions: readonly Permission[] = [
  'company:dashboard:read', 'company:orders:read', 'company:orders:write',
  'company:customers:read', 'company:customers:write', 'company:workers:read',
  'company:workers:write', 'company:inventory:read', 'company:inventory:write',
  'company:expenses:read', 'company:expenses:write', 'company:categories:read',
  'company:categories:write', 'company:activity_logs:read', 'company:reports:read',
  'company:settings:read', 'company:settings:write', 'company:members:read',
  'company:members:write', 'company:notifications:read',
];

export const PERMISSION_MATRIX: Readonly<Record<SaaSRole, readonly Permission[]>> = {
  platform_owner: ['platform:companies:read', 'platform:companies:write', 'platform:users:read', 'platform:users:write', 'platform:audit_logs:read'],
  company_super_admin: companyAdminPermissions,
  manager: companyAdminPermissions.filter((permission) => !permission.startsWith('company:expenses:')),
  employee: ['company:dashboard:read', 'company:orders:read', 'company:orders:write', 'company:customers:read', 'company:customers:write', 'company:inventory:read', 'company:notifications:read'],
  worker: ['company:orders:read', 'company:notifications:read'],
};

export const hasPermission = (role: SaaSRole, permission: Permission): boolean =>
  PERMISSION_MATRIX[role].includes(permission);
