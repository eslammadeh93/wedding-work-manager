import * as crypto from 'node:crypto';
import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

admin.initializeApp();
const db = admin.firestore();
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
    transaction.set(ref, { failures, lockedUntilMs, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { failures, lockedUntilMs };
  });
}
async function clearFailures(key: string): Promise<void> {
  await db.doc(`workerLoginRateLimits/${key}`).set({ failures: 0, lockedUntilMs: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
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
    if (workerData.status !== 'active' || !verifyLoginCode(loginCode, workerData.loginCodeHash)) throw new Error('invalid');
    const uid = typeof workerData.authUid === 'string' ? workerData.authUid : '';
    const member = uid ? await company.ref.collection('members').doc(uid).get() : null;
    if (!member?.exists || member.data()?.role !== 'worker' || member.data()?.status !== 'active') throw new Error('invalid');
    await clearFailures(rateKey);
    return { success: true, code: 'OK', message: 'تم تسجيل الدخول بنجاح.', customToken: await admin.auth().createCustomToken(uid, { companyId: company.id, role: 'worker', workerId: worker.id }) };
  } catch (error) {
    logger.warn('Worker login rejected', { rateKey, reason: error instanceof Error ? error.message : 'unknown' });
    const next = await registerFailure(rateKey), retryAfterSeconds = next.lockedUntilMs ? Math.max(0, Math.ceil((next.lockedUntilMs - Date.now()) / 1000)) : undefined;
    return { success: false, code: retryAfterSeconds ? 'LOCKED' : 'INVALID_CREDENTIALS', message: GENERIC_FAILURE, retryAfterSeconds };
  }
}

export const workerLogin = onCall({ region: 'us-central1', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true' }, async request => {
  try {
    return await handleWorkerLogin(request);
  } catch {
    // Infrastructure failures are intentionally indistinguishable from invalid credentials.
    return { success: false, code: 'INVALID_CREDENTIALS', message: GENERIC_FAILURE } satisfies WorkerLoginResponse;
  }
});
