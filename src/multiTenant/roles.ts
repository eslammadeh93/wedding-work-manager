import type { CompanyMemberRole, PlatformUserRole, SaaSRole } from './types';

export const PLATFORM_ROLES = [
  'platform_owner',
  'platform_admin',
  'platform_support',
  'platform_billing',
  'platform_read_only',
] as const satisfies readonly PlatformUserRole[];
export const COMPANY_MEMBER_ROLES = [
  'company_super_admin',
  'manager',
  'employee',
  'worker',
] as const satisfies readonly CompanyMemberRole[];
export const SAAS_ROLES = [...PLATFORM_ROLES, ...COMPANY_MEMBER_ROLES] as const satisfies readonly SaaSRole[];

export const isPlatformRole = (role: SaaSRole): role is PlatformUserRole =>
  (PLATFORM_ROLES as readonly string[]).includes(role);

export const isCompanyMemberRole = (role: SaaSRole): role is CompanyMemberRole =>
  (COMPANY_MEMBER_ROLES as readonly string[]).includes(role);
