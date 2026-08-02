import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';

export type ManagedCompanyRole = 'manager' | 'employee' | 'worker';
export type CompanyMemberOperationCode = 'OK' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'COMPANY_NOT_FOUND' | 'COMPANY_INACTIVE' | 'MEMBER_NOT_FOUND' | 'MEMBER_DISABLED' | 'EMAIL_EXISTS' | 'USERNAME_EXISTS' | 'MAX_USERS_REACHED' | 'ROLE_NOT_ALLOWED' | 'SELF_ROLE_CHANGE_FORBIDDEN' | 'SELF_DISABLE_FORBIDDEN' | 'CANNOT_MANAGE_COMPANY_ADMIN' | 'LAST_COMPANY_ADMIN' | 'AUTH_CREATION_FAILED' | 'MEMBER_CREATION_FAILED' | 'WORKER_CREATION_FAILED' | 'AUDIT_LOG_FAILED' | 'RESET_NOT_SUPPORTED' | 'ROLLBACK_FAILED' | 'UNKNOWN_ERROR';
export type CompanyMemberOperationResponse<T = Record<string, never>> = { success: boolean; code: CompanyMemberOperationCode; message: string; data?: T };
export type CreateCompanyMemberRequest = { name: string; role: ManagedCompanyRole; email?: string; username?: string; loginCode?: string; phone?: string };
export type UpdateCompanyMemberRequest = { uid: string; name?: string; phone?: string; displaySettings?: Record<string, boolean | string | number> };
export type ChangeCompanyMemberRoleRequest = { uid: string; role: ManagedCompanyRole };
export type DisableCompanyMemberRequest = { uid: string };
export type ReactivateCompanyMemberRequest = { uid: string };
export type SendCompanyMemberPasswordResetRequest = { uid: string };
export type ResetWorkerLoginCodeRequest = { workerId: string; loginCode: string };

const invoke = async <Request, Response>(name: string, request: Request): Promise<Response> => (await httpsCallable<Request, Response>(functions, name)(request)).data;
/** All writes are callable Functions; this contract intentionally contains no client Firestore/Auth writes. */
export const companyMembersService = {
  create: (request: CreateCompanyMemberRequest) => invoke<CreateCompanyMemberRequest, CompanyMemberOperationResponse<{ uid: string; workerId?: string; companyCode?: string }>>('createCompanyMember', request),
  update: (request: UpdateCompanyMemberRequest) => invoke<UpdateCompanyMemberRequest, CompanyMemberOperationResponse>('updateCompanyMember', request),
  changeRole: (request: ChangeCompanyMemberRoleRequest) => invoke<ChangeCompanyMemberRoleRequest, CompanyMemberOperationResponse>('changeCompanyMemberRole', request),
  disable: (request: DisableCompanyMemberRequest) => invoke<DisableCompanyMemberRequest, CompanyMemberOperationResponse>('disableCompanyMember', request),
  reactivate: (request: ReactivateCompanyMemberRequest) => invoke<ReactivateCompanyMemberRequest, CompanyMemberOperationResponse>('reactivateCompanyMember', request),
  sendPasswordReset: (request: SendCompanyMemberPasswordResetRequest) => invoke<SendCompanyMemberPasswordResetRequest, CompanyMemberOperationResponse>('sendCompanyMemberPasswordReset', request),
  resetWorkerLoginCode: (request: ResetWorkerLoginCodeRequest) => invoke<ResetWorkerLoginCodeRequest, CompanyMemberOperationResponse>('resetWorkerLoginCode', request),
};
