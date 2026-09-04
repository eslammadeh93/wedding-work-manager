import type { Company, CompanyStatus, RecordTimestamp } from '../types';

export interface PlatformCompany extends Company {
  /** Optional denormalized value supplied by trusted backend provisioning. */
  memberCount?: number;
  ownerName?: string;
  ownerEmail?: string;
}

export interface PlatformPlan {
  id: string;
  name: string;
  /** Null means unlimited employees. */
  maxUsers: number | null;
}

export interface PlatformCompanyMember {
  uid: string;
  name: string;
  email?: string | null;
  role: string;
  status: string;
  phone?: string | null;
  jobTitle?: string | null;
  createdAt?: RecordTimestamp;
}

export interface PlatformCompanyContact {
  companyId: string;
  companyName: string;
  name: string;
  email: string;
  phone: string;
  status: string;
}

/** Owner-only read model returned by the trusted platform analytics endpoint. */
export interface PlatformCompanyOrder {
  id: string;
  month: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  bookingDate: string;
  eventDate: string;
  deliveryDate: string;
  returnDate: string;
  eventLocation: string;
  totalPrice: number;
  deposit: number;
  totalPaid: number;
  remainingBalance: number;
  workerCost: number;
  transportationCost: number;
  otherExpenses: number;
  orderStatus: string;
  notes: string;
}

export interface PlatformCompanyOrderMonth {
  month: string;
  orderCount: number;
}

/** Mirrors the company's monthly safe/collections report, not a new estimate. */
export interface PlatformCompanyMonthlyAccounts {
  month: string;
  netMonthlyCash: number;
  grossMonthlyIncome: number;
  completedOrdersNetProfit: number;
  retainedCancelledDeposits: number;
  upcomingOrderDepositsNet: number;
  upcomingOrderOtherExpenses: number;
  netMonthlyOrderProfit: number;
  expectedSettlementPayments: number;
  operatingExpenses: number;
}

export interface PlatformCompanyOrderAnalytics {
  totalOrders: number;
  totalNetProfit: number;
  growthRate: number | null;
  growthMonth: string | null;
  months: PlatformCompanyOrderMonth[];
  monthlyAccounts: PlatformCompanyMonthlyAccounts[];
  orders: PlatformCompanyOrder[];
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
  planId: string;
  plan: string;
  subscriptionStart: string;
  subscriptionEnd: string;
  maxUsers: number | null;
  features: string[];
  status: Extract<CompanyStatus, 'trial' | 'active'>;
}

export interface UpdateCompanyRequest { companyId: string; name: string; slug: string; companyCode: string; ownerName: string; ownerEmail: string; plan: string; status: CompanyStatus; subscriptionStart: string; subscriptionEnd: string; maxUsers: number | null; features: string[]; }
export interface CreateAdditionalCompanyOwnerRequest { companyId: string; name: string; email: string; temporaryPassword: string; }
export interface UpdatePlatformCompanyOrderRequest {
  companyId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  bookingDate: string;
  eventDate: string;
  deliveryDate: string;
  returnDate: string;
  eventLocation: string;
  totalPrice: number;
  deposit: number;
  totalPaid: number;
  workerCost: number;
  transportationCost: number;
  otherExpenses: number;
  orderStatus: string;
  notes: string;
}

export interface CompanyManagementRequest {
  companyId: string;
  name?: string;
  plan?: string;
  subscriptionEnd?: RecordTimestamp;
  maxUsers?: number | null;
  features?: string[];
  action?: 'suspend' | 'reactivate' | 'extend_subscription';
}
