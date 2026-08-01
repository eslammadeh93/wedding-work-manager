import type { CompanyManagementRequest, CreateCompanyRequest } from './types';

export class PlatformProvisioningUnavailableError extends Error {
  constructor() { super('خدمة تجهيز الشركات في الخادم غير متاحة بعد. لم يتم إنشاء أي شركة أو حساب.'); }
}

/**
 * Contract for future trusted Cloud Functions. These methods intentionally do
 * not write Firestore or Firebase Auth from the browser.
 */
export const companyManagementService = {
  async createCompanyWithOwner(_request: CreateCompanyRequest): Promise<void> {
    throw new PlatformProvisioningUnavailableError();
  },
  async manageCompany(_request: CompanyManagementRequest): Promise<void> {
    throw new PlatformProvisioningUnavailableError();
  },
};
