import type { CompanyMemberOperationCode } from './companyMembersService';

export const companyMemberErrorMessage = (code: CompanyMemberOperationCode | string): string => ({
  UNAUTHORIZED: 'ليس لديك صلاحية لتنفيذ هذه العملية.',
  FORBIDDEN: 'هذه العملية غير مسموحة.',
  MAX_USERS_REACHED: 'وصلت الشركة إلى الحد الأقصى للمستخدمين.',
  EMAIL_EXISTS: 'البريد مستخدم بالفعل.',
  USERNAME_EXISTS: 'اسم المستخدم مستخدم بالفعل داخل الشركة.',
  SELF_ROLE_CHANGE_FORBIDDEN: 'لا يمكنك تغيير دور حسابك الحالي.',
  SELF_DISABLE_FORBIDDEN: 'لا يمكنك تعطيل حسابك الحالي.',
  CANNOT_MANAGE_COMPANY_ADMIN: 'لا يمكن تعديل أو تعطيل صاحب الشركة من هذه الصفحة.',
  LAST_COMPANY_ADMIN: 'يجب أن يبقى صاحب شركة واحد على الأقل فعالاً.',
  MEMBER_NOT_FOUND: 'لم يتم العثور على العضو.',
  MEMBER_DISABLED: 'الحساب معطل بالفعل.',
  RESET_NOT_SUPPORTED: 'طريقة إعادة التعيين غير مدعومة لهذا الحساب.',
  ROLLBACK_FAILED: 'حدث خطأ أثناء التراجع عن العملية. راجع السجل التقني.',
  INVALID_INPUT: 'تحقق من البيانات المدخلة ثم حاول مرة أخرى.',
  ROLE_NOT_ALLOWED: 'الدور المطلوب غير مسموح.',
  UNKNOWN_ERROR: 'حدث خطأ غير متوقع. حاول مرة أخرى.',
}[code] || 'حدث خطأ غير متوقع. حاول مرة أخرى.');

export const validPhone = (value: string) => !value || /^[+0-9][0-9 ()-]{5,24}$/.test(value);
export const validWorkerUsername = (value: string) => /^[a-z0-9_-]{2,80}$/i.test(value);
// Kept aligned with CompanyMemberService.validCode.
export const validWorkerLoginCode = (value: string) => value.length >= 6 && value.length <= 128 && /[0-9]/.test(value);
