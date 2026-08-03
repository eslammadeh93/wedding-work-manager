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
  "platform:subscriptions:read",
  "platform:audit_logs:read",
  "platform:developer_tools:manage",
  "platform:support:impersonate",
  "platform:admins:manage",
  "platform:dangerous_delete",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

const allPermissions = [...PLATFORM_PERMISSIONS] as const;

export const PLATFORM_PERMISSION_MATRIX: Readonly<
  Record<PlatformRole, readonly PlatformPermission[]>
> = {
  platform_owner: allPermissions,
  platform_admin: [
    "platform:dashboard:read",
    "platform:companies:read",
    "platform:companies:create",
    "platform:companies:update",
    "platform:companies:suspend",
    "platform:companies:archive",
    "platform:users:read",
    "platform:subscriptions:read",
    "platform:audit_logs:read",
  ],
  platform_support: [
    "platform:dashboard:read",
    "platform:companies:read",
    "platform:users:read",
    "platform:audit_logs:read",
    "platform:support:impersonate",
  ],
  platform_billing: [
    "platform:dashboard:read",
    "platform:companies:read",
    "platform:companies:update",
    "platform:subscriptions:read",
    "platform:audit_logs:read",
  ],
  platform_read_only: [
    "platform:dashboard:read",
    "platform:companies:read",
    "platform:users:read",
    "platform:subscriptions:read",
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
