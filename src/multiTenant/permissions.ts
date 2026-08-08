import type { SaaSRole } from './types';

export const PERMISSIONS = [
  'platform:companies:read',
  'platform:companies:write',
  'platform:users:read',
  'platform:users:write',
  'platform:audit_logs:read',
  'company:dashboard:read',
  'company:calendar:read',
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
  'company:worker_performance:read',
  'company:reports:read',
  'company:settings:read',
  'company:settings:write',
  'company:members:read',
  'company:members:write',
  'company:notifications:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Arabic labels and grouping used by the employee-permissions editor. */
export const COMPANY_PERMISSION_GROUPS: ReadonlyArray<{ title: string; permissions: readonly Permission[] }> = [
  { title: 'لوحة العمل', permissions: ['company:dashboard:read', 'company:calendar:read', 'company:notifications:read'] },
  { title: 'العملاء والطلبات', permissions: ['company:customers:read', 'company:customers:write', 'company:orders:read', 'company:orders:write'] },
  { title: 'التشغيل والمخزون', permissions: ['company:workers:read', 'company:workers:write', 'company:worker_performance:read', 'company:inventory:read', 'company:inventory:write', 'company:categories:read', 'company:categories:write'] },
  { title: 'المالية والتقارير', permissions: ['company:expenses:read', 'company:expenses:write', 'company:reports:read', 'company:activity_logs:read'] },
  { title: 'الإدارة', permissions: ['company:settings:read', 'company:settings:write', 'company:members:read', 'company:members:write'] },
];

export const PERMISSION_LABELS: Readonly<Record<Permission, string>> = {
  'platform:companies:read': 'عرض الشركات', 'platform:companies:write': 'إدارة الشركات', 'platform:users:read': 'عرض مستخدمي المنصة', 'platform:users:write': 'إدارة مستخدمي المنصة', 'platform:audit_logs:read': 'سجل المنصة',
  'company:dashboard:read': 'لوحة التحكم', 'company:calendar:read': 'التقويم', 'company:orders:read': 'عرض الطلبات', 'company:orders:write': 'إضافة وتعديل الطلبات', 'company:customers:read': 'عرض العملاء', 'company:customers:write': 'إضافة وتعديل العملاء', 'company:workers:read': 'عرض العمال', 'company:workers:write': 'إدارة العمال', 'company:worker_performance:read': 'متابعة أداء العمال (تتطلب عرض الطلبات)', 'company:inventory:read': 'عرض المخزن', 'company:inventory:write': 'إدارة المخزن', 'company:expenses:read': 'عرض المالية والمصروفات', 'company:expenses:write': 'إدارة المالية والمصروفات', 'company:categories:read': 'عرض التصنيفات', 'company:categories:write': 'إدارة التصنيفات', 'company:activity_logs:read': 'سجل النشاط', 'company:reports:read': 'التقارير', 'company:settings:read': 'عرض الإعدادات', 'company:settings:write': 'إدارة الإعدادات', 'company:members:read': 'عرض الموظفين', 'company:members:write': 'إدارة الموظفين', 'company:notifications:read': 'الإشعارات',
};

const companyAdminPermissions: readonly Permission[] = [
  'company:dashboard:read', 'company:calendar:read', 'company:orders:read', 'company:orders:write',
  'company:customers:read', 'company:customers:write', 'company:workers:read',
  'company:workers:write', 'company:worker_performance:read', 'company:inventory:read', 'company:inventory:write',
  'company:expenses:read', 'company:expenses:write', 'company:categories:read',
  'company:categories:write', 'company:activity_logs:read', 'company:reports:read',
  'company:settings:read', 'company:settings:write', 'company:members:read',
  'company:members:write', 'company:notifications:read',
];

export const PERMISSION_MATRIX: Readonly<Record<SaaSRole, readonly Permission[]>> = {
  platform_owner: ['platform:companies:read', 'platform:companies:write', 'platform:users:read', 'platform:users:write', 'platform:audit_logs:read'],
  platform_admin: ['platform:companies:read', 'platform:companies:write', 'platform:users:read', 'platform:users:write', 'platform:audit_logs:read'],
  platform_support: ['platform:companies:read', 'platform:users:read'],
  platform_billing: ['platform:companies:read', 'platform:companies:write', 'platform:audit_logs:read'],
  platform_read_only: ['platform:companies:read', 'platform:users:read', 'platform:audit_logs:read'],
  company_super_admin: companyAdminPermissions,
  manager: companyAdminPermissions.filter((permission) => !permission.startsWith('company:expenses:')),
  employee: ['company:dashboard:read', 'company:calendar:read', 'company:orders:read', 'company:orders:write', 'company:customers:read', 'company:customers:write', 'company:inventory:read', 'company:notifications:read'],
  worker: ['company:orders:read', 'company:worker_performance:read', 'company:notifications:read'],
};

export const hasPermission = (role: SaaSRole, permission: Permission): boolean =>
  PERMISSION_MATRIX[role].includes(permission);

/** A member's saved permission list overrides its legacy role defaults. */
export const effectivePermissions = (role: SaaSRole, permissions?: readonly Permission[] | null): readonly Permission[] =>
  Array.from(new Set([
    ...(permissions && Array.isArray(permissions) ? permissions : PERMISSION_MATRIX[role]),
    ...(['company_super_admin', 'manager', 'worker'].includes(role) ? ['company:worker_performance:read' as Permission] : []),
  ]));

export const memberHasPermission = (role: SaaSRole, permissions: readonly Permission[] | null | undefined, permission: Permission): boolean =>
  effectivePermissions(role, permissions).includes(permission);
