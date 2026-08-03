/** Pure Cloud Functions DTOs. This module intentionally has no Firebase imports. */
export type CompanyMemberError = 'OK' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'COMPANY_NOT_FOUND' | 'COMPANY_INACTIVE' | 'MEMBER_NOT_FOUND' | 'MEMBER_DISABLED' | 'EMAIL_EXISTS' | 'USERNAME_EXISTS' | 'MAX_USERS_REACHED' | 'ROLE_NOT_ALLOWED' | 'SELF_ROLE_CHANGE_FORBIDDEN' | 'SELF_DISABLE_FORBIDDEN' | 'CANNOT_MANAGE_COMPANY_ADMIN' | 'LAST_COMPANY_ADMIN' | 'AUTH_CREATION_FAILED' | 'MEMBER_CREATION_FAILED' | 'WORKER_CREATION_FAILED' | 'AUDIT_LOG_FAILED' | 'RESET_NOT_SUPPORTED' | 'ROLLBACK_FAILED' | 'UNKNOWN_ERROR';
export type ManagedRole = 'manager' | 'employee' | 'worker';
export type CompanyRole = ManagedRole | 'company_super_admin';
export type CompanyMemberResponse<T = Record<string, never>> = { success: boolean; code: CompanyMemberError; message: string; data?: T };
export interface CreateCompanyMemberRequest { name: string; role: ManagedRole; email?: string; temporaryPassword?: string; jobTitle?: string; username?: string; loginCode?: string; phone?: string; notes?: string; companyId?: string; }
export interface UpdateCompanyMemberRequest { uid: string; name?: string; phone?: string; jobTitle?: string; displaySettings?: Record<string, boolean | string | number>; companyId?: string; }
export interface ChangeCompanyMemberRoleRequest { uid: string; role: ManagedRole; companyId?: string; }
export interface DisableCompanyMemberRequest { uid: string; companyId?: string; }
export interface ReactivateCompanyMemberRequest { uid: string; companyId?: string; }
export interface SendCompanyMemberPasswordResetRequest { uid: string; companyId?: string; }
export interface ResetWorkerLoginCodeRequest { workerId: string; loginCode: string; companyId?: string; }
export interface DeleteCompanyMemberRequest { uid: string; companyId?: string; }
export interface DeleteWorkerRequest { workerId: string; companyId?: string; }
export interface UpdateWorkerRequest { workerId: string; name?: string; username?: string; phone?: string; jobTitle?: string; notes?: string; }
export interface SetWorkerStatusRequest { workerId: string; status: 'active' | 'inactive'; }
export interface RecordOrderActivityRequest { orderId: string; action: 'opened' | 'arrived' | 'finished'; }
export interface UpdateWorkerOrderStatusRequest { orderId: string; status: 'preparing' | 'in_progress' | 'completed'; }
export interface MarkCompanyNotificationsReadRequest { notificationIds: string[]; }
export interface UpdateOwnCompanyProfileRequest { name?: string; phone?: string; newPassword?: string; }
export type CreateCompanyMemberResponse = CompanyMemberResponse<{ uid: string; workerId?: string; companyCode?: string } | Record<string, never>>;
export type UpdateCompanyMemberResponse = CompanyMemberResponse;
export type ChangeCompanyMemberRoleResponse = CompanyMemberResponse;
export type DisableCompanyMemberResponse = CompanyMemberResponse;
export type ReactivateCompanyMemberResponse = CompanyMemberResponse;
export type SendCompanyMemberPasswordResetResponse = CompanyMemberResponse<{ testResetLink?: string }>;
export type ResetWorkerLoginCodeResponse = CompanyMemberResponse;
export type DeleteCompanyMemberResponse = CompanyMemberResponse;
export type DeleteWorkerResponse = CompanyMemberResponse;
export type UpdateWorkerResponse = CompanyMemberResponse;
export type SetWorkerStatusResponse = CompanyMemberResponse;
export type RecordOrderActivityResponse = CompanyMemberResponse;
export type UpdateWorkerOrderStatusResponse = CompanyMemberResponse;
export type MarkCompanyNotificationsReadResponse = CompanyMemberResponse;
export type UpdateOwnCompanyProfileResponse = CompanyMemberResponse;

export type CreateCompanyError = 'OK' | 'UNAUTHORIZED' | 'INVALID_INPUT' | 'COMPANY_EXISTS' | 'SLUG_EXISTS' | 'COMPANY_CODE_EXISTS' | 'EMAIL_EXISTS' | 'AUTH_CREATION_FAILED' | 'COMPANY_CREATION_FAILED' | 'MEMBER_CREATION_FAILED' | 'AUDIT_LOG_FAILED' | 'ROLLBACK_FAILED' | 'UNKNOWN_ERROR';
export interface CreateCompanyRequest { companyName: string; slug: string; ownerName: string; ownerEmail: string; ownerPassword: string; plan: string; subscriptionStart: string; subscriptionEnd: string; maxUsers: number; features: string[]; status?: 'trial' | 'active'; }
export interface CreateCompanyResponse { success: boolean; code: CreateCompanyError; message: string; companyId?: string; ownerUid?: string; }
export interface UpdateCompanyRequest { companyId: string; name: string; slug: string; companyCode: string; ownerName: string; ownerEmail: string; plan: string; status: 'trial' | 'active' | 'past_due' | 'expired' | 'suspended'; subscriptionStart: string; subscriptionEnd: string; maxUsers: number; features: string[]; }
export interface CreateAdditionalCompanyOwnerRequest { companyId: string; name: string; email: string; temporaryPassword: string; }
export interface CreateAdditionalCompanyOwnerResponse { success: boolean; code: 'OK' | 'INVALID_INPUT' | 'UNAUTHORIZED' | 'EMAIL_EXISTS' | 'COMPANY_NOT_FOUND' | 'MAX_USERS_REACHED' | 'UNKNOWN_ERROR'; message: string; }
export interface UpdateCompanyResponse { success: boolean; code: CreateCompanyError; message: string; }
