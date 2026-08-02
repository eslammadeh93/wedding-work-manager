import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { USE_MULTI_TENANT_DATA } from './featureFlags';
import type { AccountStatus, CompanyMemberRole, RecordTimestamp } from './types';

export interface CompanyMemberListItem {
  uid: string;
  name: string;
  email: string | null;
  username?: string | null;
  role: CompanyMemberRole;
  status: AccountStatus;
  phone?: string | null;
  jobTitle?: string | null;
  workerId?: string;
  createdAt?: RecordTimestamp;
  createdBy?: string;
}

/**
 * Read-only tenant data access. The company ID is deliberately accepted only
 * from the authenticated session at its call site; it is never read from the
 * URL, a form, or browser storage.
 */
export async function listCompanyMembers(trustedCompanyId: string): Promise<CompanyMemberListItem[]> {
  if (!USE_MULTI_TENANT_DATA || !trustedCompanyId) return [];
  const snapshot = await getDocs(collection(db, 'companies', trustedCompanyId, 'members'));
  return snapshot.docs.map((member) => {
    const data = member.data() as Omit<CompanyMemberListItem, 'uid'>;
    return {
      uid: member.id,
      name: typeof data.name === 'string' ? data.name : '',
      email: typeof data.email === 'string' ? data.email : null,
      username: typeof data.username === 'string' ? data.username : null,
      role: data.role,
      status: data.status,
      phone: typeof data.phone === 'string' ? data.phone : null,
      jobTitle: typeof data.jobTitle === 'string' ? data.jobTitle : null,
      workerId: typeof data.workerId === 'string' ? data.workerId : undefined,
      createdAt: data.createdAt,
      createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    };
  });
}
