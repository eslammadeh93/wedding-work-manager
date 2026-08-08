import type { ReactNode } from 'react';
import { memberHasPermission, type Permission } from './permissions';
import { useTenant } from './TenantContext';
import { useAuth } from '../context/AuthContext';
import type { CompanyMemberRole } from './types';

interface GuardProps { children: ReactNode; fallback?: ReactNode; }

export function PlatformRouteGuard({ children, fallback = null }: GuardProps) {
  const { authSession, loading } = useAuth();
  if (loading) return null;
  return authSession?.userType === 'platform' ? <>{children}</> : <>{fallback}</>;
}

interface CompanyRouteGuardProps extends GuardProps { roles?: readonly CompanyMemberRole[]; permission?: Permission; }

export function CompanyRouteGuard({ children, fallback = null, roles, permission }: CompanyRouteGuardProps) {
  const { company, member } = useTenant();
  const isActiveMember = Boolean(company && member && member.companyId === company.id && member.status === 'active');
  const allowedRole = !roles || (member ? roles.includes(member.role) : false);
  const allowedPermission = !permission || (member ? memberHasPermission(member.role, member.permissions, permission) : false);
  return isActiveMember && allowedRole && allowedPermission ? <>{children}</> : <>{fallback}</>;
}

/** Guards staged company routes using the authenticated session, rather than a URL parameter. */
export function CompanySessionRouteGuard({ children, fallback = null, roles, permission }: CompanyRouteGuardProps) {
  const { authSession } = useAuth();
  const companyRole = authSession?.userType === 'company' ? authSession.role as CompanyMemberRole : undefined;
  const active = authSession?.userType === 'company' && authSession.memberStatus === 'active' && Boolean(authSession.companyId);
  const allowedRole = !roles || (companyRole ? roles.includes(companyRole) : false);
  const allowedPermission = !permission || Boolean(authSession?.permissions.includes(permission));
  return active && allowedRole && allowedPermission ? <>{children}</> : <>{fallback}</>;
}
