import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Company, CompanyMember } from './types';

export interface TenantContextValue {
  company: Company | null;
  member: CompanyMember | null;
  setTenant: (company: Company | null, member: CompanyMember | null) => void;
  clearTenant: () => void;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  const [company, setCompany] = useState<Company | null>(null);
  const [member, setMember] = useState<CompanyMember | null>(null);
  const value = useMemo<TenantContextValue>(() => ({
    company,
    member,
    setTenant: (nextCompany, nextMember) => {
      if (nextCompany && nextMember && nextCompany.id !== nextMember.companyId) {
        throw new Error('Company member must belong to the active company.');
      }
      if (Boolean(nextCompany) !== Boolean(nextMember)) {
        throw new Error('A tenant requires both a company and its member.');
      }
      setCompany(nextCompany);
      setMember(nextMember);
    },
    clearTenant: () => { setCompany(null); setMember(null); },
  }), [company, member]);
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (!context) throw new Error('useTenant must be used within TenantProvider.');
  return context;
}
