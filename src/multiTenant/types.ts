/**
 * SaaS tenancy contracts. These are intentionally separate from the legacy
 * application models. Legacy records remain separate, read-only archives.
 */
export type RecordTimestamp = string | Date;

export type PlatformUserRole = 'platform_owner' | 'platform_admin' | 'platform_support' | 'platform_billing' | 'platform_read_only';
export type CompanyMemberRole = 'company_super_admin' | 'manager' | 'employee' | 'worker';
export type SaaSRole = PlatformUserRole | CompanyMemberRole;

export type AccountStatus = 'active' | 'disabled';
export type CompanyStatus = 'trial' | 'active' | 'past_due' | 'expired' | 'suspended';

export interface PlatformUser {
  uid: string;
  name: string;
  email: string;
  role: PlatformUserRole;
  status: AccountStatus;
  /** Effective permissions for this account; custom values override its role defaults. */
  permissions?: string[];
  permissionsCustomized?: boolean;
  createdAt: RecordTimestamp;
  updatedAt: RecordTimestamp;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  companyCode: string;
  status: CompanyStatus;
  plan: string;
  subscriptionStart: RecordTimestamp;
  subscriptionEnd: RecordTimestamp;
  gracePeriodEnd?: RecordTimestamp;
  maxUsers: number;
  features: string[];
  createdAt: RecordTimestamp;
  createdBy: string;
}

export interface CompanyMember {
  uid: string;
  companyId: string;
  name: string;
  email: string;
  role: CompanyMemberRole;
  status: AccountStatus;
  workerId?: string;
  /** Custom job type shown in employee management, e.g. accountant. */
  employeeType?: string;
  /** Explicit permissions for this account. Missing means legacy role defaults. */
  permissions?: import('./permissions').Permission[];
  createdAt: RecordTimestamp;
  createdBy: string;
}

export interface AuthSession {
  uid: string;
  email: string;
  displayName: string;
  userType: 'platform' | 'company';
  role: SaaSRole;
  companyId?: string;
  memberStatus?: AccountStatus;
  companyStatus?: CompanyStatus;
  permissions: readonly string[];
}
