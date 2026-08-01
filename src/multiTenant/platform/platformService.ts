import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { CompanyStatus } from '../types';
import type { PlatformCompany, PlatformOverview } from './types';

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate();
  return null;
};

export const formatPlatformDate = (value: unknown) => {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(date) : '—';
};

export const daysUntil = (value: unknown) => {
  const date = toDate(value);
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
};

/** Reads only the platform-level companies collection; no tenant operational data. */
export async function listPlatformCompanies(): Promise<PlatformCompany[]> {
  const snapshot = await getDocs(query(collection(db, 'companies')));
  return snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<PlatformCompany, 'id'>) }));
}

export function summarizeCompanies(companies: PlatformCompany[]): PlatformOverview {
  const statuses: CompanyStatus[] = ['active', 'trial', 'past_due', 'expired', 'suspended'];
  const count = (status: CompanyStatus) => companies.filter((company) => company.status === status).length;
  const expiringSoonCompanies = companies
    .filter((company) => {
      const days = daysUntil(company.subscriptionEnd);
      return days !== null && days >= 0 && days <= 30 && company.status !== 'suspended' && company.status !== 'expired';
    })
    .sort((a, b) => (daysUntil(a.subscriptionEnd) ?? Infinity) - (daysUntil(b.subscriptionEnd) ?? Infinity));
  const memberCounts = companies.map((company) => company.memberCount).filter((value): value is number => typeof value === 'number');
  return {
    totalCompanies: companies.length,
    activeCompanies: count(statuses[0]), trialCompanies: count(statuses[1]), pastDueCompanies: count(statuses[2]),
    expiredCompanies: count(statuses[3]), suspendedCompanies: count(statuses[4]),
    totalMembers: memberCounts.length === companies.length ? memberCounts.reduce((sum, value) => sum + value, 0) : null,
    expiringSoonCompanies,
  };
}
