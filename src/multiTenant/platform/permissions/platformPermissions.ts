export const PLATFORM_ROLES = [
  "platform_owner",
  "platform_admin",
  "platform_support",
  "platform_billing",
  "platform_read_only",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_PERMISSIONS = [
  "platform:dashboard:read",
  "platform:companies:read",
  "platform:companies:create",
  "platform:companies:update",
  "platform:companies:suspend",
  "platform:companies:archive",
  "platform:users:read",
  "platform:users:manage",
  "platform:subscriptions:read",
  "platform:subscriptions:manage",
  "platform:plans:read",
  "platform:plans:manage",
  "platform:audit_logs:read",
  "platform:console:read",
  "platform:notifications:manage",
  "platform:support:manage",
  "platform:settings:manage",
  "platform:developer_tools:manage",
  "platform:support:impersonate",
  "platform:admins:manage",
  "platform:dangerous_delete",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const PLATFORM_PERMISSION_LABELS: Readonly<Record<PlatformPermission, string>> = {
  'platform:dashboard:read': 'لوحة التحكم', 'platform:companies:read': 'عرض الشركات', 'platform:companies:create': 'إنشاء الشركات', 'platform:companies:update': 'تعديل الشركات', 'platform:companies:suspend': 'إيقاف الشركات', 'platform:companies:archive': 'أرشفة الشركات', 'platform:users:read': 'عرض المستخدمين', 'platform:users:manage': 'إدارة المستخدمين', 'platform:subscriptions:read': 'عرض الاشتراكات', 'platform:subscriptions:manage': 'إدارة الاشتراكات', 'platform:plans:read': 'رؤية الباقات', 'platform:plans:manage': 'تعديل الباقات', 'platform:audit_logs:read': 'سجل النشاط', 'platform:console:read': 'عرض لوحة المنصة', 'platform:notifications:manage': 'إدارة الإشعارات', 'platform:support:manage': 'إدارة الدعم الفني', 'platform:settings:manage': 'إعدادات النظام', 'platform:developer_tools:manage': 'أدوات المطور', 'platform:support:impersonate': 'دخول الدعم بالنيابة', 'platform:admins:manage': 'إدارة المشرفين والصلاحيات', 'platform:dangerous_delete': 'الحذف الحساس',
};

const allPermissions = [...PLATFORM_PERMISSIONS] as const;

export const PLATFORM_PERMISSION_MATRIX: Readonly<
  Record<PlatformRole, readonly PlatformPermission[]>
> = {
  platform_owner: allPermissions,
  platform_admin: [
    "platform:dashboard:read",
    "platform:companies:read",
    "platform:companies:update",
    "platform:companies:suspend",
    "platform:companies:archive",
    "platform:users:read",
    "platform:users:manage",
    "platform:subscriptions:read",
    "platform:plans:read",
    "platform:audit_logs:read",
    "platform:console:read",
    "platform:notifications:manage",
    "platform:support:manage",
  ],
  platform_support: [
    "platform:dashboard:read",
    "platform:companies:read",
    "platform:users:read",
    "platform:audit_logs:read",
    "platform:console:read",
    "platform:support:manage",
    "platform:support:impersonate",
  ],
  platform_billing: [
    "platform:dashboard:read",
    "platform:companies:read",
    "platform:subscriptions:read",
    "platform:subscriptions:manage",
    "platform:plans:read",
    "platform:audit_logs:read",
  ],
  platform_read_only: [
    "platform:dashboard:read",
    "platform:companies:read",
    "platform:users:read",
    "platform:subscriptions:read",
    "platform:plans:read",
    "platform:audit_logs:read",
  ],
};

export const isPlatformRole = (value: unknown): value is PlatformRole =>
  typeof value === "string" &&
  (PLATFORM_ROLES as readonly string[]).includes(value);

export const platformRoleHasPermission = (
  role: PlatformRole,
  permission: PlatformPermission,
): boolean => PLATFORM_PERMISSION_MATRIX[role].includes(permission);

/** Frontend capability hint only. Backend enforcement will remain authoritative. */
export const platformRolePermissions = (
  role: PlatformRole,
): readonly PlatformPermission[] => PLATFORM_PERMISSION_MATRIX[role];
