import type { Company, CompanyStatus, RecordTimestamp } from '../types';

export interface PlatformCompany extends Company {
  /** Optional denormalized value supplied by trusted backend provisioning. */
  memberCount?: number;
  ownerName?: string;
  ownerEmail?: string;
}

export interface PlatformOverview {
  totalCompanies: number;
  activeCompanies: number;
  trialCompanies: number;
  pastDueCompanies: number;
  expiredCompanies: number;
  suspendedCompanies: number;
  totalMembers: number | null;
  expiringSoonCompanies: PlatformCompany[];
}

export interface CreateCompanyRequest {
  companyName: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  plan: string;
  subscriptionStart: string;
  subscriptionEnd: string;
  maxUsers: number;
  features: string[];
  status: Extract<CompanyStatus, 'trial' | 'active'>;
}

export interface UpdateCompanyRequest { companyId: string; name: string; slug: string; companyCode: string; ownerName: string; ownerEmail: string; plan: string; status: CompanyStatus; subscriptionStart: string; subscriptionEnd: string; maxUsers: number; features: string[]; }

export interface CompanyManagementRequest {
  companyId: string;
  name?: string;
  plan?: string;
  subscriptionEnd?: RecordTimestamp;
  maxUsers?: number;
  features?: string[];
  action?: 'suspend' | 'reactivate' | 'extend_subscription';
}
