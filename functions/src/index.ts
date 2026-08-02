import * as crypto from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { CompanyProvisioningService } from './companyProvisioning.js';
import { CompanyMemberService } from './companyMembers.js';
import type { ChangeCompanyMemberRoleRequest, ChangeCompanyMemberRoleResponse, CreateCompanyMemberRequest, CreateCompanyMemberResponse, CreateCompanyResponse, DisableCompanyMemberRequest, DisableCompanyMemberResponse, ReactivateCompanyMemberRequest, ReactivateCompanyMemberResponse, ResetWorkerLoginCodeRequest, ResetWorkerLoginCodeResponse, SendCompanyMemberPasswordResetRequest, SendCompanyMemberPasswordResetResponse, UpdateCompanyMemberRequest, UpdateCompanyMemberResponse, UpdateCompanyRequest, UpdateCompanyResponse } from './apiTypes.js';
import { seedTestMultiTenantData as provisionTestMultiTenantData, setupEnvironmentAllowed, testDataEnvironmentAllowed } from './setup.js';

initializeApp();
const db = getFirestore();
const auth = getAuth();
type WorkerLoginResponse = { success: boolean; code: 'OK' | 'INVALID_CREDENTIALS' | 'LOCKED' | 'INVALID_REQUEST'; message: string; customToken?: string; retryAfterSeconds?: number };
type RateLimit = { failures: number; lockedUntilMs: number | null };
const GENERIC_FAILURE = 'بيانات الدخول غير صحيحة.';
const normalize = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const safeInput = (value: string) => /^[a-z0-9_-]{2,80}$/i.test(value);
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const failureLockDuration = (failures: number): number | null => failures >= 9 ? 1800 : failures >= 6 ? 300 : failures >= 3 ? 60 : null;
const timestampMillis = (value: unknown): number | null => {
  if (typeof value === 'string' || value instanceof Date) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis();
  return null;
};

async function getRateLimit(key: string): Promise<RateLimit> {
  const snapshot = await db.doc(`workerLoginRateLimits/${key}`).get();
  const data = snapshot.exists ? snapshot.data() as Partial<RateLimit> : {};
  return { failures: Number(data.failures || 0), lockedUntilMs: data.lockedUntilMs || null };
}
async function registerFailure(key: string): Promise<RateLimit> {
  return db.runTransaction(async transaction => {
    const ref = db.doc(`workerLoginRateLimits/${key}`), snapshot = await transaction.get(ref);
    const failures = Number((snapshot.data() as Partial<RateLimit> | undefined)?.failures || 0) + 1;
    const duration = failureLockDuration(failures), lockedUntilMs = duration ? Date.now() + duration * 1000 : null;
    transaction.set(ref, { failures, lockedUntilMs, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { failures, lockedUntilMs };
  });
}
async function clearFailures(key: string): Promise<void> {
  await db.doc(`workerLoginRateLimits/${key}`).set({ failures: 0, lockedUntilMs: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Stored format: scrypt$N$r$p$base64Salt$base64Hash. */
function verifyLoginCode(loginCode: string, storedHash: unknown): boolean {
  if (typeof storedHash !== 'string') return false;
  const [algorithm, nText, rText, pText, saltText, hashText] = storedHash.split('$');
  const N = Number(nText), r = Number(rText), p = Number(pText);
  if (algorithm !== 'scrypt' || !Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p) || N < 16384 || r < 8 || p < 1) return false;
  try {
    const expected = Buffer.from(hashText, 'base64');
    const actual = crypto.scryptSync(loginCode, Buffer.from(saltText, 'base64'), expected.length, { N, r, p, maxmem: 128 * 1024 * 1024 });
    return expected.length > 0 && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

async function handleWorkerLogin(request: { data: unknown; rawRequest: { ip?: string } }): Promise<WorkerLoginResponse> {
  const data = request.data as { companyCode?: unknown; username?: unknown; loginCode?: unknown };
  const companyCode = normalize(data.companyCode), username = normalize(data.username);
  const loginCode = typeof data.loginCode === 'string' ? data.loginCode : '';
  if (!safeInput(companyCode) || !safeInput(username) || loginCode.length < 1 || loginCode.length > 256) return { success: false, code: 'INVALID_REQUEST', message: GENERIC_FAILURE };
  const rateKey = digest(`${companyCode}\u0000${username}\u0000${request.rawRequest.ip || 'unknown'}`), now = Date.now();
  const currentLimit = await getRateLimit(rateKey);
  if (currentLimit.lockedUntilMs && currentLimit.lockedUntilMs > now) return { success: false, code: 'LOCKED', message: GENERIC_FAILURE, retryAfterSeconds: Math.ceil((currentLimit.lockedUntilMs - now) / 1000) };
  try {
    const companies = await db.collection('companies').where('companyCode', '==', companyCode).limit(2).get();
    if (companies.size !== 1) throw new Error('invalid');
    const company = companies.docs[0], companyData = company.data();
    const subscriptionDeadline = timestampMillis(companyData.gracePeriodEnd || companyData.subscriptionEnd);
    if (companyData.status === 'suspended' || companyData.status === 'expired' || (subscriptionDeadline !== null && Date.now() > subscriptionDeadline)) throw new Error('invalid');
    const workers = await company.ref.collection('workers').where('username', '==', username).limit(2).get();
    if (workers.size !== 1) throw new Error('invalid');
    const worker = workers.docs[0], workerData = worker.data();
    const secret = await company.ref.collection('workerSecrets').doc(worker.id).get();
    // New tenant workers never inherit legacy credentials. Their hash must exist
    // only in workerSecrets; a readable workers document is never a fallback.
    if (workerData.status !== 'active' || !secret.exists || !verifyLoginCode(loginCode, secret.data()?.loginCodeHash)) throw new Error('invalid');
    const uid = typeof workerData.authUid === 'string' ? workerData.authUid : '';
    const member = uid ? await company.ref.collection('members').doc(uid).get() : null;
    if (!member?.exists || member.data()?.role !== 'worker' || member.data()?.status !== 'active') throw new Error('invalid');
    await clearFailures(rateKey);
    return { success: true, code: 'OK', message: 'تم تسجيل الدخول بنجاح.', customToken: await auth.createCustomToken(uid, { companyId: company.id, role: 'worker', workerId: worker.id }) };
  } catch (error) {
    logger.warn('Worker login rejected', { rateKey, reason: error instanceof Error ? error.message : 'unknown' });
    const next = await registerFailure(rateKey), retryAfterSeconds = next.lockedUntilMs ? Math.max(0, Math.ceil((next.lockedUntilMs - Date.now()) / 1000)) : undefined;
    return { success: false, code: retryAfterSeconds ? 'LOCKED' : 'INVALID_CREDENTIALS', message: GENERIC_FAILURE, retryAfterSeconds };
  }
}

export const workerLogin = onCall({ region: 'us-central1', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true', invoker: 'public' }, async request => {
  try {
    return await handleWorkerLogin(request);
  } catch {
    // Infrastructure failures are intentionally indistinguishable from invalid credentials.
    return { success: false, code: 'INVALID_CREDENTIALS', message: GENERIC_FAILURE } satisfies WorkerLoginResponse;
  }
});

/** Setup is deliberately limited to the local emulator or an explicitly configured staging environment. */
export const createInitialPlatformOwner = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'private' }, async () => ({ success: false, code: 'SETUP_DISABLED', message: 'إعداد المنصة غير متاح في هذه البيئة.' }));

/** Creates only synthetic, isolated tenant records and is never available in production. */
export const seedTestMultiTenantData = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'private' }, async (request) => {
  if (!testDataEnvironmentAllowed()) return { success: false, code: 'SEED_DISABLED', message: 'بيانات الاختبار غير متاحة في هذه البيئة.' };
  return provisionTestMultiTenantData(request.data);
});

/** Privileged provisioning endpoint, available only after an explicit local/staging setup gate. */
export const createCompanyWithOwner = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: { auth?: { uid: string; token: Record<string, unknown> }; data: unknown }): Promise<CreateCompanyResponse> => {
  if (!setupEnvironmentAllowed()) return { success: false, code: 'UNKNOWN_ERROR', message: 'هذه العملية متاحة في Emulator أو Staging المصرح فقط.' };
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.platform_owner !== true) return { success: false, code: 'UNAUTHORIZED', message: 'غير مصرح بهذه العملية.' };
  try {
    const platformUser = await db.doc(`platformUsers/${uid}`).get();
    if (!platformUser.exists || platformUser.data()?.role !== 'platform_owner' || platformUser.data()?.status !== 'active') return { success: false, code: 'UNAUTHORIZED', message: 'غير مصرح بهذه العملية.' };
    return await new CompanyProvisioningService({ db, auth }).create(request.data, uid);
  } catch (error) {
    logger.error('Company provisioning authorization failed', { uid, reason: error instanceof Error ? error.message : 'unknown' });
    return { success: false, code: 'UNAUTHORIZED', message: 'غير مصرح بهذه العملية.' };
  }
});

export const updateCompany = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: { auth?: { uid: string; token: Record<string, unknown> }; data: unknown }): Promise<UpdateCompanyResponse> => {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.platform_owner !== true) return { success: false, code: 'UNAUTHORIZED', message: 'غير مصرح بهذه العملية.' };
  const platformUser = await db.doc(`platformUsers/${uid}`).get();
  if (!platformUser.exists || platformUser.data()?.role !== 'platform_owner' || platformUser.data()?.status !== 'active') return { success: false, code: 'UNAUTHORIZED', message: 'غير مصرح بهذه العملية.' };
  const data = (request.data || {}) as Partial<UpdateCompanyRequest>;
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const slug = typeof data.slug === 'string' ? data.slug.trim().toLowerCase() : '';
  const companyCode = typeof data.companyCode === 'string' ? data.companyCode.trim() : '';
  const ownerName = typeof data.ownerName === 'string' ? data.ownerName.trim() : '';
  const ownerEmail = typeof data.ownerEmail === 'string' ? data.ownerEmail.trim().toLowerCase() : '';
  const plan = typeof data.plan === 'string' ? data.plan.trim() : '';
  const status = data.status;
  const subscriptionStart = typeof data.subscriptionStart === 'string' ? data.subscriptionStart : '';
  const subscriptionEnd = typeof data.subscriptionEnd === 'string' ? data.subscriptionEnd : '';
  const startTime = Date.parse(subscriptionStart), endTime = Date.parse(subscriptionEnd);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(companyId) || !name || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) || !/^\d{6}$/.test(companyCode) || !ownerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) || !plan || !['trial','active','past_due','expired','suspended'].includes(String(status)) || !Number.isInteger(data.maxUsers) || Number(data.maxUsers) < 1 || !Array.isArray(data.features) || data.features.some(value => typeof value !== 'string' || !value.trim()) || !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return { success: false, code: 'INVALID_INPUT', message: 'بيانات تحديث الشركة غير صالحة.' };
  const companyRef = db.doc(`companies/${companyId}`);
  try {
    await db.runTransaction(async tx => {
      const company = await tx.get(companyRef);
      if (!company.exists) throw new Error('COMPANY_NOT_FOUND');
      if (Number(data.maxUsers) < Number(company.data()?.memberCount || 0)) throw new Error('MAX_USERS_TOO_LOW');
      const oldSlug = String(company.data()?.slug || '');
      const oldCode = String(company.data()?.companyCode || '');
      let newCodeRef: FirebaseFirestore.DocumentReference | undefined;
      let oldCodeRef: FirebaseFirestore.DocumentReference | undefined;
      let shouldDeleteOldCodeIndex = false;
      if (companyCode !== oldCode) {
        newCodeRef = db.doc(`companyIndexes/code_${companyCode}`);
        oldCodeRef = /^\d{6}$/.test(oldCode) ? db.doc(`companyIndexes/code_${oldCode}`) : undefined;
        const [codeIndex, codeMatches, oldCodeIndex] = await Promise.all([
          tx.get(newCodeRef),
          tx.get(db.collection('companies').where('companyCode', '==', companyCode).limit(1)),
          oldCodeRef ? tx.get(oldCodeRef) : Promise.resolve(undefined),
        ]);
        const conflictingCompany = !codeMatches.empty && codeMatches.docs[0].id !== companyId;
        if ((codeIndex.exists && codeIndex.data()?.companyId !== companyId) || conflictingCompany) throw new Error('COMPANY_CODE_EXISTS');
        shouldDeleteOldCodeIndex = Boolean(oldCodeRef && oldCodeIndex?.exists && oldCodeIndex.data()?.companyId === companyId);
      }
      if (slug !== oldSlug) {
        const slugRef = db.doc(`companyIndexes/slug_${slug}`);
        if ((await tx.get(slugRef)).exists) throw new Error('SLUG_EXISTS');
        tx.create(slugRef, { companyId, value: slug, createdAt: FieldValue.serverTimestamp() });
        if (oldSlug) tx.delete(db.doc(`companyIndexes/slug_${oldSlug}`));
      }
      if (shouldDeleteOldCodeIndex && oldCodeRef) tx.delete(oldCodeRef);
      if (newCodeRef) tx.set(newCodeRef, { companyId, value: companyCode, createdAt: FieldValue.serverTimestamp() });
      tx.update(companyRef, { name, slug, companyCode, ownerName, ownerEmail, plan, status, subscriptionStart, subscriptionEnd, maxUsers: data.maxUsers, features: data.features!.map(value => String(value).trim()).filter(Boolean), updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true, code: 'OK', message: 'تم تحديث الشركة بنجاح.' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    const code = reason === 'SLUG_EXISTS' ? 'SLUG_EXISTS' : reason === 'COMPANY_CODE_EXISTS' ? 'COMPANY_CODE_EXISTS' : reason === 'MAX_USERS_TOO_LOW' ? 'INVALID_INPUT' : 'UNKNOWN_ERROR';
    return { success: false, code, message: reason === 'SLUG_EXISTS' ? 'Slug مستخدم بالفعل.' : reason === 'COMPANY_CODE_EXISTS' ? 'رمز الشركة مستخدم بالفعل.' : reason === 'MAX_USERS_TOO_LOW' ? 'لا يمكن أن يقل maxUsers عن عدد أعضاء الشركة الحالي.' : 'تعذر تحديث الشركة.' };
  }
});

const memberService = new CompanyMemberService({ db, auth, emulator: process.env.FUNCTIONS_EMULATOR === 'true' });
const memberFunctionOptions = { region: 'us-central1' as const, enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true', invoker: 'public' as const };
type MemberRequest = { auth?: { uid: string }; data: unknown };
export const createCompanyMember = onCall(memberFunctionOptions, (request: MemberRequest): Promise<CreateCompanyMemberResponse> => memberService.create(request.data as CreateCompanyMemberRequest, request.auth));
export const updateCompanyMember = onCall(memberFunctionOptions, (request: MemberRequest): Promise<UpdateCompanyMemberResponse> => memberService.update(request.data as UpdateCompanyMemberRequest, request.auth));
export const changeCompanyMemberRole = onCall(memberFunctionOptions, (request: MemberRequest): Promise<ChangeCompanyMemberRoleResponse> => memberService.changeRole(request.data as ChangeCompanyMemberRoleRequest, request.auth));
export const disableCompanyMember = onCall(memberFunctionOptions, (request: MemberRequest): Promise<DisableCompanyMemberResponse> => memberService.disable(request.data as DisableCompanyMemberRequest, request.auth));
export const reactivateCompanyMember = onCall(memberFunctionOptions, (request: MemberRequest): Promise<ReactivateCompanyMemberResponse> => memberService.reactivate(request.data as ReactivateCompanyMemberRequest, request.auth));
export const sendCompanyMemberPasswordReset = onCall(memberFunctionOptions, (request: MemberRequest): Promise<SendCompanyMemberPasswordResetResponse> => memberService.passwordReset(request.data as SendCompanyMemberPasswordResetRequest, request.auth));
export const resetWorkerLoginCode = onCall(memberFunctionOptions, (request: MemberRequest): Promise<ResetWorkerLoginCodeResponse> => memberService.resetWorkerCode(request.data as ResetWorkerLoginCodeRequest, request.auth));
