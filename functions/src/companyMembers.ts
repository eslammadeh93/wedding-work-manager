import * as crypto from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';

const admin = { firestore: { FieldValue } };
import type { ChangeCompanyMemberRoleRequest, ChangeCompanyMemberRoleResponse, CompanyMemberError, CompanyMemberResponse, CompanyPermission, CompanyRole, CreateCompanyMemberRequest, CreateCompanyMemberResponse, DeleteCompanyMemberRequest, DeleteCompanyMemberResponse, DeleteWorkerRequest, DeleteWorkerResponse, DisableCompanyMemberRequest, DisableCompanyMemberResponse, ManagedRole, ReactivateCompanyMemberRequest, ReactivateCompanyMemberResponse, ResetWorkerLoginCodeRequest, ResetWorkerLoginCodeResponse, SendCompanyMemberPasswordResetRequest, SendCompanyMemberPasswordResetResponse, UpdateCompanyMemberRequest, UpdateCompanyMemberResponse, UpdateOwnCompanyProfileRequest, UpdateOwnCompanyProfileResponse } from './apiTypes.js';
import type { MarkCompanyNotificationsReadRequest, MarkCompanyNotificationsReadResponse, RecordOrderActivityRequest, RecordOrderActivityResponse, RecordWorkerMovementRequest, RecordWorkerMovementResponse, SetWorkerStatusRequest, SetWorkerStatusResponse, UpdateWorkerOrderStatusRequest, UpdateWorkerOrderStatusResponse, UpdateWorkerRequest, UpdateWorkerResponse } from './apiTypes.js';
export type * from './apiTypes.js';

type AuthContext = { uid: string; token?: Record<string, unknown> } | undefined;
type MemberDoc = { uid: string; companyId?: string; name?: string; email?: string; role?: CompanyRole; status?: string; workerId?: string; phone?: string; permissions?: CompanyPermission[] };
type Deps = { db: FirebaseFirestore.Firestore; auth: Auth; emulator?: boolean };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const workerName = /^[a-z0-9_-]{2,80}$/i;
const ok = <T = Record<string, never>>(message: string, data?: T): CompanyMemberResponse<T> => data === undefined ? { success: true, code: 'OK', message } : { success: true, code: 'OK', message, data };
const fail = (code: CompanyMemberError, message: string): CompanyMemberResponse => ({ success: false, code, message });
const normalize = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const COMPANY_PERMISSIONS: readonly CompanyPermission[] = ['company:dashboard:read', 'company:calendar:read', 'company:orders:read', 'company:orders:write', 'company:customers:read', 'company:customers:write', 'company:workers:read', 'company:workers:write', 'company:inventory:read', 'company:inventory:write', 'company:expenses:read', 'company:expenses:write', 'company:categories:read', 'company:categories:write', 'company:activity_logs:read', 'company:reports:read', 'company:settings:read', 'company:settings:write', 'company:members:read', 'company:members:write', 'company:notifications:read'];
const legacyPermissions = (role: CompanyRole): readonly CompanyPermission[] => role === 'company_super_admin' ? COMPANY_PERMISSIONS : role === 'manager' ? COMPANY_PERMISSIONS.filter(permission => !permission.startsWith('company:expenses:')) : role === 'employee' ? ['company:dashboard:read', 'company:calendar:read', 'company:orders:read', 'company:orders:write', 'company:customers:read', 'company:customers:write', 'company:inventory:read', 'company:notifications:read'] : ['company:orders:read', 'company:notifications:read'];
const memberPermissions = (member: MemberDoc): readonly CompanyPermission[] => Array.isArray(member.permissions) ? member.permissions : legacyPermissions(member.role || 'worker');
const hasMemberWritePermission = (member: MemberDoc) => member.role === 'company_super_admin' || memberPermissions(member).includes('company:members:write');
const validPermissions = (value: unknown): CompanyPermission[] | null => Array.isArray(value) && value.length <= COMPANY_PERMISSIONS.length && value.every(permission => typeof permission === 'string' && COMPANY_PERMISSIONS.includes(permission as CompanyPermission)) ? Array.from(new Set(value)) as CompanyPermission[] : null;
export const hashWorkerLoginCode = (loginCode: string): string => { const salt = crypto.randomBytes(16); const N = 16384, r = 8, p = 1; const value = crypto.scryptSync(loginCode, salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 }); return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${value.toString('base64')}`; };
export const canManageCompanyMember = (actorRole: CompanyRole, targetRole: CompanyRole, _action: 'create' | 'update' | 'role' | 'disable' | 'delete'): boolean => ['company_super_admin', 'manager'].includes(actorRole) && targetRole === 'manager';

export class CompanyMemberService {
  constructor(private readonly deps: Deps) {}

  private async caller(auth: AuthContext): Promise<{ company: FirebaseFirestore.DocumentSnapshot; member: FirebaseFirestore.DocumentSnapshot } | CompanyMemberResponse> {
    if (!auth?.uid) return fail('UNAUTHORIZED', 'يجب تسجيل الدخول أولاً.');
    const companyId = typeof auth.token?.companyId === 'string' ? auth.token.companyId : '';
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(companyId)) return fail('UNAUTHORIZED', 'عضوية الشركة غير صالحة أو غير مفعلة.');
    const companyRef = this.deps.db.collection('companies').doc(companyId);
    const member = await companyRef.collection('members').doc(auth.uid).get();
    const memberData = member.data();
    if (!member.exists || memberData?.uid !== auth.uid || memberData?.companyId !== companyId || memberData?.status !== 'active') return fail('UNAUTHORIZED', 'عضوية الشركة غير صالحة أو غير مفعلة.');
    const company = await companyRef.get();
    if (!company.exists) return fail('COMPANY_NOT_FOUND', 'الشركة غير موجودة.');
    if (!['active', 'trial'].includes(String(company.data()?.status))) return fail('COMPANY_INACTIVE', 'حالة الشركة لا تسمح بإدارة الأعضاء.');
    return { company, member };
  }
  private async authorize(auth: AuthContext): Promise<{ company: FirebaseFirestore.DocumentSnapshot; member: FirebaseFirestore.DocumentSnapshot } | CompanyMemberResponse> {
    const context = await this.caller(auth);
    if ('success' in context) return context;
    if (!hasMemberWritePermission(context.member.data() as MemberDoc)) return fail('FORBIDDEN', 'ليس لديك صلاحية إدارة أعضاء الشركة.');
    return context;
  }
  private async rateLimit(companyId: string, actor: string, action: string): Promise<CompanyMemberResponse | null> {
    const ref = this.deps.db.doc(`companyMemberRateLimits/${crypto.createHash('sha256').update(`${companyId}\0${actor}\0${action}`).digest('hex')}`);
    const allowed = await this.deps.db.runTransaction(async tx => { const snapshot = await tx.get(ref); const data = snapshot.data() || {}; const now = Date.now(); const windowStartedAt = typeof data.windowStartedAt === 'number' ? data.windowStartedAt : now; const inWindow = now - windowStartedAt < 60_000; const count = inWindow ? Number(data.count || 0) : 0; if (count >= 10) return false; tx.set(ref, { count: count + 1, windowStartedAt: inWindow ? windowStartedAt : now, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); return true; });
    return allowed ? null : fail('FORBIDDEN', 'تم تجاوز الحد المؤقت لهذه العملية. حاول لاحقاً.');
  }
  private async audit(companyId: string, action: string, performedBy: string, targetUid: string, targetRole?: string, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.deps.db.collection(`companies/${companyId}/auditLogs`).add({ action, companyId, targetUid, targetRole: targetRole || null, performedBy, metadata, success: true, timestamp: admin.firestore.FieldValue.serverTimestamp() });
  }
  private validCode(code: string) { return code.length >= 6 && code.length <= 128 && /[0-9]/.test(code); }

  async create(input: unknown, auth: AuthContext): Promise<CreateCompanyMemberResponse> {
    const context = await this.authorize(auth); if ('success' in context) return context;
    const rate = await this.rateLimit(context.company.id, auth!.uid, 'create'); if (rate) return rate;
    const data = (input || {}) as CreateCompanyMemberRequest; const name = normalize(data.name);
    // Employee is the safe default. It keeps account creation compatible with
    // an already-open/cached client bundle that may not send the new role yet;
    // an unexpected value can never escalate to an owner-level account.
    const requestedRole = String(data.role || 'employee');
    const role: ManagedRole = (['manager', 'employee', 'worker'] as const).includes(requestedRole as ManagedRole)
      ? requestedRole as ManagedRole
      : 'employee';
    if (!name) return fail('INVALID_INPUT', 'اسم الموظف مطلوب.');
    const permissions = role === 'worker' ? undefined : validPermissions(data.permissions);
    if (role !== 'worker' && !permissions) return fail('INVALID_INPUT', 'اختر صلاحيات الموظف من القائمة المتاحة.');
    const actorPermissions = memberPermissions(context.member.data() as MemberDoc);
    if (role !== 'worker' && (context.member.data()?.role !== 'company_super_admin') && permissions!.some(permission => !actorPermissions.includes(permission))) return fail('FORBIDDEN', 'لا يمكنك منح صلاحيات لا تملكها.');
    const isWorker = role === 'worker'; const email = normalize(data.email).toLowerCase(); const temporaryPassword = typeof data.temporaryPassword === 'string' ? data.temporaryPassword : ''; const username = normalize(data.username).toLowerCase(); const loginCode = typeof data.loginCode === 'string' ? data.loginCode : '';
    if (isWorker ? (!workerName.test(username) || !this.validCode(loginCode) || email || temporaryPassword) : (!emailPattern.test(email) || temporaryPassword.length < 12 || username || loginCode)) return fail('INVALID_INPUT', isWorker ? 'اسم المستخدم أو كود دخول العامل غير صالح.' : 'بيانات إنشاء المدير أو كلمة المرور المؤقتة غير صحيحة.');
    const companyRef = context.company.ref; const maxUsers = Number(context.company.data()?.maxUsers);
    if (!Number.isInteger(maxUsers) || maxUsers < 1) return fail('INVALID_INPUT', 'إعداد maxUsers للشركة غير صالح.');
    if (!isWorker) { try { if (await this.deps.auth.getUserByEmail(email)) return fail('EMAIL_EXISTS', 'البريد الإلكتروني مستخدم بالفعل.'); } catch (e) { if ((e as { code?: string }).code !== 'auth/user-not-found') return fail('AUTH_CREATION_FAILED', 'تعذر التحقق من البريد الإلكتروني.'); } }
    let uid: string | undefined; let workerRef: FirebaseFirestore.DocumentReference | undefined; let workerSecretRef: FirebaseFirestore.DocumentReference | undefined; let memberRef: FirebaseFirestore.DocumentReference | undefined;
    try {
      if (isWorker) { const matches = await companyRef.collection('workers').where('username', '==', username).limit(1).get(); if (!matches.empty) return fail('USERNAME_EXISTS', 'اسم المستخدم مستخدم داخل هذه الشركة.'); workerRef = companyRef.collection('workers').doc(); workerSecretRef = companyRef.collection('workerSecrets').doc(workerRef.id); uid = `worker_${companyRef.id}_${workerRef.id}`; try { await this.deps.auth.createUser({ uid, displayName: name }); } catch { return fail('AUTH_CREATION_FAILED', 'تعذر إنشاء حساب العامل.'); } }
      else { try { uid = (await this.deps.auth.createUser({ displayName: name, email, password: temporaryPassword, emailVerified: false })).uid; } catch (e) { return (e as { code?: string }).code === 'auth/email-already-exists' ? fail('EMAIL_EXISTS', 'البريد الإلكتروني مستخدم بالفعل.') : fail('AUTH_CREATION_FAILED', 'تعذر إنشاء حساب المستخدم.'); } }
      await this.deps.auth.setCustomUserClaims(uid, { companyId: companyRef.id, role, ...(workerRef ? { workerId: workerRef.id } : {}) });
      memberRef = companyRef.collection('members').doc(uid);
      await this.deps.db.runTransaction(async tx => { const company = await tx.get(companyRef); const current = Number(company.data()?.memberCount || 0); if (!company.exists) throw new MemberFailure('COMPANY_NOT_FOUND', 'الشركة غير موجودة.'); if (current >= maxUsers) throw new MemberFailure('MAX_USERS_REACHED', 'تم الوصول إلى الحد الأقصى للمستخدمين.'); const companyCode = String(company.data()?.companyCode || ''); if (!/^\d{6}$/.test(companyCode)) throw new MemberFailure('INVALID_INPUT', 'رمز الشركة الرقمي غير صالح.'); const ts = admin.firestore.FieldValue.serverTimestamp(); tx.create(memberRef!, { uid, companyId: companyRef.id, companyCode, name, email: isWorker ? null : email, role, status: 'active', phone: normalize(data.phone) || null, jobTitle: normalize(data.jobTitle) || null, ...(isWorker ? {} : { employeeType: normalize(data.employeeType) || 'موظف', permissions }), ...(workerRef ? { workerId: workerRef.id } : {}), createdAt: ts, createdBy: auth!.uid, updatedAt: ts }); if (workerRef && workerSecretRef) { tx.create(workerRef, { id: workerRef.id, companyId: companyRef.id, companyCode, name, fullName: name, username, usernameNormalized: username, authUid: uid, status: 'active', phone: normalize(data.phone) || '', jobTitle: normalize(data.jobTitle), notes: normalize(data.notes), createdAt: ts, createdBy: auth!.uid, updatedAt: ts }); tx.create(workerSecretRef, { loginCodeHash: hashWorkerLoginCode(loginCode), loginCodeVersion: 1, createdAt: ts, updatedAt: ts }); } tx.update(companyRef, { memberCount: current + 1, activeMemberCount: Number(company.data()?.activeMemberCount ?? current) + 1, updatedAt: ts }); });
      await memberRef.update({ jobTitle: normalize(data.jobTitle) || null });
      await this.audit(companyRef.id, isWorker ? 'company_worker_created' : 'company_employee_created', auth!.uid, uid, role, { permissions: permissions || [] });
      return ok(isWorker ? 'تم إنشاء العامل بنجاح.' : 'تم إنشاء الموظف بنجاح.', { uid, ...(workerRef ? { workerId: workerRef.id, companyCode: String(context.company.data()?.companyCode || '') } : {}) });
    } catch (error) { const code = error instanceof MemberFailure ? error.code : workerRef ? 'WORKER_CREATION_FAILED' : 'MEMBER_CREATION_FAILED'; const rollback = await this.rollback(uid, [memberRef, workerRef, workerSecretRef].filter(Boolean) as FirebaseFirestore.DocumentReference[]); return rollback ? fail(code, error instanceof Error ? error.message : 'تعذر إنشاء العضو.') : fail('ROLLBACK_FAILED', 'فشلت العملية وتعذر إكمال التراجع الآمن.'); }
  }
  async update(input: unknown, auth: AuthContext): Promise<UpdateCompanyMemberResponse> {
    const context = await this.authorize(auth); if ('success' in context) return context;
    const data = (input || {}) as UpdateCompanyMemberRequest; const uid = normalize(data.uid); const fields: Record<string, unknown> = {};
    if (typeof data.name === 'string' && normalize(data.name)) fields.name = normalize(data.name);
    if (typeof data.phone === 'string') fields.phone = normalize(data.phone) || null;
    if (typeof data.jobTitle === 'string') fields.jobTitle = normalize(data.jobTitle) || null;
    if (typeof data.employeeType === 'string') fields.employeeType = normalize(data.employeeType) || 'موظف';
    if (data.permissions !== undefined) { const permissions = validPermissions(data.permissions); if (!permissions) return fail('INVALID_INPUT', 'الصلاحيات المختارة غير صالحة.'); const actorPermissions = memberPermissions(context.member.data() as MemberDoc); if (context.member.data()?.role !== 'company_super_admin' && permissions.some(permission => !actorPermissions.includes(permission))) return fail('FORBIDDEN', 'لا يمكنك منح صلاحيات لا تملكها.'); fields.permissions = permissions; }
    if (data.displaySettings && typeof data.displaySettings === 'object' && !Array.isArray(data.displaySettings)) fields.displaySettings = data.displaySettings;
    if (!uid || !Object.keys(fields).length) return fail('INVALID_INPUT', 'لا توجد بيانات مسموح بتعديلها.');
    const target = context.company.ref.collection('members').doc(uid); const snapshot = await target.get();
    if (!snapshot.exists) return fail('MEMBER_NOT_FOUND', 'الموظف غير موجود.');
    if (snapshot.data()?.role === 'company_super_admin') return fail('CANNOT_MANAGE_COMPANY_ADMIN', 'لا يمكن تعديل صاحب الشركة.');
    if (snapshot.data()?.role === 'worker') return fail('ROLE_NOT_ALLOWED', 'تتم إدارة العمال من قسم العمال.');
    await target.update({ ...fields, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    if (fields.name) await this.deps.auth.updateUser(uid, { displayName: String(fields.name) });
    await this.audit(context.company.id, 'company_employee_updated', auth!.uid, uid, String(snapshot.data()?.role), { fields: Object.keys(fields) });
    return ok('تم تحديث بيانات الموظف وصلاحياته.');
  }
  async changeRole(input: unknown, auth: AuthContext): Promise<ChangeCompanyMemberRoleResponse> { const context = await this.authorize(auth); if ('success' in context) return context; const data = (input || {}) as ChangeCompanyMemberRoleRequest; const uid = normalize(data.uid); if (!uid || data.role !== 'manager') return fail('ROLE_NOT_ALLOWED', 'دور المدير ثابت من شاشة إدارة المديرين.'); if (uid === auth!.uid) return fail('SELF_ROLE_CHANGE_FORBIDDEN', 'لا يمكنك تغيير دورك بنفسك.'); const target = context.company.ref.collection('members').doc(uid); const snapshot = await target.get(); if (!snapshot.exists) return fail('MEMBER_NOT_FOUND', 'العضو غير موجود.'); const oldRole = snapshot.data()?.role; if (oldRole === 'company_super_admin') return fail('CANNOT_MANAGE_COMPANY_ADMIN', 'لا يمكن إدارة صاحب الشركة.'); if (oldRole !== 'manager') return fail('ROLE_NOT_ALLOWED', 'لا يمكن تحويل حساب آخر إلى مدير من هذا المسار.'); return ok('الدور مضبوط بالفعل كمدير.'); }
  async disable(input: unknown, auth: AuthContext): Promise<DisableCompanyMemberResponse> { const context = await this.authorize(auth); if ('success' in context) return context; const uid = normalize((input as DisableCompanyMemberRequest)?.uid); if (!uid) return fail('INVALID_INPUT', 'معرف العضو غير صالح.'); if (uid === auth!.uid) return fail('SELF_DISABLE_FORBIDDEN', 'لا يمكنك تعطيل حسابك بنفسك.'); const target = context.company.ref.collection('members').doc(uid); const snapshot = await target.get(); if (!snapshot.exists) return fail('MEMBER_NOT_FOUND', 'الموظف غير موجود.'); const role = snapshot.data()?.role; if (role === 'company_super_admin') return fail('CANNOT_MANAGE_COMPANY_ADMIN', 'لا يمكن تعطيل صاحب الشركة.'); if (role === 'worker') return fail('ROLE_NOT_ALLOWED', 'تتم إدارة العمال من قسم العمال.'); const rate = await this.rateLimit(context.company.id, auth!.uid, 'disable'); if (rate) return rate; await this.deps.auth.updateUser(uid, { disabled: true }); await this.deps.db.runTransaction(async tx => { const company = await tx.get(context.company.ref); tx.update(target, { status: 'disabled', updatedAt: admin.firestore.FieldValue.serverTimestamp() }); tx.update(context.company.ref, { activeMemberCount: Math.max(0, Number(company.data()?.activeMemberCount || 1) - 1) }); }); await this.audit(context.company.id, 'company_employee_disabled', auth!.uid, uid, role); return ok('تم تعطيل الموظف.'); }
  async reactivate(input: unknown, auth: AuthContext): Promise<ReactivateCompanyMemberResponse> { const context = await this.authorize(auth); if ('success' in context) return context; const uid = normalize((input as ReactivateCompanyMemberRequest)?.uid); if (!uid) return fail('INVALID_INPUT', 'معرف العضو غير صالح.'); const target = context.company.ref.collection('members').doc(uid); const snapshot = await target.get(); if (!snapshot.exists) return fail('MEMBER_NOT_FOUND', 'الموظف غير موجود.'); if (snapshot.data()?.role === 'company_super_admin') return fail('CANNOT_MANAGE_COMPANY_ADMIN', 'لا يمكن تعديل حالة صاحب الشركة.'); if (snapshot.data()?.role === 'worker') return fail('ROLE_NOT_ALLOWED', 'تتم إدارة العمال من قسم العمال.'); const rate = await this.rateLimit(context.company.id, auth!.uid, 'reactivate'); if (rate) return rate; await this.deps.auth.updateUser(uid, { disabled: false }); await this.deps.db.runTransaction(async tx => { tx.update(target, { status: 'active', updatedAt: admin.firestore.FieldValue.serverTimestamp() }); tx.update(context.company.ref, { activeMemberCount: Math.max(0, Number(context.company.data()?.activeMemberCount || 0) + 1) }); }); await this.audit(context.company.id, 'company_employee_reactivated', auth!.uid, uid, String(snapshot.data()?.role)); return ok('تمت إعادة تفعيل الموظف.'); }
  async passwordReset(input: unknown, auth: AuthContext): Promise<SendCompanyMemberPasswordResetResponse> { const context = await this.authorize(auth); if ('success' in context) return context; const uid = normalize((input as SendCompanyMemberPasswordResetRequest)?.uid); const member = uid ? await context.company.ref.collection('members').doc(uid).get() : null; if (!member?.exists) return fail('MEMBER_NOT_FOUND', 'الموظف غير موجود.'); const data = member.data() as MemberDoc; if (data.role === 'company_super_admin') return fail('CANNOT_MANAGE_COMPANY_ADMIN', 'لا يمكن إعادة تعيين كلمة مرور صاحب الشركة.'); if (data.role === 'worker' || !emailPattern.test(String(data.email || ''))) return fail('RESET_NOT_SUPPORTED', 'إعادة تعيين كلمة المرور غير مدعومة لهذا العضو.'); const link = await this.deps.auth.generatePasswordResetLink(String(data.email)); await this.audit(context.company.id, 'company_employee_password_reset_sent', auth!.uid, uid, String(data.role)); return this.deps.emulator ? ok('تم إنشاء رابط إعادة التعيين للاختبار فقط.', { testResetLink: link }) : ok('تم إرسال طلب إعادة تعيين كلمة المرور.'); }
  async deleteMember(input: unknown, auth: AuthContext): Promise<DeleteCompanyMemberResponse> { const context = await this.authorize(auth); if ('success' in context) return context; const uid = normalize((input as DeleteCompanyMemberRequest)?.uid); if (!uid || uid === auth!.uid) return fail('FORBIDDEN', 'لا يمكنك حذف حسابك الحالي.'); const target = context.company.ref.collection('members').doc(uid); const snapshot = await target.get(); if (!snapshot.exists) return fail('MEMBER_NOT_FOUND', 'الموظف غير موجود.'); if (snapshot.data()?.role === 'company_super_admin') return fail('CANNOT_MANAGE_COMPANY_ADMIN', 'لا يمكن حذف صاحب الشركة.'); if (snapshot.data()?.role === 'worker') return fail('ROLE_NOT_ALLOWED', 'تتم إدارة العمال من قسم العمال.'); try { await this.deps.auth.updateUser(uid, { disabled: true }); } catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') return fail('UNKNOWN_ERROR', 'تعذر تأمين حساب الموظف قبل الحذف.'); } try { await this.deps.db.runTransaction(async tx => { const company = await tx.get(context.company.ref); tx.delete(target); tx.delete(this.deps.db.collection('users').doc(uid)); tx.update(context.company.ref, { memberCount: Math.max(0, Number(company.data()?.memberCount || 1) - 1), activeMemberCount: Math.max(0, Number(company.data()?.activeMemberCount || 1) - (snapshot.data()?.status === 'active' ? 1 : 0)), updatedAt: admin.firestore.FieldValue.serverTimestamp() }); }); } catch (error) { try { await this.deps.auth.updateUser(uid, { disabled: false }); } catch { /* preserve original failure */ } return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : 'تعذر حذف بيانات الموظف.'); } try { await this.deps.auth.deleteUser(uid); } catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') return fail('UNKNOWN_ERROR', 'حُذفت بيانات الموظف لكن تعذر حذف حساب Auth المعطل.'); } await this.audit(context.company.id, 'company_employee_deleted', auth!.uid, uid, String(snapshot.data()?.role)); return ok('تم حذف الموظف وحسابه بالكامل.'); }
  async updateOwnProfile(input: unknown, auth: AuthContext): Promise<UpdateOwnCompanyProfileResponse> { const context = await this.caller(auth); if ('success' in context) return context; const actor = context.member.data() as MemberDoc; if (actor.role === 'worker') return fail('FORBIDDEN', 'تحديث ملف العامل يتم من قسم العمال.'); const data = (input || {}) as UpdateOwnCompanyProfileRequest; const name = typeof data.name === 'string' ? normalize(data.name) : ''; const phone = typeof data.phone === 'string' ? normalize(data.phone) : ''; const newPassword = typeof data.newPassword === 'string' ? data.newPassword : ''; if (!name && !phone && !newPassword) return fail('INVALID_INPUT', 'لا توجد بيانات مسموح بتعديلها.'); if (newPassword && newPassword.length < 12) return fail('INVALID_INPUT', 'كلمة المرور الجديدة يجب أن تكون 12 حرفًا على الأقل.'); const fields: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() }; if (name) fields.name = name; if (typeof data.phone === 'string') fields.phone = phone || null; await context.member.ref.set(fields, { merge: true }); if (name || newPassword) await this.deps.auth.updateUser(auth!.uid, { ...(name ? { displayName: name } : {}), ...(newPassword ? { password: newPassword } : {}) }); await this.audit(context.company.id, 'company_member_profile_updated', auth!.uid, auth!.uid, String(actor.role), { nameChanged: Boolean(name), phoneChanged: typeof data.phone === 'string', passwordChanged: Boolean(newPassword) }); return ok('تم تحديث الملف الشخصي.'); }
  async deleteWorker(input: unknown, auth: AuthContext): Promise<DeleteWorkerResponse> {
    const context = await this.authorize(auth); if ('success' in context) return context;
    const workerId = normalize((input as DeleteWorkerRequest)?.workerId);
    if (!workerId) return fail('INVALID_INPUT', 'معرف العامل غير صالح.');
    const workerRef = context.company.ref.collection('workers').doc(workerId);
    const worker = await workerRef.get();
    if (!worker.exists) return fail('MEMBER_NOT_FOUND', 'العامل غير موجود.');
    let authUid = normalize(worker.data()?.authUid);
    let memberRef: FirebaseFirestore.DocumentReference | undefined;
    if (authUid) {
      memberRef = context.company.ref.collection('members').doc(authUid);
    } else {
      const matches = await context.company.ref.collection('members').where('workerId', '==', workerId).limit(2).get();
      if (matches.size > 1) return fail('UNKNOWN_ERROR', 'بيانات عضوية العامل غير متسقة.');
      if (!matches.empty) { memberRef = matches.docs[0].ref; authUid = matches.docs[0].id; }
    }
    if (memberRef) {
      const member = await memberRef.get();
      if (member.exists && member.data()?.role !== 'worker') return fail('ROLE_NOT_ALLOWED', 'العضوية المرتبطة ليست حساب عامل.');
    }
    if (authUid) {
      try { await this.deps.auth.updateUser(authUid, { disabled: true }); }
      catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') return fail('UNKNOWN_ERROR', 'تعذر تأمين حساب العامل قبل الحذف.'); }
    }
    const secretRef = context.company.ref.collection('workerSecrets').doc(workerId);
    const legacyUserRef = authUid ? this.deps.db.collection('users').doc(authUid) : undefined;
    try {
      await this.deps.db.runTransaction(async tx => {
        const company = await tx.get(context.company.ref);
        const member = memberRef ? await tx.get(memberRef) : undefined;
        tx.delete(workerRef); tx.delete(secretRef);
        if (memberRef && member?.exists) tx.delete(memberRef);
        if (legacyUserRef) tx.delete(legacyUserRef);
        if (member?.exists) tx.update(context.company.ref, { memberCount: Math.max(0, Number(company.data()?.memberCount || 1) - 1), activeMemberCount: Math.max(0, Number(company.data()?.activeMemberCount || 1) - (member.data()?.status === 'active' ? 1 : 0)), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      });
    } catch (error) {
      if (authUid) { try { await this.deps.auth.updateUser(authUid, { disabled: false }); } catch { /* preserve original failure */ } }
      return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : 'تعذر حذف بيانات العامل.');
    }
    if (authUid) { try { await this.deps.auth.deleteUser(authUid); } catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') return fail('UNKNOWN_ERROR', 'حُذفت بيانات العامل لكن تعذر حذف حساب Auth المعطل.'); } }
    await this.audit(context.company.id, 'company_worker_deleted', auth!.uid, authUid || '', 'worker', { workerId });
    return ok('تم حذف العامل وحسابه وبيانات دخوله بالكامل.');
  }
  async resetWorkerCode(input: unknown, auth: AuthContext): Promise<ResetWorkerLoginCodeResponse> { const context = await this.authorize(auth); if ('success' in context) return context; const data = (input || {}) as ResetWorkerLoginCodeRequest; const workerId = normalize(data.workerId); if (!workerId || !this.validCode(typeof data.loginCode === 'string' ? data.loginCode : '')) return fail('INVALID_INPUT', 'كود العامل يجب أن يحتوي على ستة أحرف على الأقل ورقم واحد.'); const worker = context.company.ref.collection('workers').doc(workerId); const snapshot = await worker.get(); if (!snapshot.exists) return fail('MEMBER_NOT_FOUND', 'العامل غير موجود.'); const rate = await this.rateLimit(context.company.id, auth!.uid, 'worker-code'); if (rate) return rate; await context.company.ref.collection('workerSecrets').doc(workerId).set({ loginCodeHash: hashWorkerLoginCode(data.loginCode), loginCodeVersion: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); await this.audit(context.company.id, 'worker_login_code_reset', auth!.uid, String(snapshot.data()?.authUid || ''), 'worker', { workerId }); return ok('تمت إعادة تعيين كود العامل.'); }
  async updateWorker(input: unknown, auth: AuthContext): Promise<UpdateWorkerResponse> {
    const context = await this.authorize(auth); if ('success' in context) return context;
    const data = (input || {}) as UpdateWorkerRequest; const workerId = normalize(data.workerId);
    const name = normalize(data.name); const username = normalize(data.username).toLowerCase();
    if (!workerId || (data.name !== undefined && !name) || (data.username !== undefined && !workerName.test(username))) return fail('INVALID_INPUT', 'بيانات العامل غير صالحة.');
    const workerRef = context.company.ref.collection('workers').doc(workerId); const worker = await workerRef.get();
    if (!worker.exists) return fail('MEMBER_NOT_FOUND', 'العامل غير موجود.');
    if (username && username !== worker.data()?.username) { const duplicate = await context.company.ref.collection('workers').where('usernameNormalized', '==', username).limit(1).get(); if (!duplicate.empty) return fail('USERNAME_EXISTS', 'اسم المستخدم مستخدم داخل هذه الشركة.'); }
    const authUid = normalize(worker.data()?.authUid); const memberRef = authUid ? context.company.ref.collection('members').doc(authUid) : undefined;
    const fields: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (data.name !== undefined) { fields.name = name; fields.fullName = name; }
    if (data.username !== undefined) { fields.username = username; fields.usernameNormalized = username; }
    if (data.phone !== undefined) fields.phone = normalize(data.phone);
    if (data.jobTitle !== undefined) fields.jobTitle = normalize(data.jobTitle);
    if (data.notes !== undefined) fields.notes = normalize(data.notes);
    await workerRef.set(fields, { merge: true });
    if (memberRef) await memberRef.set({ ...(name ? { name } : {}), ...(data.phone !== undefined ? { phone: normalize(data.phone) || null } : {}), ...(data.jobTitle !== undefined ? { jobTitle: normalize(data.jobTitle) || null } : {}), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    if (authUid && name) await this.deps.auth.updateUser(authUid, { displayName: name });
    await this.audit(context.company.id, 'company_worker_updated', auth!.uid, authUid, 'worker', { workerId, fields: Object.keys(fields).filter(key => key !== 'updatedAt') });
    return ok('تم تحديث العامل.');
  }
  async setWorkerStatus(input: unknown, auth: AuthContext): Promise<SetWorkerStatusResponse> {
    const context = await this.authorize(auth); if ('success' in context) return context;
    const data = (input || {}) as SetWorkerStatusRequest; const workerId = normalize(data.workerId);
    if (!workerId || !['active', 'inactive'].includes(String(data.status))) return fail('INVALID_INPUT', 'حالة العامل غير صالحة.');
    const workerRef = context.company.ref.collection('workers').doc(workerId); const worker = await workerRef.get();
    if (!worker.exists) return fail('MEMBER_NOT_FOUND', 'العامل غير موجود.');
    const authUid = normalize(worker.data()?.authUid); if (!authUid) return fail('MEMBER_NOT_FOUND', 'عضوية العامل غير مكتملة.');
    const memberRef = context.company.ref.collection('members').doc(authUid); const member = await memberRef.get();
    if (!member.exists || member.data()?.role !== 'worker') return fail('MEMBER_NOT_FOUND', 'عضوية العامل غير موجودة.');
    const active = data.status === 'active';
    try { await this.deps.auth.updateUser(authUid, { disabled: !active }); await this.deps.db.runTransaction(async tx => { tx.update(workerRef, { status: data.status, updatedAt: admin.firestore.FieldValue.serverTimestamp() }); tx.update(memberRef, { status: active ? 'active' : 'disabled', updatedAt: admin.firestore.FieldValue.serverTimestamp() }); }); }
    catch (error) { try { await this.deps.auth.updateUser(authUid, { disabled: member.data()?.status !== 'active' }); } catch { /* preserve original failure */ } return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : 'تعذر تحديث حالة العامل.'); }
    await this.audit(context.company.id, active ? 'company_worker_reactivated' : 'company_worker_disabled', auth!.uid, authUid, 'worker', { workerId });
    return ok(active ? 'تمت إعادة تفعيل العامل.' : 'تم تعطيل العامل.');
  }
  async recordOrderActivity(input: unknown, auth: AuthContext): Promise<RecordOrderActivityResponse> {
    const context = await this.caller(auth); if ('success' in context) return context;
    const data = (input || {}) as RecordOrderActivityRequest; const orderId = normalize(data.orderId);
    if (!orderId || !['opened', 'arrived', 'finished'].includes(String(data.action))) return fail('INVALID_INPUT', 'بيانات النشاط غير صالحة.');
    const actor = context.member.data() as MemberDoc; const orderRef = context.company.ref.collection('orders').doc(orderId); const order = await orderRef.get();
    if (!order.exists) return fail('MEMBER_NOT_FOUND', 'الطلب غير موجود.');
    if (actor.role === 'worker' && order.data()?.workerId !== actor.workerId) return fail('FORBIDDEN', 'الطلب غير مسند لهذا العامل.');
    if (!['worker', 'manager', 'company_super_admin'].includes(String(actor.role))) return fail('FORBIDDEN', 'ليس لديك صلاحية تسجيل هذا النشاط.');
    const rate = await this.rateLimit(context.company.id, auth!.uid, 'order-activity'); if (rate) return rate;
    await context.company.ref.collection('activityLogs').add({ orderId, orderNumber: String(order.data()?.orderNumber || ''), workerId: String(actor.workerId || ''), workerName: String(actor.name || ''), action: data.action, customerName: String(order.data()?.customerName || ''), eventDate: String(order.data()?.eventDate || order.data()?.weddingDate || order.data()?.bookingDate || ''), performedBy: auth!.uid, timestamp: admin.firestore.FieldValue.serverTimestamp() });
    return ok('تم تسجيل النشاط.');
  }
  /** Worker check-ins are reports only; this method never writes the order. */
  async recordWorkerMovement(input: unknown, auth: AuthContext): Promise<RecordWorkerMovementResponse> {
    const movementFail = (code: CompanyMemberError, message: string): RecordWorkerMovementResponse => ({ success: false, code, message });
    const context = await this.caller(auth); if ('success' in context) return context as RecordWorkerMovementResponse;
    const data = (input || {}) as RecordWorkerMovementRequest;
    const companyId = normalize(data.companyId); const orderId = normalize(data.orderId); const action = data.action;
    if (companyId !== context.company.id || !orderId || !['arrived', 'completed'].includes(String(action))) return movementFail('INVALID_INPUT', 'بيانات حركة المنفذ غير صالحة.');
    const actor = context.member.data() as MemberDoc;
    if (actor.role !== 'worker' || !actor.workerId) return movementFail('FORBIDDEN', 'هذه العملية متاحة للمنفذ المسند إليه الطلب فقط.');
    const rate = await this.rateLimit(context.company.id, auth!.uid, 'worker-movement'); if (rate) return rate as RecordWorkerMovementResponse;
    const companyRef = context.company.ref;
    const movementId = `${actor.workerId}_${action}`;
    const movementRef = companyRef.collection('orders').doc(orderId).collection('workerMovements').doc(movementId);
    const arrivalRef = companyRef.collection('orders').doc(orderId).collection('workerMovements').doc(`${actor.workerId}_arrived`);
    const activityRef = companyRef.collection('activityLogs').doc(`worker_movement_${orderId}_${movementId}`);
    try {
      await this.deps.db.runTransaction(async tx => {
        const orderRef = companyRef.collection('orders').doc(orderId);
        const [order, existing, arrival, recipients] = await Promise.all([
          tx.get(orderRef), tx.get(movementRef), action === 'completed' ? tx.get(arrivalRef) : Promise.resolve(undefined),
          // A custom Team Manager remains an `employee` at the storage level.
          // Read all active members, then use the actual per-account order
          // permission below so only staff responsible for orders are alerted.
          tx.get(companyRef.collection('members').where('status', '==', 'active')),
        ]);
        if (!order.exists) throw new MemberFailure('MEMBER_NOT_FOUND', 'الطلب غير موجود.');
        if (order.data()?.workerId !== actor.workerId) throw new MemberFailure('FORBIDDEN', 'الطلب غير مسند لهذا العامل.');
        if (existing.exists) throw new MemberFailure('MOVEMENT_ALREADY_RECORDED', action === 'arrived' ? 'تم تسجيل الوصول مسبقاً.' : 'تم تسجيل انتهاء التنفيذ مسبقاً.');
        if (action === 'completed' && !arrival?.exists) throw new MemberFailure('MOVEMENT_SEQUENCE_INVALID', 'يجب تسجيل الوصول أولاً قبل الإبلاغ عن انتهاء التنفيذ.');
        const orderNumber = String(order.data()?.orderNumber || orderId); const name = String(actor.name || 'المنفذ');
        const type = action === 'arrived' ? 'worker_arrived' : 'worker_completed';
        const titleAr = action === 'arrived' ? 'تم وصول المنفذ' : 'تم انتهاء التنفيذ';
        const bodyAr = action === 'arrived' ? `${name} وصل إلى موقع تنفيذ الطلب ${orderNumber}` : `${name} أبلغ بانتهاء تنفيذ الطلب ${orderNumber}`;
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        tx.create(movementRef, { id: movementId, companyId: context.company.id, orderId, orderNumber, workerId: actor.workerId, workerUid: auth!.uid, workerName: name, action, type, createdAt: timestamp, createdByUid: auth!.uid, createdByRole: 'worker' });
        tx.create(activityRef, { id: activityRef.id, companyId: context.company.id, orderId, orderNumber, workerId: actor.workerId, workerUid: auth!.uid, workerName: name, action: action === 'arrived' ? 'worker_reported_arrival' : 'worker_reported_completion', type, descriptionAr: `${bodyAr} (بلاغ من المنفذ، وليس تغييراً تلقائياً لحالة الطلب).`, descriptionEn: 'Worker report only; the order status was not changed.', performedBy: auth!.uid, timestamp, createdAt: timestamp });
        recipients.docs.filter(recipient => {
          const member = recipient.data() as MemberDoc;
          return member.role === 'company_super_admin'
            || member.role === 'manager'
            || memberPermissions(member).includes('company:orders:read');
        }).forEach(recipient => {
          const notificationRef = companyRef.collection('notifications').doc(`worker_movement_${orderId}_${movementId}_${recipient.id}`);
          tx.create(notificationRef, { id: notificationRef.id, type, title: titleAr, body: bodyAr, titleAr, titleEn: action === 'arrived' ? 'Worker arrived' : 'Worker reported completion', messageAr: `${bodyAr}. هذا بلاغ من المنفذ وليس تحديثاً تلقائياً لحالة الطلب.`, messageEn: 'Worker report only; review the order and update it manually if needed.', companyId: context.company.id, orderId, workerId: actor.workerId, movementId, targetUid: recipient.id, read: false, linkModule: 'orders', referenceId: orderId, navigation: { module: 'orders', referenceId: orderId }, createdAt: timestamp });
        });
      });
      return ok('تم تسجيل بلاغ المنفذ وإرسال إشعار لمسؤولي الطلبات.', { movementId });
    } catch (error) {
      if (error instanceof MemberFailure) return movementFail(error.code, error.message);
      return movementFail('UNKNOWN_ERROR', 'تعذر حفظ بلاغ المنفذ. لم يتم تأكيد أي تغيير.');
    }
  }
  async updateWorkerOrderStatus(input: unknown, auth: AuthContext): Promise<UpdateWorkerOrderStatusResponse> {
    void input; void auth;
    return fail('FORBIDDEN', 'لا يُسمح للمنفذ بتعديل حالة الطلب. استخدم بلاغ الوصول أو الانتهاء ليقوم المدير بالمراجعة يدوياً.');
  }
  async markNotificationsRead(input: unknown, auth: AuthContext): Promise<MarkCompanyNotificationsReadResponse> {
    const context = await this.caller(auth); if ('success' in context) return context;
    const ids = Array.from(new Set(((input || {}) as MarkCompanyNotificationsReadRequest).notificationIds?.map(normalize).filter(Boolean) || []));
    if (!ids.length || ids.length > 100) return fail('INVALID_INPUT', 'الإشعارات المطلوبة غير صالحة.');
    const owner = context.member.data()?.role === 'company_super_admin'; const batch = this.deps.db.batch();
    for (const id of ids) { const ref = context.company.ref.collection('notifications').doc(id); const snapshot = await ref.get(); if (!snapshot.exists) continue; if (!owner && snapshot.data()?.targetUid !== auth!.uid) return fail('FORBIDDEN', 'لا يمكنك تعديل إشعار مستخدم آخر.'); batch.update(ref, { read: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() }); }
    await batch.commit(); return ok('تم تحديث الإشعارات.');
  }
  private async rollback(uid: string | undefined, refs: FirebaseFirestore.DocumentReference[]): Promise<boolean> { try { if (refs.length) await this.deps.db.runTransaction(async tx => refs.forEach(ref => tx.delete(ref))); if (uid) await this.deps.auth.deleteUser(uid); return true; } catch { return false; } }
}
class MemberFailure extends Error { constructor(readonly code: CompanyMemberError, message: string) { super(message); } }
