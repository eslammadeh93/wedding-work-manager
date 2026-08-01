/**
 * SaaS tenancy contracts. These are intentionally separate from the legacy
 * application models until the non-destructive migration phase begins.
 */
export type RecordTimestamp = string | Date;

export type PlatformUserRole = 'platform_owner';
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
  createdAt: RecordTimestamp;
  createdBy: string;
}
