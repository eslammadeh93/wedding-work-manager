import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase/config';
import { firestorePaths } from './firestorePaths';
import { effectivePermissions, PERMISSION_MATRIX, type Permission } from './permissions';
import { PLATFORM_PERMISSION_MATRIX, PLATFORM_PERMISSIONS, type PlatformPermission } from './platform/permissions/platformPermissions';
import type { AuthSession, Company, CompanyMember, PlatformUser, PlatformUserRole } from './types';

export class MultiTenantAuthError extends Error {}
type WorkerLoginResult = { success: boolean; code: string; message: string; customToken?: string; retryAfterSeconds?: number };

// Company workspaces keep their selected tab in session storage, while the
// platform workspace has URL-based routes that should remain shareable.
export const getPostLoginPath = (session: AuthSession): string => session.userType === 'platform' ? '/platform' : '/';

function assertCompanyAllowsLogin(company: Company) {
  const deadline = new Date(company.gracePeriodEnd || company.subscriptionEnd).getTime();
  if (company.status === 'suspended' || company.status === 'expired' || (Number.isFinite(deadline) && Date.now() > deadline)) {
    throw new MultiTenantAuthError('لا يسمح وضع الشركة بتسجيل الدخول.');
  }
}

export async function resolveMultiTenantSession(user: User): Promise<AuthSession> {
  const debug = (step: string, details: Record<string, unknown>) => console.info(`[auth-resolution] ${step}`, details);
  try {
  debug('start', { authenticated: true });
  const token = await user.getIdTokenResult(true);
  const tokenRole = typeof token.claims.role === 'string' ? token.claims.role : null;
  const tokenCompanyId = typeof token.claims.companyId === 'string' ? token.claims.companyId : null;
  const hasOwnerClaim = token.claims.platform_owner === true;
  const platformRoleClaim = typeof token.claims.platformRole === 'string' ? token.claims.platformRole : null;
  const isPlatformLogin = hasOwnerClaim || platformRoleClaim !== null;
  debug('getIdTokenResult', { platformOwner: hasOwnerClaim, platformRole: platformRoleClaim, hasRole: Boolean(tokenRole), role: tokenRole, hasCompanyId: Boolean(tokenCompanyId), companyId: tokenCompanyId });
  if (isPlatformLogin) {
    const platformSnapshot = await getDoc(doc(db, firestorePaths.platformUser(user.uid)));
    const platformProfile = platformSnapshot.exists() ? platformSnapshot.data() as PlatformUser : null;
    debug('platform profile', { found: platformSnapshot.exists(), active: platformProfile?.status === 'active' });
    const platformRole = platformProfile?.role as PlatformUserRole | undefined;
    if (!platformRole || !['platform_owner', 'platform_admin', 'platform_support', 'platform_billing', 'platform_read_only'].includes(platformRole)) throw new MultiTenantAuthError('تعذر التحقق من صلاحيات حساب المنصة.');
    if ((hasOwnerClaim && platformRole !== 'platform_owner') || (platformRoleClaim && platformRoleClaim !== platformRole)) throw new MultiTenantAuthError('تعذر التحقق من صلاحيات حساب المنصة.');
    if (platformProfile.status !== 'active') throw new MultiTenantAuthError('الحساب معطّل.');
    const savedPlatformPermissions = platformProfile.permissionsCustomized === true && Array.isArray(platformProfile.permissions)
      ? platformProfile.permissions.filter((permission): permission is PlatformPermission => typeof permission === 'string' && (PLATFORM_PERMISSIONS as readonly string[]).includes(permission))
      : undefined;
    return { uid: user.uid, email: user.email || platformProfile.email, displayName: platformProfile.name, userType: 'platform', role: platformRole, permissions: savedPlatformPermissions || PLATFORM_PERMISSION_MATRIX[platformRole] };
  }
  if (!tokenCompanyId || !tokenRole) throw new MultiTenantAuthError('تعذر التحقق من صلاحيات الحساب.');
  const memberSnapshot = await getDoc(doc(db, firestorePaths.companyMember(tokenCompanyId, user.uid)));
  debug('membership', { found: memberSnapshot.exists(), companyId: tokenCompanyId });
  if (!memberSnapshot.exists()) throw new MultiTenantAuthError('تعذر التحقق من عضوية الشركة.');
  const member = memberSnapshot.data() as CompanyMember;
  if (member.uid !== user.uid || member.status !== 'active' || member.role !== tokenRole) throw new MultiTenantAuthError('الحساب معطّل أو غير صالح.');
  const companySnapshot = await getDoc(doc(db, firestorePaths.company(tokenCompanyId)));
  if (!companySnapshot.exists()) throw new MultiTenantAuthError('تعذر التحقق من الشركة.');
  const company = companySnapshot.data() as Company;
  debug('company', { companyId: tokenCompanyId, status: company.status, active: company.status === 'active' });
  assertCompanyAllowsLogin(company);
  const savedPermissions = Array.isArray(member.permissions)
    ? member.permissions.filter((permission): permission is Permission => typeof permission === 'string')
    : undefined;
  return { uid: user.uid, email: user.email || member.email, displayName: member.name, userType: 'company', role: member.role, companyId: tokenCompanyId, memberStatus: member.status, companyStatus: company.status, permissions: effectivePermissions(member.role, savedPermissions) };
  } catch (error) {
    console.error('[auth-resolution] exception at resolveMultiTenantSession', { source: 'src/multiTenant/auth.ts', name: error instanceof Error ? error.name : 'unknown', code: (error as { code?: unknown })?.code ?? null, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null });
    throw error;
  }
}

export async function requestWorkerCustomToken(companyCode: string, username: string, loginCode: string): Promise<WorkerLoginResult> {
  const callable = httpsCallable<{ companyCode: string; username: string; loginCode: string }, WorkerLoginResult>(functions, 'workerLogin');
  try {
    const result = await callable({ companyCode, username, loginCode });
    return result.data;
  } catch {
    return { success: false, code: 'INVALID_CREDENTIALS', message: 'بيانات الدخول غير صحيحة.' };
  }
}
