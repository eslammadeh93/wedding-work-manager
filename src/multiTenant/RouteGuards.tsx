import type { ReactNode } from 'react';
import { hasPermission, type Permission } from './permissions';
import { useTenant } from './TenantContext';
import { useAuth } from '../context/AuthContext';
import type { CompanyMemberRole } from './types';

interface GuardProps { children: ReactNode; fallback?: ReactNode; }

export function PlatformRouteGuard({ children, fallback = null }: GuardProps) {
  const { authSession, loading } = useAuth();
  if (loading) return null;
  return authSession?.userType === 'platform' && authSession.role === 'platform_owner' ? <>{children}</> : <>{fallback}</>;
}

interface CompanyRouteGuardProps extends GuardProps { roles?: readonly CompanyMemberRole[]; permission?: Permission; }

export function CompanyRouteGuard({ children, fallback = null, roles, permission }: CompanyRouteGuardProps) {
  const { company, member } = useTenant();
  const isActiveMember = Boolean(company && member && member.companyId === company.id && member.status === 'active');
  const allowedRole = !roles || (member ? roles.includes(member.role) : false);
  const allowedPermission = !permission || (member ? hasPermission(member.role, permission) : false);
  return isActiveMember && allowedRole && allowedPermission ? <>{children}</> : <>{fallback}</>;
}
