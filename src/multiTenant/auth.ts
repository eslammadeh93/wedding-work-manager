import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase/config';
import { firestorePaths } from './firestorePaths';
import { PERMISSION_MATRIX } from './permissions';
import type { AuthSession, Company, CompanyMember, PlatformUser } from './types';

export class MultiTenantAuthError extends Error {}
type WorkerLoginResult = { success: boolean; code: string; message: string; customToken?: string; retryAfterSeconds?: number };

export const getPostLoginPath = (session: AuthSession): string => session.userType === 'platform' ? '/platform' : session.role === 'worker' ? '/worker' : '/company';

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
  const hasClaim = token.claims.platform_owner === true;
  debug('getIdTokenResult', { platformOwner: hasClaim, hasRole: Boolean(tokenRole), role: tokenRole, hasCompanyId: Boolean(tokenCompanyId), companyId: tokenCompanyId });
  if (hasClaim) {
    const platformSnapshot = await getDoc(doc(db, firestorePaths.platformUser(user.uid)));
    const platformProfile = platformSnapshot.exists() ? platformSnapshot.data() as PlatformUser : null;
    debug('platform profile', { found: platformSnapshot.exists(), active: platformProfile?.status === 'active' });
    if (platformProfile?.role !== 'platform_owner') throw new MultiTenantAuthError('تعذر التحقق من صلاحيات حساب المنصة.');
    if (platformProfile.status !== 'active') throw new MultiTenantAuthError('الحساب معطّل.');
    return { uid: user.uid, email: user.email || platformProfile.email, displayName: platformProfile.name, userType: 'platform', role: 'platform_owner', permissions: PERMISSION_MATRIX.platform_owner };
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
  return { uid: user.uid, email: user.email || member.email, displayName: member.name, userType: 'company', role: member.role, companyId: tokenCompanyId, memberStatus: member.status, companyStatus: company.status, permissions: PERMISSION_MATRIX[member.role] };
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
