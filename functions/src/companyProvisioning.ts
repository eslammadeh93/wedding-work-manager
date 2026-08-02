import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';

export type CreateCompanyError =
  | 'OK' | 'UNAUTHORIZED' | 'INVALID_INPUT' | 'COMPANY_EXISTS' | 'SLUG_EXISTS'
  | 'COMPANY_CODE_EXISTS' | 'EMAIL_EXISTS' | 'AUTH_CREATION_FAILED'
  | 'COMPANY_CREATION_FAILED' | 'MEMBER_CREATION_FAILED' | 'AUDIT_LOG_FAILED'
  | 'ROLLBACK_FAILED' | 'UNKNOWN_ERROR';

export interface CreateCompanyRequest {
  companyName: string; slug: string; companyCode: string; ownerName: string; ownerEmail: string; ownerPassword: string;
  plan: string; subscriptionStart: string; subscriptionEnd: string; maxUsers: number; features: string[];
}

export interface CreateCompanyResponse {
  success: boolean; code: CreateCompanyError; message: string; companyId?: string; ownerUid?: string;
}

type Transaction = {
  get: (ref: FirebaseFirestore.DocumentReference | FirebaseFirestore.Query) => Promise<FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QuerySnapshot>;
  create: (ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData) => Transaction;
  set: (ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData) => Transaction;
  delete: (ref: FirebaseFirestore.DocumentReference) => Transaction;
};

export type ProvisioningDependencies = {
  db: FirebaseFirestore.Firestore;
  auth: admin.auth.Auth;
  now?: () => number;
};

const validKey = (value: string) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const failure = (code: CreateCompanyError, message: string): CreateCompanyResponse => ({ success: false, code, message });

export function validateCreateCompanyRequest(input: unknown): CreateCompanyRequest | CreateCompanyResponse {
  if (!input || typeof input !== 'object') return failure('INVALID_INPUT', 'بيانات الطلب غير صحيحة.');
  const value = input as Partial<CreateCompanyRequest>;
  const strings = ['companyName', 'slug', 'companyCode', 'ownerName', 'ownerEmail', 'ownerPassword', 'plan', 'subscriptionStart', 'subscriptionEnd'] as const;
  if (strings.some(key => typeof value[key] !== 'string' || !value[key]?.trim())) return failure('INVALID_INPUT', 'جميع الحقول النصية المطلوبة يجب أن تكون موجودة.');
  const normalized = { ...value, companyName: value.companyName!.trim(), ownerName: value.ownerName!.trim(), ownerEmail: value.ownerEmail!.trim().toLowerCase(), slug: value.slug!.trim().toLowerCase(), companyCode: value.companyCode!.trim().toLowerCase(), plan: value.plan!.trim() } as CreateCompanyRequest;
  if (!emailPattern.test(normalized.ownerEmail) || normalized.ownerPassword.length < 12 || !validKey(normalized.slug) || !validKey(normalized.companyCode)) return failure('INVALID_INPUT', 'بيانات المالك أو slug أو companyCode غير صالحة.');
  if (!Number.isInteger(value.maxUsers) || value.maxUsers! <= 0 || !Array.isArray(value.features) || value.features.some(feature => typeof feature !== 'string' || !feature.trim())) return failure('INVALID_INPUT', 'maxUsers أو features غير صالح.');
  const start = Date.parse(normalized.subscriptionStart), end = Date.parse(normalized.subscriptionEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return failure('INVALID_INPUT', 'تواريخ الاشتراك غير صالحة.');
  normalized.features = [...new Set(value.features.map(feature => feature.trim()))];
  normalized.maxUsers = value.maxUsers!;
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
    const rollbackRefs: FirebaseFirestore.DocumentReference[] = [];
    logger.info('Company provisioning started', { createdBy, slug: request.slug });
    try {
      const existingEmail = await auth.getUserByEmail(request.ownerEmail).catch(error => {
        if ((error as { code?: string }).code === 'auth/user-not-found') return null;
        throw error;
      });
      if (existingEmail) return failure('EMAIL_EXISTS', 'البريد الإلكتروني مستخدم بالفعل.');
      const [slugMatches, codeMatches] = await Promise.all([
        db.collection('companies').where('slug', '==', request.slug).limit(1).get(),
        db.collection('companies').where('companyCode', '==', request.companyCode).limit(1).get(),
      ]);
      if (!slugMatches.empty) return failure('SLUG_EXISTS', 'Slug مستخدم بالفعل.');
      if (!codeMatches.empty) return failure('COMPANY_CODE_EXISTS', 'Company code مستخدم بالفعل.');
      try {
        const user = await auth.createUser({ displayName: request.ownerName, email: request.ownerEmail, password: request.ownerPassword, emailVerified: false });
        ownerUid = user.uid;
      } catch (error) {
        if ((error as { code?: string }).code === 'auth/email-already-exists') return failure('EMAIL_EXISTS', 'البريد الإلكتروني مستخدم بالفعل.');
        return failure('AUTH_CREATION_FAILED', 'تعذر إنشاء مستخدم المالك.');
      }
      const companyRef = db.collection('companies').doc();
      const memberRef = companyRef.collection('members').doc(ownerUid);
      const auditRef = db.collection('platformAuditLogs').doc();
      // Registries make slug/code uniqueness transactionally enforceable for this provisioning path.
      const slugRef = db.doc(`companyIndexes/slug_${request.slug}`);
      const codeRef = db.doc(`companyIndexes/code_${request.companyCode}`);
      rollbackRefs.push(companyRef, memberRef, auditRef, slugRef, codeRef);
      await db.runTransaction(async transaction => {
        const [slugIndex, codeIndex] = await Promise.all([transaction.get(slugRef), transaction.get(codeRef)]);
        if ((slugIndex as FirebaseFirestore.DocumentSnapshot).exists) throw new ProvisioningFailure('SLUG_EXISTS', 'Slug مستخدم بالفعل.');
        if ((codeIndex as FirebaseFirestore.DocumentSnapshot).exists) throw new ProvisioningFailure('COMPANY_CODE_EXISTS', 'Company code مستخدم بالفعل.');
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        transaction.create(slugRef, { companyId: companyRef.id, value: request.slug, createdAt: timestamp });
        transaction.create(codeRef, { companyId: companyRef.id, value: request.companyCode, createdAt: timestamp });
        transaction.create(companyRef, { name: request.companyName, slug: request.slug, companyCode: request.companyCode, plan: request.plan, subscriptionStart: request.subscriptionStart, subscriptionEnd: request.subscriptionEnd, maxUsers: request.maxUsers, features: request.features, status: 'active', memberCount: 1, createdAt: timestamp, updatedAt: timestamp });
        transaction.create(memberRef, { uid: ownerUid, name: request.ownerName, email: request.ownerEmail, role: 'company_super_admin', status: 'active', createdAt: timestamp, updatedAt: timestamp });
        transaction.create(auditRef, { companyId: companyRef.id, ownerUid, createdBy, timestamp, action: 'company_created_with_owner' });
      });
      const response = { success: true, code: 'OK', message: 'تم إنشاء الشركة ومالكها بنجاح.', companyId: companyRef.id, ownerUid } satisfies CreateCompanyResponse;
      logger.info('Company provisioning completed', { companyId: companyRef.id, ownerUid, durationMs: (this.dependencies.now?.() ?? Date.now()) - startedAt });
      return response;
    } catch (error) {
      const known = error instanceof ProvisioningFailure ? error : new ProvisioningFailure('UNKNOWN_ERROR', 'تعذر إنشاء الشركة.');
      logger.error('Company provisioning failed', { code: known.code, durationMs: (this.dependencies.now?.() ?? Date.now()) - startedAt });
      const rollbackOk = await this.rollback(ownerUid, rollbackRefs);
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
