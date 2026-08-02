import type { CompanyManagementRequest, CreateAdditionalCompanyOwnerRequest, CreateCompanyRequest, UpdateCompanyRequest } from './types';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';

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
  async createAdditionalOwner(request: CreateAdditionalCompanyOwnerRequest): Promise<void> {
    const call = httpsCallable<CreateAdditionalCompanyOwnerRequest, { success: boolean; message: string }>(functions, 'createAdditionalCompanyOwner');
    const result = await call(request);
    if (!result.data.success) throw new Error(result.data.message);
  },
  async manageCompany(_request: CompanyManagementRequest): Promise<void> {
    throw new PlatformProvisioningUnavailableError();
  },
};
