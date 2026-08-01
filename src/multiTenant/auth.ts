import type { User } from 'firebase/auth';
import { collectionGroup, doc, documentId, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
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
  const [token, platformSnapshot] = await Promise.all([user.getIdTokenResult(true), getDoc(doc(db, firestorePaths.platformUser(user.uid)))]);
  const platformProfile = platformSnapshot.exists() ? platformSnapshot.data() as PlatformUser : null;
  const hasClaim = token.claims.platform_owner === true;
  const hasProfile = platformProfile?.role === 'platform_owner';
  if (hasClaim !== hasProfile) throw new MultiTenantAuthError('تعذر التحقق من صلاحيات الحساب.');
  if (hasClaim && hasProfile) {
    if (platformProfile.status !== 'active') throw new MultiTenantAuthError('الحساب معطّل.');
    return { uid: user.uid, email: user.email || platformProfile.email, displayName: platformProfile.name, userType: 'platform', role: 'platform_owner', permissions: PERMISSION_MATRIX.platform_owner };
  }
  const memberships = await getDocs(query(collectionGroup(db, 'members'), where(documentId(), '==', user.uid), limit(2)));
  if (memberships.size !== 1) throw new MultiTenantAuthError('تعذر التحقق من عضوية الشركة.');
  const member = memberships.docs[0].data() as CompanyMember;
  if (member.uid !== user.uid || member.status !== 'active') throw new MultiTenantAuthError('الحساب معطّل أو غير صالح.');
  const companySnapshot = await getDoc(doc(db, firestorePaths.company(member.companyId)));
  if (!companySnapshot.exists()) throw new MultiTenantAuthError('تعذر التحقق من الشركة.');
  const company = companySnapshot.data() as Company;
  assertCompanyAllowsLogin(company);
  return { uid: user.uid, email: user.email || member.email, displayName: member.name, userType: 'company', role: member.role, companyId: member.companyId, memberStatus: member.status, companyStatus: company.status, permissions: PERMISSION_MATRIX[member.role] };
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
