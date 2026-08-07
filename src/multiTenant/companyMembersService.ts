import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';
import type { Permission } from './permissions';

export type ManagedCompanyRole = 'manager' | 'employee' | 'worker';
export type CompanyMemberOperationCode = 'OK' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'COMPANY_NOT_FOUND' | 'COMPANY_INACTIVE' | 'MEMBER_NOT_FOUND' | 'MEMBER_DISABLED' | 'EMAIL_EXISTS' | 'USERNAME_EXISTS' | 'MAX_USERS_REACHED' | 'ROLE_NOT_ALLOWED' | 'SELF_ROLE_CHANGE_FORBIDDEN' | 'SELF_DISABLE_FORBIDDEN' | 'CANNOT_MANAGE_COMPANY_ADMIN' | 'LAST_COMPANY_ADMIN' | 'AUTH_CREATION_FAILED' | 'MEMBER_CREATION_FAILED' | 'WORKER_CREATION_FAILED' | 'AUDIT_LOG_FAILED' | 'RESET_NOT_SUPPORTED' | 'ROLLBACK_FAILED' | 'MOVEMENT_ALREADY_RECORDED' | 'MOVEMENT_SEQUENCE_INVALID' | 'UNKNOWN_ERROR';
export type CompanyMemberOperationResponse<T = Record<string, never>> = { success: boolean; code: CompanyMemberOperationCode; message: string; data?: T };
export type CreateCompanyMemberRequest = { name: string; role: ManagedCompanyRole; email?: string; temporaryPassword?: string; jobTitle?: string; employeeType?: string; permissions?: Permission[]; username?: string; loginCode?: string; phone?: string; notes?: string };
export type UpdateCompanyMemberRequest = { uid: string; name?: string; phone?: string; jobTitle?: string; employeeType?: string; permissions?: Permission[]; displaySettings?: Record<string, boolean | string | number> };
export type ChangeCompanyMemberRoleRequest = { uid: string; role: ManagedCompanyRole };
export type DisableCompanyMemberRequest = { uid: string };
export type ReactivateCompanyMemberRequest = { uid: string };
export type SendCompanyMemberPasswordResetRequest = { uid: string };
export type ResetWorkerLoginCodeRequest = { workerId: string; loginCode: string };
export type UpdateOwnCompanyProfileRequest = { name?: string; phone?: string; newPassword?: string };
export type UpdateWorkerRequest = { workerId: string; name?: string; username?: string; phone?: string; jobTitle?: string; notes?: string };

const callableMessage = (code: string) => code.includes('unauthenticated') ? 'انتهت جلسة تسجيل الدخول. سجّل الدخول مرة أخرى.'
  : code.includes('permission-denied') ? 'ليس لديك صلاحية لتنفيذ هذه العملية.'
  : code.includes('failed-precondition') ? 'لا يمكن تنفيذ العملية في الحالة الحالية. راجع البيانات ثم حاول مرة أخرى.'
  : code.includes('already-exists') ? 'هذه العملية مسجلة بالفعل.'
  : code.includes('internal') ? 'حدث خطأ داخلي أثناء تنفيذ العملية. حاول مرة أخرى.'
  : code.includes('unavailable') ? 'الخدمة غير متاحة مؤقتًا. حاول مرة أخرى.'
  : code.includes('deadline-exceeded') ? 'استغرق الطلب وقتًا أطول من المتوقع. حاول مرة أخرى.'
  : 'تعذر تنفيذ العملية حاليًا. حاول مرة أخرى.';
type CallableInvocationError = Error & { code: string; cause?: unknown };
const invoke = async <Request, Response>(name: string, request: Request): Promise<Response> => {
  try { return (await httpsCallable<Request, Response>(functions, name)(request)).data; }
  catch (error) {
    const code = String((error as { code?: unknown })?.code || 'functions/unknown');
    if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) console.error('[callable]', { functionName: name, stage: 'invoke', code, stack: error instanceof Error ? error.stack : undefined });
    const invocationError = new Error(callableMessage(code)) as CallableInvocationError;
    invocationError.code = code;
    invocationError.cause = error;
    throw invocationError;
  }
};
/** All writes are callable Functions; this contract intentionally contains no client Firestore/Auth writes. */
export const companyMembersService = {
  create: (request: CreateCompanyMemberRequest) => invoke<CreateCompanyMemberRequest, CompanyMemberOperationResponse<{ uid: string; workerId?: string; companyCode?: string }>>('createCompanyMember', request),
  update: (request: UpdateCompanyMemberRequest) => invoke<UpdateCompanyMemberRequest, CompanyMemberOperationResponse>('updateCompanyMember', request),
  changeRole: (request: ChangeCompanyMemberRoleRequest) => invoke<ChangeCompanyMemberRoleRequest, CompanyMemberOperationResponse>('changeCompanyMemberRole', request),
  disable: (request: DisableCompanyMemberRequest) => invoke<DisableCompanyMemberRequest, CompanyMemberOperationResponse>('disableCompanyMember', request),
  reactivate: (request: ReactivateCompanyMemberRequest) => invoke<ReactivateCompanyMemberRequest, CompanyMemberOperationResponse>('reactivateCompanyMember', request),
  sendPasswordReset: (request: SendCompanyMemberPasswordResetRequest) => invoke<SendCompanyMemberPasswordResetRequest, CompanyMemberOperationResponse>('sendCompanyMemberPasswordReset', request),
  resetWorkerLoginCode: (request: ResetWorkerLoginCodeRequest) => invoke<ResetWorkerLoginCodeRequest, CompanyMemberOperationResponse>('resetWorkerLoginCode', request),
  delete: (request: { uid: string }) => invoke<{ uid: string }, CompanyMemberOperationResponse>('deleteCompanyMember', request),
  deleteWorker: (request: { workerId: string }) => invoke<{ workerId: string }, CompanyMemberOperationResponse>('deleteWorker', request),
  updateOwnProfile: (request: UpdateOwnCompanyProfileRequest) => invoke<UpdateOwnCompanyProfileRequest, CompanyMemberOperationResponse>('updateOwnCompanyProfile', request),
  updateWorker: (request: UpdateWorkerRequest) => invoke<UpdateWorkerRequest, CompanyMemberOperationResponse>('updateWorker', request),
  setWorkerStatus: (request: { workerId: string; status: 'active' | 'inactive' }) => invoke<{ workerId: string; status: 'active' | 'inactive' }, CompanyMemberOperationResponse>('setWorkerStatus', request),
  recordOrderActivity: (request: { orderId: string; action: 'opened' | 'arrived' | 'finished' }) => invoke<typeof request, CompanyMemberOperationResponse>('recordOrderActivity', request),
  recordWorkerMovement: (request: { companyId: string; orderId: string; action: 'arrived' | 'completed' }) => invoke<typeof request, CompanyMemberOperationResponse<{ movementId: string }>>('recordWorkerMovement', request),
  markNotificationsRead: (request: { notificationIds: string[] }) => invoke<typeof request, CompanyMemberOperationResponse>('markCompanyNotificationsRead', request),
};
