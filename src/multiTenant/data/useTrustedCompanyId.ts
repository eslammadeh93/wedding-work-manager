import { useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import type { AuthSession } from '../types';

export class TrustedCompanyContextError extends Error { constructor(message: string) { super(message); this.name = 'TrustedCompanyContextError'; } }

export const trustedCompanyIdFromSession = (session: AuthSession | null): string => {
  if (!session) throw new TrustedCompanyContextError('يرجى تسجيل الدخول أولاً.');
  if (session.userType !== 'company' || session.role === 'platform_owner') throw new TrustedCompanyContextError('هذا الحساب غير مرتبط بشركة.');
  if (session.memberStatus !== 'active') throw new TrustedCompanyContextError('عضوية الشركة غير نشطة.');
  if (!session.companyId) throw new TrustedCompanyContextError('لم يتم العثور على الشركة.');
  return session.companyId;
};

export function useTrustedCompanyId() {
  const { authSession } = useAuth();
  return useCallback(() => trustedCompanyIdFromSession(authSession), [authSession]);
}
