import type { Auth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import type { CreateCompanyError, CreateCompanyRequest, CreateCompanyResponse } from './apiTypes.js';
export type { CreateCompanyError, CreateCompanyRequest, CreateCompanyResponse } from './apiTypes.js';

type Transaction = {
  get: (ref: FirebaseFirestore.DocumentReference | FirebaseFirestore.Query) => Promise<FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QuerySnapshot>;
  create: (ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData) => Transaction;
  set: (ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData) => Transaction;
  delete: (ref: FirebaseFirestore.DocumentReference) => Transaction;
};

export type ProvisioningDependencies = {
  db: FirebaseFirestore.Firestore;
  auth: Auth;
  now?: () => number;
};

const validKey = (value: string) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const failure = (code: CreateCompanyError, message: string): CreateCompanyResponse => ({ success: false, code, message });

export function validateCreateCompanyRequest(input: unknown): CreateCompanyRequest | CreateCompanyResponse {
  if (!input || typeof input !== 'object') return failure('INVALID_INPUT', 'بيانات الطلب غير صحيحة.');
  const value = input as Partial<CreateCompanyRequest>;
  const strings = ['companyName', 'slug', 'ownerName', 'ownerEmail', 'ownerPassword', 'planId', 'plan', 'subscriptionStart', 'subscriptionEnd'] as const;
  if (strings.some(key => typeof value[key] !== 'string' || !value[key]?.trim())) return failure('INVALID_INPUT', 'جميع الحقول النصية المطلوبة يجب أن تكون موجودة.');
  const normalized = { ...value, companyName: value.companyName!.trim(), ownerName: value.ownerName!.trim(), ownerEmail: value.ownerEmail!.trim().toLowerCase(), slug: value.slug!.trim().toLowerCase(), planId: value.planId!.trim(), plan: value.plan!.trim() } as CreateCompanyRequest;
  if (!emailPattern.test(normalized.ownerEmail) || normalized.ownerPassword.length < 12 || !validKey(normalized.slug)) return failure('INVALID_INPUT', 'بيانات المالك أو slug غير صالحة.');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized.planId) || (value.maxUsers !== null && (!Number.isInteger(value.maxUsers) || Number(value.maxUsers) <= 0)) || !Array.isArray(value.features) || value.features.some(feature => typeof feature !== 'string' || !feature.trim())) return failure('INVALID_INPUT', 'maxUsers أو features غير صالح.');
  const start = Date.parse(normalized.subscriptionStart), end = Date.parse(normalized.subscriptionEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return failure('INVALID_INPUT', 'تواريخ الاشتراك غير صالحة.');
  normalized.features = [...new Set(value.features.map(feature => feature.trim()))];
  normalized.maxUsers = value.maxUsers ?? null;
  normalized.status = value.status === 'trial' ? 'trial' : 'active';
  return normalized;
}

export class CompanyProvisioningService {
  constructor(private readonly dependencies: ProvisioningDependencies) {}

  async create(input: unknown, createdBy: string): Promise<CreateCompanyResponse> {
    const startedAt = this.dependencies.now?.() ?? Date.now();
    const request = validateCreateCompanyRequest(input);
    if ('success' in request) return request;
    const { db, auth } = this.dependencies;
    let ownerUid: string | undefined;
    logger.info('Company provisioning started', { createdBy, slug: request.slug });
    try {
      const existingEmail = await auth.getUserByEmail(request.ownerEmail).catch(error => {
        if ((error as { code?: string }).code === 'auth/user-not-found') return null;
        throw error;
      });
      if (existingEmail) return failure('EMAIL_EXISTS', 'البريد الإلكتروني مستخدم بالفعل.');
      const slugMatches = await db.collection('companies').where('slug', '==', request.slug).limit(1).get();
      if (!slugMatches.empty) return failure('SLUG_EXISTS', 'Slug مستخدم بالفعل.');
      // Generate the company ID before creating the account so its Auth token
      // is ready for the first company-session resolution.
      const companyRef = db.collection('companies').doc();
      try {
        const user = await auth.createUser({ displayName: request.ownerName, email: request.ownerEmail, password: request.ownerPassword, emailVerified: false });
        ownerUid = user.uid;
        await auth.setCustomUserClaims(ownerUid, { companyId: companyRef.id, role: 'company_super_admin' });
      } catch (error) {
        if ((error as { code?: string }).code === 'auth/email-already-exists') return failure('EMAIL_EXISTS', 'البريد الإلكتروني مستخدم بالفعل.');
        // A claim-assignment failure happens after the Auth user exists. Let
        // the outer handler remove that partial account before returning.
        if (ownerUid) throw error;
        return failure('AUTH_CREATION_FAILED', 'تعذر إنشاء مستخدم المالك.');
      }
      const memberRef = companyRef.collection('members').doc(ownerUid);
      const auditRef = db.collection('platformAuditLogs').doc();
      // Registries make slug/code uniqueness transactionally enforceable for this provisioning path.
      const slugRef = db.doc(`companyIndexes/slug_${request.slug}`);
      const counterRef = db.doc('platformCounters/companyCode');
      let generatedCompanyCode = '';
      await db.runTransaction(async transaction => {
        const [slugIndex, counter] = await Promise.all([transaction.get(slugRef), transaction.get(counterRef)]);
        if ((slugIndex as FirebaseFirestore.DocumentSnapshot).exists) throw new ProvisioningFailure('SLUG_EXISTS', 'Slug مستخدم بالفعل.');
        let nextCode = Math.max(100001, Number((counter as FirebaseFirestore.DocumentSnapshot).data()?.lastCode || 100000) + 1);
        let codeRef: FirebaseFirestore.DocumentReference | undefined;
        while (nextCode <= 999999) {
          generatedCompanyCode = String(nextCode);
          codeRef = db.doc(`companyIndexes/code_${generatedCompanyCode}`);
          const [codeIndex, legacyMatch] = await Promise.all([
            transaction.get(codeRef),
            transaction.get(db.collection('companies').where('companyCode', '==', generatedCompanyCode).limit(1)),
          ]);
          if (!codeIndex.exists && (legacyMatch as FirebaseFirestore.QuerySnapshot).empty) break;
          nextCode += 1;
        }
        if (!codeRef || nextCode > 999999) throw new ProvisioningFailure('COMPANY_CODE_EXISTS', 'نفد نطاق رموز الشركات المتاح.');
        const timestamp = FieldValue.serverTimestamp();
        transaction.create(slugRef, { companyId: companyRef.id, value: request.slug, createdAt: timestamp });
        transaction.create(codeRef, { companyId: companyRef.id, value: generatedCompanyCode, createdAt: timestamp });
        transaction.set(counterRef, { lastCode: nextCode, updatedAt: timestamp });
        transaction.create(companyRef, { name: request.companyName, slug: request.slug, companyCode: generatedCompanyCode, ownerName: request.ownerName, ownerEmail: request.ownerEmail, planId: request.planId, plan: request.plan, subscriptionStart: request.subscriptionStart, subscriptionEnd: request.subscriptionEnd, maxUsers: request.maxUsers, features: request.features, status: request.status, memberCount: 1, activeMemberCount: 1, orderCount: 0, createdAt: timestamp, updatedAt: timestamp });
        transaction.create(memberRef, { uid: ownerUid, companyId: companyRef.id, companyCode: generatedCompanyCode, name: request.ownerName, email: request.ownerEmail, role: 'company_super_admin', status: 'active', createdAt: timestamp, updatedAt: timestamp });
        transaction.create(auditRef, { companyId: companyRef.id, ownerUid, createdBy, timestamp, action: 'company_created_with_owner' });
      });
      const response = { success: true, code: 'OK', message: 'تم إنشاء الشركة ومالكها بنجاح.', companyId: companyRef.id, ownerUid } satisfies CreateCompanyResponse;
      logger.info('Company provisioning completed', { companyId: companyRef.id, ownerUid, durationMs: (this.dependencies.now?.() ?? Date.now()) - startedAt });
      return response;
    } catch (error) {
      const known = error instanceof ProvisioningFailure ? error : new ProvisioningFailure('UNKNOWN_ERROR', 'تعذر إنشاء الشركة.');
      logger.error('Company provisioning failed', { code: known.code, durationMs: (this.dependencies.now?.() ?? Date.now()) - startedAt });
      // Firestore transaction writes are atomic; only the Auth user exists outside it.
      const rollbackOk = await this.rollback(ownerUid, []);
      return rollbackOk ? failure(known.code, known.message) : failure('ROLLBACK_FAILED', 'فشلت العملية وتعذر إكمال التراجع الآمن.');
    }
  }

  private async rollback(ownerUid: string | undefined, refs: FirebaseFirestore.DocumentReference[]): Promise<boolean> {
    try {
      if (refs.length) await this.dependencies.db.runTransaction(async transaction => { refs.forEach(ref => transaction.delete(ref)); });
      if (ownerUid) await this.dependencies.auth.deleteUser(ownerUid);
      logger.info('Company provisioning rollback completed', { ownerUid: ownerUid ?? null });
      return true;
    } catch (error) {
      logger.error('Company provisioning rollback failed', { ownerUid: ownerUid ?? null, reason: error instanceof Error ? error.message : 'unknown' });
      return false;
    }
  }
}

class ProvisioningFailure extends Error {
  constructor(readonly code: CreateCompanyError, message: string) { super(message); }
}
