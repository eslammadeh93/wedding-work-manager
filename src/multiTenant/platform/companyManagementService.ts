import type { CompanyManagementRequest, CreateAdditionalCompanyOwnerRequest, CreateCompanyRequest, PlatformCompanyContact, PlatformCompanyOrderAnalytics, UpdateCompanyRequest, UpdatePlatformCompanyOrderRequest } from './types';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../../firebase/config';

export class PlatformProvisioningUnavailableError extends Error {
  constructor() { super('خدمة تجهيز الشركات في الخادم غير متاحة بعد. لم يتم إنشاء أي شركة أو حساب.'); }
}

/** Trusted Cloud Functions are the only browser-to-provisioning boundary. */
export const companyManagementService = {
  async createCompanyWithOwner(request: CreateCompanyRequest): Promise<void> {
    try {
      const call = httpsCallable<CreateCompanyRequest, { success: boolean; message: string }>(functions, 'createCompanyWithOwner');
      const result = await call(request);
      if (!result.data.success) throw new Error(result.data.message);
    } catch (error) {
      if (error instanceof Error && error.message) throw error;
      throw new PlatformProvisioningUnavailableError();
    }
  },
  async updateCompany(request: UpdateCompanyRequest): Promise<void> {
    const call = httpsCallable<UpdateCompanyRequest, { success: boolean; message: string }>(functions, 'updateCompany');
    const result = await call(request);
    if (!result.data.success) throw new Error(result.data.message);
  },
  async deleteCompany(data: { companyId: string; confirmation: string }): Promise<void> {
    const call = httpsCallable<typeof data, { success: boolean; message: string }>(functions, 'deletePlatformCompany');
    const result = await call(data);
    if (!result.data.success) throw new Error(result.data.message);
  },
  async createAdditionalOwner(request: CreateAdditionalCompanyOwnerRequest): Promise<void> {
    const call = httpsCallable<CreateAdditionalCompanyOwnerRequest, { success: boolean; message: string }>(functions, 'createAdditionalCompanyOwner');
    const result = await call(request);
    if (!result.data.success) throw new Error(result.data.message);
  },
  async getCompanyOrderAnalytics(companyId: string): Promise<PlatformCompanyOrderAnalytics> {
    const call = httpsCallable<{ companyId: string }, { success: boolean; message: string; analytics?: PlatformCompanyOrderAnalytics }>(functions, 'getPlatformCompanyOrderAnalytics');
    const result = await call({ companyId });
    if (!result.data.success || !result.data.analytics) throw new Error(result.data.message || 'تعذر تحميل تحليل طلبات الشركة.');
    return result.data.analytics;
  },
  async verifyCompanyDetailsPhone(data: { companyId: string; ownerPhone: string }): Promise<void> {
    const verify = async () => {
      // A section switch can leave a callable carrying a stale token. Renew it
      // before this sensitive verification so Firebase never renders it as a
      // meaningless "internal" browser error.
      await auth.currentUser?.getIdToken(true);
      const call = httpsCallable<typeof data, { success: boolean; message: string }>(functions, 'verifyPlatformCompanyDetailsPhone');
      const result = await call(data);
      if (!result.data.success) throw new Error(result.data.message);
    };
    try {
      await verify();
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code) : '';
      // Cloud Run may reject the first request while a fresh token propagates.
      // Retrying once is safe because the operation only writes an audit event.
      if (code === 'functions/internal' || code === 'functions/unauthenticated') {
        await verify();
        return;
      }
      throw error;
    }
  },
  async getCompanyContacts(): Promise<PlatformCompanyContact[]> {
    const call = httpsCallable<Record<string, never>, { success: boolean; message: string; contacts?: PlatformCompanyContact[] }>(functions, 'getPlatformCompanyContacts');
    const result = await call({});
    if (!result.data.success || !result.data.contacts) throw new Error(result.data.message || 'تعذر تحميل جهات التواصل.');
    return result.data.contacts;
  },
  async updateCompanyOrder(request: UpdatePlatformCompanyOrderRequest): Promise<void> {
    const call = httpsCallable<UpdatePlatformCompanyOrderRequest, { success: boolean; message: string }>(functions, 'updatePlatformCompanyOrder');
    const result = await call(request);
    if (!result.data.success) throw new Error(result.data.message);
  },
  async manageCompany(_request: CompanyManagementRequest): Promise<void> {
    throw new PlatformProvisioningUnavailableError();
  },
};
