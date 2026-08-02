import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const admin = { firestore: { FieldValue } };
import * as crypto from 'node:crypto';
import { hashWorkerLoginCode } from './companyMembers.js';

type SetupResponse = { success: boolean; code: string; message: string; data?: Record<string, unknown> };
const ok = (message: string, data?: Record<string, unknown>): SetupResponse => ({ success: true, code: 'OK', message, ...(data ? { data } : {}) });
const fail = (code: string, message: string): SetupResponse => ({ success: false, code, message });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emulator = () => process.env.FUNCTIONS_EMULATOR === 'true';
const staging = () => process.env.MULTI_TENANT_SETUP_MODE === 'staging';

/** There is intentionally no production setup mode. */
export const setupEnvironmentAllowed = () => emulator() || staging();
/** Test records require the emulator or an explicit staging test-mode opt-in. */
export const testDataEnvironmentAllowed = () => emulator() || (staging() && process.env.MULTI_TENANT_TEST_MODE === 'true');

function setupSecretValid(input: unknown): boolean {
  if (emulator()) return true;
  const expected = process.env.SETUP_BOOTSTRAP_SECRET;
  const supplied = typeof input === 'object' && input ? (input as { bootstrapSecret?: unknown }).bootstrapSecret : undefined;
  return typeof expected === 'string' && expected.length >= 24 && typeof supplied === 'string'
    && supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function createInitialPlatformOwner(input: unknown): Promise<SetupResponse> {
  if (!setupEnvironmentAllowed() || !setupSecretValid(input)) return fail('UNAUTHORIZED', 'بيانات إعداد المنصة غير صالحة.');
  const data = (input || {}) as { email?: unknown; password?: unknown; name?: unknown };
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const password = typeof data.password === 'string' ? data.password : '';
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!emailPattern.test(email) || !name || password.length < 12) return fail('INVALID_INPUT', 'الاسم والبريد وكلمة مرور من 12 حرفاً على الأقل مطلوبة.');
  const db = getFirestore(), auth = getAuth();
  const existingOwners = await db.collection('platformUsers').where('role', '==', 'platform_owner').limit(1).get();
  if (!existingOwners.empty) return fail('OWNER_EXISTS', 'يوجد platform_owner بالفعل؛ لا يمكن إنشاء آخر عبر مسار الإعداد الأولي.');
  let uid: string | undefined;
  try {
    const user = await auth.createUser({ email, password, displayName: name, emailVerified: false });
    uid = user.uid;
    await auth.setCustomUserClaims(uid, { platform_owner: true });
    await db.doc(`platformUsers/${uid}`).create({ uid, name, email, role: 'platform_owner', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), source: 'new_system_setup' });
    await db.collection('platformAuditLogs').add({ action: 'initial_platform_owner_created', targetUid: uid, timestamp: admin.firestore.FieldValue.serverTimestamp(), environment: emulator() ? 'emulator' : 'staging' });
    return ok('تم إنشاء platform_owner الجديد بأمان.', { uid });
  } catch {
    if (uid) await auth.deleteUser(uid).catch(() => undefined);
    return fail('OWNER_CREATION_FAILED', 'تعذر إنشاء platform_owner.');
  }
}

type SeedCompany = { key: string; name: string; code: string; slug: string };
const seedCompanies: SeedCompany[] = [
  { key: 'alpha', name: 'شركة ألفا التجريبية', code: 'alpha-demo', slug: 'alpha-demo' },
  { key: 'beta', name: 'شركة بيتا التجريبية', code: 'beta-demo', slug: 'beta-demo' },
];

/** Explicit test fixture. It never reads/writes any legacy/root operational collection. */
export async function seedTestMultiTenantData(input: unknown): Promise<SetupResponse> {
  if (!testDataEnvironmentAllowed() || !setupSecretValid(input)) return fail('UNAUTHORIZED', 'بيانات الاختبار غير مصرح بها.');
  if ((input as { confirmSeed?: unknown } | undefined)?.confirmSeed !== true) return fail('CONFIRMATION_REQUIRED', 'أرسل confirmSeed=true لتشغيل بيانات الاختبار.');
  const db = getFirestore(), auth = getAuth();
  const batch = db.batch();
  const credentials: Record<string, string> = {};
  for (const companySeed of seedCompanies) {
    const companyRef = db.collection('companies').doc(`test_${companySeed.key}`);
    const users = [
      ['owner', 'company_super_admin', `${companySeed.key}.owner@example.test`],
      ['manager', 'manager', `${companySeed.key}.manager@example.test`],
      ['employee', 'employee', `${companySeed.key}.employee@example.test`],
    ] as const;
    const uids: Record<string, string> = {};
    for (const [key, role, email] of users) {
      const uid = `test_${companySeed.key}_${key}`;
      await auth.createUser({ uid, email, password: `Test-${companySeed.key}-Pass1!`, displayName: `${companySeed.name} ${key}` }).catch(async error => {
        if ((error as { code?: string }).code !== 'auth/uid-already-exists') throw error;
      });
      uids[key] = uid;
      batch.set(companyRef.collection('members').doc(uid), { uid, companyId: companyRef.id, name: `${companySeed.name} ${key}`, email, role, status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), source: 'test_seed' }, { merge: true });
      credentials[`${companySeed.key}.${key}`] = `${email} / Test-${companySeed.key}-Pass1!`;
    }
    batch.set(companyRef, { name: companySeed.name, slug: companySeed.slug, companyCode: companySeed.code, plan: 'test', status: 'active', subscriptionStart: '2026-01-01', subscriptionEnd: '2099-01-01', maxUsers: 10, memberCount: 5, activeMemberCount: 5, features: ['orders'], createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), source: 'test_seed' }, { merge: true });
    const workers = [1, 2].map(number => ({ id: `worker_${companySeed.key}_${number}`, uid: `test_${companySeed.key}_worker_${number}`, username: `${companySeed.key}_worker_${number}`, code: `Worker-${companySeed.key}-${number}` }));
    for (const worker of workers) {
      await auth.createUser({ uid: worker.uid, displayName: `${companySeed.name} worker ${worker.id.at(-1)}` }).catch(async error => { if ((error as { code?: string }).code !== 'auth/uid-already-exists') throw error; });
      batch.set(companyRef.collection('members').doc(worker.uid), { uid: worker.uid, companyId: companyRef.id, name: `${companySeed.name} ${worker.id}`, email: null, role: 'worker', status: 'active', workerId: worker.id, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), source: 'test_seed' }, { merge: true });
      batch.set(companyRef.collection('workers').doc(worker.id), { name: `${companySeed.name} ${worker.id}`, username: worker.username, authUid: worker.uid, status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), source: 'test_seed' }, { merge: true });
      batch.set(companyRef.collection('workerSecrets').doc(worker.id), { loginCodeHash: hashWorkerLoginCode(worker.code), loginCodeVersion: 1, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), source: 'test_seed' }, { merge: true });
      credentials[`${companySeed.key}.${worker.id}`] = `${companySeed.code} / ${worker.username} / ${worker.code}`;
    }
    batch.set(companyRef.collection('customers').doc(`customer_${companySeed.key}`), { id: `customer_${companySeed.key}`, companyId: companyRef.id, name: `عميل ${companySeed.key}`, createdAt: admin.firestore.FieldValue.serverTimestamp(), source: 'test_seed' }, { merge: true });
    batch.set(companyRef.collection('orders').doc(`order_${companySeed.key}`), { id: `order_${companySeed.key}`, companyId: companyRef.id, customerId: `customer_${companySeed.key}`, workerId: workers[0].id, createdAt: admin.firestore.FieldValue.serverTimestamp(), source: 'test_seed' }, { merge: true });
    batch.set(companyRef.collection('inventory').doc(`inventory_${companySeed.key}`), { id: `inventory_${companySeed.key}`, companyId: companyRef.id, name: `مخزون ${companySeed.key}`, quantity: 3, totalQuantity: 3, availableQuantity: 3, reservedQuantity: 0, source: 'test_seed' }, { merge: true });
    batch.set(companyRef.collection('expenses').doc(`expense_${companySeed.key}`), { id: `expense_${companySeed.key}`, companyId: companyRef.id, amount: 10, type: 'expense', linkedOrderId: `order_${companySeed.key}`, source: 'test_seed' }, { merge: true });
    batch.set(companyRef.collection('categories').doc(`category_${companySeed.key}`), { id: `category_${companySeed.key}`, companyId: companyRef.id, nameAr: `تصنيف ${companySeed.key}`, nameEn: `Category ${companySeed.key}`, source: 'test_seed' }, { merge: true });
    batch.set(companyRef.collection('notifications').doc(`notification_${companySeed.key}`), { id: `notification_${companySeed.key}`, companyId: companyRef.id, targetUid: uids.employee, read: false, source: 'test_seed' }, { merge: true });
    batch.set(companyRef.collection('settings').doc('main'), { companyId: companyRef.id, source: 'test_seed', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  try { await batch.commit(); } catch { return fail('SEED_FAILED', 'تعذر إنشاء بيانات الاختبار.'); }
  // Credentials are returned only by the local emulator; staging callers receive no secrets.
  return ok('تم إنشاء شركتين تجريبيتين مع بيانات معزولة.', emulator() ? { credentials } : undefined);
}
