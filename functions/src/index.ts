import * as crypto from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import * as logger from 'firebase-functions/logger';
import { CompanyProvisioningService } from './companyProvisioning.js';
import { CompanyMemberService, hashWorkerLoginCode } from './companyMembers.js';
import type { ChangeCompanyMemberRoleRequest, ChangeCompanyMemberRoleResponse, CreateAdditionalCompanyOwnerRequest, CreateAdditionalCompanyOwnerResponse, CreateCompanyMemberRequest, CreateCompanyMemberResponse, CreateCompanyResponse, DeleteCompanyMemberRequest, DeleteCompanyMemberResponse, DeleteWorkerRequest, DeleteWorkerResponse, DisableCompanyMemberRequest, DisableCompanyMemberResponse, ReactivateCompanyMemberRequest, ReactivateCompanyMemberResponse, ResetWorkerLoginCodeRequest, ResetWorkerLoginCodeResponse, SendCompanyMemberPasswordResetRequest, SendCompanyMemberPasswordResetResponse, UpdateCompanyMemberRequest, UpdateCompanyMemberResponse, UpdateCompanyRequest, UpdateCompanyResponse, UpdateOwnCompanyProfileRequest, UpdateOwnCompanyProfileResponse } from './apiTypes.js';
import type { MarkCompanyNotificationsReadRequest, MarkCompanyNotificationsReadResponse, RecordOrderActivityRequest, RecordOrderActivityResponse, RecordWorkerMovementRequest, RecordWorkerMovementResponse, SetWorkerStatusRequest, SetWorkerStatusResponse, UpdateWorkerOrderStatusRequest, UpdateWorkerOrderStatusResponse, UpdateWorkerRequest, UpdateWorkerResponse } from './apiTypes.js';
import { seedTestMultiTenantData as provisionTestMultiTenantData, setupEnvironmentAllowed, testDataEnvironmentAllowed } from './setup.js';
import { PlatformDashboardService } from './platformDashboard.js';
import { PlatformRebuildService } from './platformRebuild.js';
import { createPlatformAggregationTriggers } from './platformAggregation.js';
import { buildWorkerOrderContactProjection, buildWorkerOrderProjection, enforceAssignmentContactReset } from './workerOrderProjection.js';
import { cairoDate, notifyMemberDevices, notifyWorkerAboutOrder, notifyWorkerAboutTask } from './pushNotifications.js';
import { createGoogleDriveFunctions } from './googleDrive.js';
import { createTransportationFunctions } from './transportation.js';

initializeApp();
// This back-office application has many small functions and modest traffic.
// Capping instances and using the Gen 1 CPU profile avoids exhausting the
// project's regional Cloud Run CPU quota during deployment or traffic spikes.
setGlobalOptions({ region: 'us-central1', maxInstances: 1, cpu: 'gcf_gen1' });
const db = getFirestore();
const auth = getAuth();
const googleDriveFunctions = createGoogleDriveFunctions(db);
const transportationFunctions = createTransportationFunctions(db);
export const beginGoogleDriveConnection = googleDriveFunctions.beginGoogleDriveConnection;
export const googleDriveOAuthCallback = googleDriveFunctions.googleDriveOAuthCallback;
export const getGoogleDriveConnectionStatus = googleDriveFunctions.getGoogleDriveConnectionStatus;
export const disconnectGoogleDrive = googleDriveFunctions.disconnectGoogleDrive;
export const uploadOrderDesignImage = googleDriveFunctions.uploadOrderDesignImage;
export const deleteOrderDesignImage = googleDriveFunctions.deleteOrderDesignImage;
export const calculateTransportationRoute = transportationFunctions.calculateTransportationRoute;
const platformDashboardService = new PlatformDashboardService({ db });
const platformRebuildService = new PlatformRebuildService(db);
const platformAggregationTriggers = createPlatformAggregationTriggers(db);
export const updatePlatformCompanyAggregates = platformAggregationTriggers.companyWritten;
export const updatePlatformMemberAggregates = platformAggregationTriggers.memberWritten;
export const updatePlatformOrderAggregates = platformAggregationTriggers.orderWritten;
export const refreshPlatformAggregatePeriods = platformAggregationTriggers.refreshPeriods;
const projectionDebugEnabled = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.NODE_ENV === 'development';
const projectionDebug = (event: string, details: Record<string, unknown>) => {
  if (projectionDebugEnabled) logger.info(`[worker-order-projection] ${event}`, details);
};

/**
 * Writes each field-safe order projection and its contact capability atomically.
 * The fallback callable uses this for legacy orders, while the Firestore trigger
 * uses the same path shape for regular writes.
 */
async function writeWorkerOrderProjections(companyId: string, orders: Array<{ id: string; data: Record<string, unknown> }>) {
  const commits: Array<Promise<unknown>> = [];
  let batch = db.batch();
  let operationCount = 0;
  const commitCurrentBatch = () => {
    if (operationCount === 0) return;
    commits.push(batch.commit());
    batch = db.batch();
    operationCount = 0;
  };

  for (const order of orders) {
    // Every order consumes two operations: a safe order projection and a
    // contact set/delete. Stay well inside Firestore's 500-write limit.
    if (operationCount + 2 > 450) commitCurrentBatch();
    const companyRef = db.collection('companies').doc(companyId);
    const workerOrderRef = companyRef.collection('workerOrders').doc(order.id);
    const contactRef = companyRef.collection('workerOrderContacts').doc(order.id);
    batch.set(workerOrderRef, buildWorkerOrderProjection(companyId, order.id, order.data));
    const contact = buildWorkerOrderContactProjection(companyId, order.id, order.data);
    if (contact) batch.set(contactRef, contact);
    else batch.delete(contactRef);
    operationCount += 2;
  }
  commitCurrentBatch();
  await Promise.all(commits);
}

export const syncWorkerOrderAccess = onDocumentWritten({ document: 'companies/{companyId}/orders/{orderId}', region: 'us-central1' }, async event => {
  const companyId = event.params.companyId;
  const orderId = event.params.orderId;
  const companyRef = db.collection('companies').doc(companyId);
  const workerOrderRef = companyRef.collection('workerOrders').doc(orderId);
  const contactRef = companyRef.collection('workerOrderContacts').doc(orderId);
  const batch = db.batch();

  if (!event.data?.after.exists) {
    batch.delete(workerOrderRef);
    batch.delete(contactRef);
    await batch.commit();
    projectionDebug('deleted', {
      orderId, workerId: null, assignedWorkerId: null, workerCanContactCustomer: false,
      workerOrderContactsPath: contactRef.path, contactDocumentExists: false,
    });
    return;
  }

  const before = event.data.before.exists ? event.data.before.data() : undefined;
  const after = event.data.after.data() || {};
  if (after.deletedAt || after.archivedAt) {
    batch.delete(workerOrderRef);
    batch.delete(contactRef);
    await batch.commit();
    return;
  }
  const assignment = enforceAssignmentContactReset(before, after);
  const effectiveOrder = assignment.order;
  const assignedWorkerId = typeof after.workerId === 'string' ? after.workerId.trim() : '';
  projectionDebug('source order written', {
    orderId, workerId: assignedWorkerId || null, assignedWorkerId: assignedWorkerId || null,
    workerCanContactCustomer: after.workerCanContactCustomer === true,
    workerOrderContactsPath: contactRef.path, assignmentReset: assignment.resetRequired,
  });

  // Admin SDK writes also keep the invariant, even though client rules already reject this state.
  if (assignment.resetRequired) {
    batch.update(event.data.after.ref, { workerCanContactCustomer: false });
  }

  const workerId = typeof effectiveOrder.workerId === 'string' ? effectiveOrder.workerId.trim() : '';
  if (!workerId) {
    batch.delete(workerOrderRef);
    batch.delete(contactRef);
  } else {
    batch.set(workerOrderRef, buildWorkerOrderProjection(companyId, orderId, effectiveOrder));
    const contact = buildWorkerOrderContactProjection(companyId, orderId, effectiveOrder);
    if (contact) batch.set(contactRef, contact);
    else batch.delete(contactRef);
  }
  await batch.commit();
  if (projectionDebugEnabled) {
    const contactSnapshot = await contactRef.get();
    projectionDebug('projection synchronized', {
      orderId, workerId: workerId || null, assignedWorkerId: assignedWorkerId || null,
      workerCanContactCustomer: effectiveOrder.workerCanContactCustomer === true,
      workerOrderContactsPath: contactRef.path, contactDocumentExists: contactSnapshot.exists,
    });
  }
});

/** Sends a single, idempotent push when an order is assigned or reassigned to a worker. */
export const notifyWorkerOnOrderAssignment = onDocumentWritten({ document: 'companies/{companyId}/orders/{orderId}', region: 'us-central1' }, async event => {
  if (!event.data?.after.exists) return;
  const before = event.data.before.exists ? event.data.before.data() || {} : {};
  const after = event.data.after.data() || {};
  if (after.deletedAt || after.archivedAt) return;
  const previousWorkerId = typeof before.workerId === 'string' ? before.workerId.trim() : '';
  const workerId = typeof after.workerId === 'string' ? after.workerId.trim() : '';
  if (!workerId || workerId === previousWorkerId) return;
  await notifyWorkerAboutOrder(db, {
    companyId: event.params.companyId,
    workerId,
    orderId: event.params.orderId,
    orderNumber: String(after.orderNumber || event.params.orderId),
    customerName: String(after.customerName || ''),
    eventDate: String(after.eventDate || after.weddingDate || ''),
    kind: 'assignment',
  });
});

/** Sends one push and one in-app notification when a standalone work request is assigned or reassigned. */
export const notifyWorkerOnWorkTaskAssignment = onDocumentWritten({ document: 'companies/{companyId}/workTasks/{taskId}', region: 'us-central1' }, async event => {
  if (!event.data?.after.exists) return;
  const before = event.data.before.exists ? event.data.before.data() || {} : {};
  const after = event.data.after.data() || {};
  const previousWorkerId = typeof before.workerId === 'string' ? before.workerId.trim() : '';
  const workerId = typeof after.workerId === 'string' ? after.workerId.trim() : '';
  if (!workerId || workerId === previousWorkerId) return;
  await notifyWorkerAboutTask(db, {
    companyId: event.params.companyId,
    workerId,
    taskId: event.params.taskId,
    title: String(after.title || 'طلب عمل'),
    executionDate: String(after.executionDate || ''),
  });
});

/**
 * Opening an order is informational and belongs only in the Worker Movements
 * screen. Do not create a notification document here: that would put it in
 * the global notification slide and send it to the phone.
 */
export const notifyManagersWhenWorkerOpensOrder = onDocumentCreated({ document: 'companies/{companyId}/activityLogs/{logId}', region: 'us-central1' }, async event => {
  const log = event.data?.data() || {};
  const workerId = typeof log.workerId === 'string' ? log.workerId.trim() : '';
  const orderId = typeof log.orderId === 'string' ? log.orderId.trim() : '';
  if (log.action !== 'opened' || !workerId || !orderId) return;
  logger.info('Worker order opening retained in worker movements only', { companyId: event.params.companyId, orderId, workerId });
});

/** Sends browser pushes for the existing private notification stream. Worker-order
 * notifications are sent by their dedicated trigger above, so they are skipped
 * here to avoid a duplicate alert. */
export const notifyCompanyMemberAboutNotification = onDocumentCreated({ document: 'companies/{companyId}/notifications/{notificationId}', region: 'us-central1' }, async event => {
  const notification = event.data?.data() || {};
  const type = String(notification.type || '');
  const targetUid = typeof notification.targetUid === 'string' ? notification.targetUid.trim() : '';
  const title = String(notification.title || notification.titleAr || '').trim();
  const body = String(notification.body || notification.messageAr || '').trim();
  if (!targetUid || !title || type === 'worker_opened' || type.startsWith('worker_order_') || type.startsWith('worker_task_')) return;
  const companyRef = db.collection('companies').doc(event.params.companyId);
  const memberRef = companyRef.collection('members').doc(targetUid);
  const member = await memberRef.get();
  if (!member.exists || member.data()?.status !== 'active') return;
  // Firestore background events are delivered at least once. Claim the push
  // before sending it so a retry of the same notification document cannot
  // create a second system notification on the recipient's device.
  const deliveryRef = companyRef.collection('notificationDeliveries').doc(`member_push_${event.params.notificationId}`);
  try {
    await deliveryRef.create({ notificationId: event.params.notificationId, targetUid, type, createdAt: FieldValue.serverTimestamp() });
  } catch (error) {
    if ((error as { code?: number }).code === 6) return; // ALREADY_EXISTS
    throw error;
  }
  const module = typeof notification.linkModule === 'string' ? notification.linkModule : 'dashboard';
  const referenceId = typeof notification.referenceId === 'string' ? notification.referenceId : '';
  const result = await notifyMemberDevices(memberRef, {
    title,
    body,
    companyId: event.params.companyId,
    notificationId: event.params.notificationId,
    url: `/?module=${encodeURIComponent(module)}${referenceId ? `&referenceId=${encodeURIComponent(referenceId)}` : ''}`,
  });
  if (result) logger.info('Company notification push processed', { companyId: event.params.companyId, notificationId: event.params.notificationId, sent: result.successCount, stale: result.stale });
});

/** Permanently removes records that have remained in the recycle bin for 30 days. */
export const purgeExpiredRecycleBinItems = onSchedule({ schedule: '15 2 * * *', timeZone: 'UTC', region: 'us-central1' }, async () => {
  // Client records use ISO strings so they remain compatible with the existing
  // operational timestamps; lexicographic comparison preserves chronological order.
  const now = new Date().toISOString();
  for (const collectionName of ['orders', 'customers', 'inventory']) {
    const expired = await db.collectionGroup(collectionName).where('purgeAt', '<=', now).limit(400).get();
    if (expired.empty) continue;
    const batch = db.batch();
    expired.docs.forEach((snapshot) => batch.delete(snapshot.ref));
    await batch.commit();
    logger.info('Purged expired recycle-bin records', { collectionName, count: expired.size });
  }
});

/**
 * Keeps the operational orders query small. New/updated orders carry an
 * archiveEligibleAt value, so this job uses indexed filters rather than
 * scanning every company order. Archived records stay recoverable in
 * Firestore and are simply excluded from day-to-day pages.
 */
export const archiveOldFinishedOrders = onSchedule({ schedule: '35 2 * * *', timeZone: 'UTC', region: 'us-central1' }, async () => {
  const now = new Date().toISOString();
  const terminalStatuses = ['completed', 'returned', 'cancelled', 'cancelled_deposit_retained'];
  const eligible = await db.collectionGroup('orders')
    .where('archiveEligibleAt', '<=', now)
    .where('archivedAt', '==', null)
    .where('orderStatus', 'in', terminalStatuses)
    .limit(400)
    .get();
  if (eligible.empty) return;

  const batch = db.batch();
  eligible.docs.forEach((snapshot) => {
    batch.update(snapshot.ref, { archivedAt: now, updatedAt: now });
    const companyRef = snapshot.ref.parent.parent;
    if (companyRef) {
      batch.delete(companyRef.collection('workerOrders').doc(snapshot.id));
      batch.delete(companyRef.collection('workerOrderContacts').doc(snapshot.id));
    }
  });
  await batch.commit();
  logger.info('Archived old finished orders', { count: eligible.size });
});

/**
 * One-time, resumable migration for records created before archiveEligibleAt
 * was introduced. It processes 350 finished orders a night and saves a
 * cursor, so an established company is never forced through a full client
 * download or a single expensive backend scan.
 */
export const backfillLegacyOrderArchiveFields = onSchedule({ schedule: '50 2 * * *', timeZone: 'UTC', region: 'us-central1' }, async () => {
  const maintenanceRef = db.collection('systemMaintenance').doc('orderArchiveBackfill');
  const maintenance = await maintenanceRef.get();
  if (maintenance.data()?.complete === true) return;

  const cursorDate = typeof maintenance.data()?.lastEventDate === 'string' ? maintenance.data()?.lastEventDate : '';
  const cursorPath = typeof maintenance.data()?.lastOrderPath === 'string' ? maintenance.data()?.lastOrderPath : '';
  const terminalStatuses = ['completed', 'returned', 'cancelled', 'cancelled_deposit_retained'];
  let source = db.collectionGroup('orders')
    .where('orderStatus', 'in', terminalStatuses)
    .orderBy('eventDate', 'asc')
    .orderBy(FieldPath.documentId(), 'asc')
    .limit(350);
  if (cursorDate && cursorPath) source = source.startAfter(cursorDate, db.doc(cursorPath));
  const records = await source.get();
  if (records.empty) {
    await maintenanceRef.set({ complete: true, completedAt: new Date().toISOString() }, { merge: true });
    return;
  }

  const now = new Date().toISOString();
  const batch = db.batch();
  records.docs.forEach((snapshot) => {
    const data = snapshot.data();
    const eventDate = String(data.eventDate || data.weddingDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return;
    const eligibleAt = new Date(`${eventDate}T12:00:00Z`);
    eligibleAt.setUTCMonth(eligibleAt.getUTCMonth() + 6);
    const updates: Record<string, string> = { archiveEligibleAt: eligibleAt.toISOString() };
    if (eligibleAt.toISOString() <= now && !data.archivedAt) updates.archivedAt = now;
    batch.update(snapshot.ref, updates);
  });
  const last = records.docs[records.docs.length - 1];
  batch.set(maintenanceRef, { lastEventDate: String(last.data().eventDate || last.data().weddingDate || ''), lastOrderPath: last.ref.path, updatedAt: now, complete: false }, { merge: true });
  await batch.commit();
  logger.info('Backfilled legacy order archive fields', { count: records.size });
});

/** Reminds each assigned worker every morning about today's and tomorrow's active orders. */
export const sendWorkerOrderReminders = onSchedule({ schedule: '0 8 * * *', timeZone: 'Africa/Cairo', region: 'us-central1' }, async () => {
  const targets = [{ kind: 'today' as const, date: cairoDate() }, { kind: 'tomorrow' as const, date: cairoDate(1) }];
  const terminalStatuses = new Set(['completed', 'returned', 'cancelled', 'cancelled_deposit_retained']);
  for (const target of targets) {
    const orders = await db.collectionGroup('orders').where('eventDate', '==', target.date).limit(400).get();
    for (const order of orders.docs) {
      const data = order.data();
      const workerId = typeof data.workerId === 'string' ? data.workerId.trim() : '';
      const companyRef = order.ref.parent.parent;
      if (!workerId || !companyRef || data.deletedAt || data.archivedAt || terminalStatuses.has(String(data.orderStatus || ''))) continue;
      await notifyWorkerAboutOrder(db, {
        companyId: companyRef.id,
        workerId,
        orderId: order.id,
        orderNumber: String(data.orderNumber || order.id),
        customerName: String(data.customerName || ''),
        eventDate: target.date,
        kind: target.kind,
      });
    }
  }
});

type RecycleBinDeleteRequest = { type?: unknown; id?: unknown };
type RecycleBinDeleteResponse = { success: boolean; code: 'OK' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'NOT_FOUND' | 'NOT_DELETED' | 'UNKNOWN_ERROR'; message: string };
const recycleBinCollection = (type: unknown): 'orders' | 'customers' | 'inventory' | null => type === 'order' ? 'orders' : type === 'customer' ? 'customers' : type === 'inventory' ? 'inventory' : null;
const validRecycleBinDocumentId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 1_500 && !value.includes('/');

/**
 * Irreversibly removes one record already placed in the recycle bin.
 * This deliberately runs on the server: Firestore rules never allow clients
 * to permanently delete operational records.
 */
export const permanentlyDeleteRecycleBinItem = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: { auth?: { uid: string; token?: Record<string, unknown> }; data: RecycleBinDeleteRequest }): Promise<RecycleBinDeleteResponse> => {
  const uid = request.auth?.uid;
  const companyId = request.auth?.token?.companyId;
  const collectionName = recycleBinCollection(request.data?.type);
  const itemId = request.data?.id;
  if (!uid || !validRecycleBinDocumentId(companyId)) return { success: false, code: 'UNAUTHORIZED', message: 'انتهت جلسة تسجيل الدخول. سجّل الدخول مرة أخرى.' };
  if (!collectionName || !validRecycleBinDocumentId(itemId)) return { success: false, code: 'INVALID_INPUT', message: 'بيانات العنصر غير صالحة.' };

  const companyRef = db.collection('companies').doc(companyId);
  const member = await companyRef.collection('members').doc(uid).get();
  if (!member.exists || member.data()?.companyId !== companyId || member.data()?.status !== 'active') return { success: false, code: 'UNAUTHORIZED', message: 'حسابك غير نشط في هذه الشركة.' };
  if (member.data()?.role !== 'company_super_admin') return { success: false, code: 'FORBIDDEN', message: 'الحذف النهائي متاح لصاحب الشركة فقط.' };

  const itemRef = companyRef.collection(collectionName).doc(itemId);
  const auditRef = companyRef.collection('activityLogs').doc();
  try {
    await db.runTransaction(async transaction => {
      const item = await transaction.get(itemRef);
      if (!item.exists) throw new Error('NOT_FOUND');
      if (!item.data()?.deletedAt) throw new Error('NOT_DELETED');
      transaction.delete(itemRef);
      if (collectionName === 'orders') {
        transaction.delete(companyRef.collection('workerOrders').doc(itemId));
        transaction.delete(companyRef.collection('workerOrderContacts').doc(itemId));
      }
      transaction.set(auditRef, { companyId, action: 'recycle_bin_item_permanently_deleted', actorUid: uid, itemId, itemType: request.data.type, createdAt: FieldValue.serverTimestamp() });
    });
    return { success: true, code: 'OK', message: 'تم الحذف النهائي. لا يمكن استرجاع هذا العنصر.' };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (code === 'NOT_FOUND') return { success: false, code, message: 'العنصر لم يعد موجودًا.' };
    if (code === 'NOT_DELETED') return { success: false, code, message: 'لا يمكن الحذف النهائي إلا من سلة المحذوفات.' };
    logger.error('Permanent recycle-bin deletion failed', { companyId, uid, collectionName, itemId, error: code });
    return { success: false, code: 'UNKNOWN_ERROR', message: 'تعذر تنفيذ الحذف النهائي. حاول مرة أخرى.' };
  }
});
export const getPlatformDashboard = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, request => platformDashboardService.get(request));
export const rebuildPlatformAggregates = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public', timeoutSeconds: 120 }, request => platformRebuildService.run(request));
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
    if (companies.size !== 1) throw new Error('company_not_found');
    const company = companies.docs[0], companyData = company.data();
    const subscriptionDeadline = timestampMillis(companyData.gracePeriodEnd || companyData.subscriptionEnd);
    if (companyData.status === 'suspended' || companyData.status === 'expired' || (subscriptionDeadline !== null && Date.now() > subscriptionDeadline)) throw new Error('company_inactive');
    const workers = await company.ref.collection('workers').where('username', '==', username).limit(2).get();
    if (workers.size !== 1) throw new Error('username_not_found');
    const worker = workers.docs[0], workerData = worker.data();
    const secret = await company.ref.collection('workerSecrets').doc(worker.id).get();
    let uid = typeof workerData.authUid === 'string' ? workerData.authUid : '';
    if (workerData.status !== 'active') throw new Error('worker_inactive');
    let linkedAuthUser: Awaited<ReturnType<typeof auth.getUser>> | undefined;
    if (!uid) {
      linkedAuthUser = await auth.getUserByEmail(`${username}@worker.local`).catch(() => undefined);
      uid = linkedAuthUser?.uid || '';
      if (!uid) throw new Error('auth_uid_missing');
    }
    let member = await company.ref.collection('members').doc(uid).get();
    if (!secret.exists) {
      const legacyCode = typeof workerData.loginCode === 'string' ? workerData.loginCode : '';
      const sameLength = Buffer.byteLength(legacyCode) === Buffer.byteLength(loginCode);
      const matchesLegacyCode = sameLength && legacyCode.length > 0 && crypto.timingSafeEqual(Buffer.from(legacyCode), Buffer.from(loginCode));
      if (!matchesLegacyCode) throw new Error('login_code_invalid');
      const authUser = linkedAuthUser || await auth.getUser(uid);
      if (authUser.email?.toLowerCase() !== `${username}@worker.local`) throw new Error('auth_user_mismatch');
      const existingClaims = authUser.customClaims || {};
      const timestamp = FieldValue.serverTimestamp();
      await db.runTransaction(async tx => {
        const freshWorker = await tx.get(worker.ref), freshSecret = await tx.get(company.ref.collection('workerSecrets').doc(worker.id));
        const freshAuthUid = freshWorker.data()?.authUid;
        if (!freshWorker.exists || (typeof freshAuthUid === 'string' && freshAuthUid !== uid)) throw new Error('worker_changed');
        if (!freshSecret.exists) tx.create(freshSecret.ref, { loginCodeHash: hashWorkerLoginCode(loginCode), loginCodeVersion: 1, createdAt: timestamp, updatedAt: timestamp, migratedFromLegacy: true });
        tx.set(company.ref.collection('members').doc(uid), { uid, companyId: company.id, companyCode, name: String(workerData.fullName || workerData.name || username), email: null, role: 'worker', status: 'active', workerId: worker.id, phone: workerData.phone || null, updatedAt: timestamp, ...(!member.exists ? { createdAt: timestamp } : {}) }, { merge: true });
        tx.set(worker.ref, { companyId: company.id, companyCode, username, usernameNormalized: username, authUid: uid, status: 'active', loginCode: FieldValue.delete(), updatedAt: timestamp }, { merge: true });
      });
      await auth.setCustomUserClaims(uid, { ...existingClaims, companyId: company.id, role: 'worker', workerId: worker.id });
      member = await company.ref.collection('members').doc(uid).get();
      logger.info('Legacy worker credentials migrated', { stage: 'migration_complete', usernameNormalized: true, secretCreated: true, membershipActive: member.data()?.status === 'active' });
    } else if (!verifyLoginCode(loginCode, secret.data()?.loginCodeHash)) {
      throw new Error('login_code_invalid');
    }
    if (!member.exists || member.data()?.role !== 'worker' || member.data()?.status !== 'active' || member.data()?.companyId !== company.id || member.data()?.workerId !== worker.id) throw new Error('membership_invalid');
    await clearFailures(rateKey);
    return { success: true, code: 'OK', message: 'تم تسجيل الدخول بنجاح.', customToken: await auth.createCustomToken(uid, { companyId: company.id, role: 'worker', workerId: worker.id }) };
  } catch (error) {
    logger.warn('Worker login rejected', { rateKey, reason: error instanceof Error ? error.message : 'unknown' });
    const next = await registerFailure(rateKey), retryAfterSeconds = next.lockedUntilMs ? Math.max(0, Math.ceil((next.lockedUntilMs - Date.now()) / 1000)) : undefined;
    return { success: false, code: retryAfterSeconds ? 'LOCKED' : 'INVALID_CREDENTIALS', message: GENERIC_FAILURE, retryAfterSeconds };
  }
}

export const workerLogin = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async request => {
  try {
    return await handleWorkerLogin(request);
  } catch {
    // Infrastructure failures are intentionally indistinguishable from invalid credentials.
    return { success: false, code: 'INVALID_CREDENTIALS', message: GENERIC_FAILURE } satisfies WorkerLoginResponse;
  }
});

type LogoutResponse = { success: boolean; code: 'OK' | 'UNAUTHORIZED' | 'LOGOUT_FAILED'; message: string };

/**
 * Ends the authenticated user's server session by invalidating refresh tokens.
 * The client still calls Firebase signOut afterwards to clear the current
 * browser session immediately; this endpoint additionally prevents sessions
 * on other devices from obtaining new ID tokens.
 */
export const logout = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request): Promise<LogoutResponse> => {
  const uid = request.auth?.uid;
  if (!uid) return { success: false, code: 'UNAUTHORIZED', message: 'يجب تسجيل الدخول أولاً.' };

  try {
    await auth.revokeRefreshTokens(uid);
    logger.info('User logged out', { uid });
    return { success: true, code: 'OK', message: 'تم تسجيل الخروج بنجاح.' };
  } catch (error) {
    logger.error('Could not revoke user refresh tokens during logout', {
      uid,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { success: false, code: 'LOGOUT_FAILED', message: 'تعذر إنهاء الجلسة.' };
  }
});

export const getWorkerOrders = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async request => {
  if (!request.auth?.uid) return { success: false, code: 'UNAUTHORIZED', message: 'يجب تسجيل الدخول أولاً.' };
  const companyId = typeof request.auth.token.companyId === 'string' ? request.auth.token.companyId : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(companyId)) return { success: false, code: 'UNAUTHORIZED', message: 'عضوية العامل غير صالحة.' };
  const companyRef = db.collection('companies').doc(companyId);
  const member = await companyRef.collection('members').doc(request.auth.uid).get();
  const memberData = member.data() || {};
  if (!member.exists || memberData.uid !== request.auth.uid || memberData.companyId !== companyId || memberData.role !== 'worker' || memberData.status !== 'active' || typeof memberData.workerId !== 'string') return { success: false, code: 'FORBIDDEN', message: 'حساب العامل غير صالح.' };
  const company = await companyRef.get();
  if (!company.exists || !['active', 'trial'].includes(String(company.data()?.status))) return { success: false, code: 'FORBIDDEN', message: 'الشركة غير متاحة.' };
  const orders = await companyRef.collection('orders').where('workerId', '==', memberData.workerId).get();
  // Backfill safe realtime projections for legacy orders that predate the trigger.
  const projectionInputs = orders.docs.map(order => ({ id: order.id, data: order.data() }));
  const safeOrders = projectionInputs.map(order => buildWorkerOrderProjection(companyId, order.id, order.data));
  await writeWorkerOrderProjections(companyId, projectionInputs);
  projectionDebug('worker projection backfill complete', {
    workerId: memberData.workerId, orderCount: projectionInputs.length,
    workerOrderContactsPath: companyRef.collection('workerOrderContacts').path,
  });
  return { success: true, code: 'OK', orders: safeOrders };
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
  const uid = await isActivePlatformUserFor(request, 'platform:companies:create');
  if (!uid) return { success: false, code: 'UNAUTHORIZED', message: 'غير مصرح بهذه العملية.' };
  try {
    const data = (request.data || {}) as Record<string, unknown>;
    const planId = typeof data.planId === 'string' ? data.planId.trim() : '';
    if (!planIdIsValid(planId)) return { success: false, code: 'INVALID_INPUT', message: 'اختر باقة صالحة للشركة.' };
    const planSnapshot = await db.doc(`platformPlans/${planId}`).get();
    const planName = typeof planSnapshot.data()?.name === 'string' ? planSnapshot.data()!.name.trim() : '';
    const maxUsers = planSnapshot.data()?.maxUsers;
    if (!planSnapshot.exists || planName.length < 2 || !validPlanLimit(maxUsers)) return { success: false, code: 'INVALID_INPUT', message: 'الباقة المختارة غير موجودة أو غير صالحة.' };
    return await new CompanyProvisioningService({ db, auth }).create({ ...data, planId, plan: planName, maxUsers }, uid);
  } catch (error) {
    logger.error('Company provisioning authorization failed', { uid, reason: error instanceof Error ? error.message : 'unknown' });
    return { success: false, code: 'UNAUTHORIZED', message: 'غير مصرح بهذه العملية.' };
  }
});

export const updateCompany = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: { auth?: { uid: string; token: Record<string, unknown> }; data: unknown }): Promise<UpdateCompanyResponse> => {
  const uid = await isActivePlatformUserFor(request, 'platform:companies:update');
  if (!uid) return { success: false, code: 'UNAUTHORIZED', message: 'غير مصرح بهذه العملية.' };
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
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(companyId) || !name || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) || !/^\d{6}$/.test(companyCode) || !ownerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) || !plan || !['trial','active','past_due','expired','suspended'].includes(String(status)) || (data.maxUsers !== null && (!Number.isInteger(data.maxUsers) || Number(data.maxUsers) < 1)) || !Array.isArray(data.features) || data.features.some(value => typeof value !== 'string' || !value.trim()) || !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return { success: false, code: 'INVALID_INPUT', message: 'بيانات تحديث الشركة غير صالحة.' };
  const companyRef = db.doc(`companies/${companyId}`);
  try {
    await db.runTransaction(async tx => {
      const company = await tx.get(companyRef);
      if (!company.exists) throw new Error('COMPANY_NOT_FOUND');
      if (data.maxUsers !== null && Number(data.maxUsers) < Number(company.data()?.memberCount || 0)) throw new Error('MAX_USERS_TOO_LOW');
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

type PlatformOwnerRequest = { auth?: { uid: string; token?: Record<string, unknown> }; data: unknown };
const defaultPlatformConsoleSettings = { expiryDays: 30, compactMode: false, dailyDigest: true };
type PlatformCapability = 'platform:companies:create' | 'platform:companies:update' | 'platform:users:manage' | 'platform:subscriptions:read' | 'platform:subscriptions:manage' | 'platform:plans:read' | 'platform:plans:manage' | 'platform:console:read' | 'platform:notifications:manage' | 'platform:support:manage' | 'platform:settings:manage' | 'platform:admins:manage';
const platformPermissionValues = ['platform:dashboard:read', 'platform:companies:read', 'platform:companies:create', 'platform:companies:update', 'platform:companies:suspend', 'platform:companies:archive', 'platform:users:read', 'platform:users:manage', 'platform:subscriptions:read', 'platform:subscriptions:manage', 'platform:plans:read', 'platform:plans:manage', 'platform:audit_logs:read', 'platform:console:read', 'platform:notifications:manage', 'platform:support:manage', 'platform:settings:manage', 'platform:developer_tools:manage', 'platform:support:impersonate', 'platform:admins:manage', 'platform:dangerous_delete'] as const;
type ManagedPlatformPermission = typeof platformPermissionValues[number];
const platformRolePermissionDefaults: Record<string, readonly ManagedPlatformPermission[]> = {
  platform_owner: platformPermissionValues,
  platform_admin: ['platform:dashboard:read', 'platform:companies:read', 'platform:companies:update', 'platform:companies:suspend', 'platform:companies:archive', 'platform:users:read', 'platform:users:manage', 'platform:subscriptions:read', 'platform:plans:read', 'platform:audit_logs:read', 'platform:console:read', 'platform:notifications:manage', 'platform:support:manage'],
  platform_support: ['platform:dashboard:read', 'platform:companies:read', 'platform:users:read', 'platform:audit_logs:read', 'platform:console:read', 'platform:support:manage', 'platform:support:impersonate'],
  platform_billing: ['platform:dashboard:read', 'platform:companies:read', 'platform:subscriptions:read', 'platform:subscriptions:manage', 'platform:plans:read', 'platform:audit_logs:read'],
  platform_read_only: ['platform:dashboard:read', 'platform:companies:read', 'platform:users:read', 'platform:subscriptions:read', 'platform:plans:read', 'platform:audit_logs:read'],
};
const validPlatformPermissions = (value: unknown): ManagedPlatformPermission[] | null => Array.isArray(value) && value.every(permission => typeof permission === 'string' && (platformPermissionValues as readonly string[]).includes(permission)) ? [...new Set(value)] as ManagedPlatformPermission[] : null;
const rolePermissionRef = (role: string) => db.doc(`platformPermissionProfiles/${role}`);
const rolePermissions = async (role: string): Promise<ManagedPlatformPermission[]> => {
  const saved = await rolePermissionRef(role).get();
  const permissions = saved.exists ? validPlatformPermissions(saved.data()?.permissions) : null;
  return permissions || [...(platformRolePermissionDefaults[role] || [])];
};
const platformRoleCapabilities: Record<string, readonly PlatformCapability[]> = {
  platform_owner: ['platform:companies:create', 'platform:companies:update', 'platform:users:manage', 'platform:subscriptions:read', 'platform:subscriptions:manage', 'platform:plans:read', 'platform:plans:manage', 'platform:console:read', 'platform:notifications:manage', 'platform:support:manage', 'platform:settings:manage', 'platform:admins:manage'],
  platform_admin: ['platform:companies:update', 'platform:users:manage', 'platform:console:read', 'platform:notifications:manage', 'platform:support:manage'],
  platform_support: ['platform:console:read', 'platform:support:manage'],
  platform_billing: ['platform:subscriptions:read', 'platform:subscriptions:manage', 'platform:plans:read'],
  platform_read_only: [],
};
const isActivePlatformUserFor = async (request: PlatformOwnerRequest, capability: PlatformCapability): Promise<string | null> => {
  const uid = request.auth?.uid;
  if (!uid) return null;
  const profile = await db.doc(`platformUsers/${uid}`).get();
  const role = String(profile.data()?.role || '');
  const matchingRoleClaim = request.auth?.token?.platformRole === role;
  const legacyOwnerClaim = role === 'platform_owner' && request.auth?.token?.platform_owner === true;
  const savedPermissions = profile.exists && profile.data()?.permissionsCustomized === true ? validPlatformPermissions(profile.data()?.permissions) : null;
  const allowedPermissions = savedPermissions || await rolePermissions(role);
  return profile.exists && profile.data()?.status === 'active' && (matchingRoleClaim || legacyOwnerClaim) && allowedPermissions.includes(capability) ? uid : null;
};
const isActivePlatformOwner = async (request: PlatformOwnerRequest): Promise<string | null> => {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token?.platform_owner !== true) return null;
  const profile = await db.doc(`platformUsers/${uid}`).get();
  return profile.exists && profile.data()?.role === 'platform_owner' && profile.data()?.status === 'active' ? uid : null;
};

/** Irreversibly removes a tenant and every record/account owned by it. Platform owner only. */
export const deletePlatformCompany = onCall({ region: 'us-central1', timeoutSeconds: 540, enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const actorUid = await isActivePlatformOwner(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const confirmation = typeof data.confirmation === 'string' ? data.confirmation.trim() : '';
  if (!actorUid || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId)) return { success: false, message: 'غير مصرح بحذف الشركة.' };

  const companyRef = db.doc(`companies/${companyId}`);
  const companySnapshot = await companyRef.get();
  if (!companySnapshot.exists) return { success: false, message: 'الشركة غير موجودة.' };
  const company = companySnapshot.data() || {};
  const companyName = typeof company.name === 'string' ? company.name.trim() : '';
  if (!companyName || confirmation !== companyName) return { success: false, message: 'اكتب اسم الشركة كاملًا لتأكيد الحذف النهائي.' };

  const [members, workers] = await Promise.all([
    companyRef.collection('members').get(),
    companyRef.collection('workers').get(),
  ]);
  const authUids = new Set<string>();
  members.docs.forEach(member => {
    const uid = typeof member.data()?.uid === 'string' ? member.data()!.uid.trim() : member.id;
    if (uid) authUids.add(uid);
  });
  workers.docs.forEach(worker => {
    const uid = typeof worker.data()?.authUid === 'string' ? worker.data()!.authUid.trim() : '';
    if (uid) authUids.add(uid);
  });

  // Delete authentication accounts first. If this step fails, the company data
  // remains so the owner can safely retry the operation instead of leaving a
  // partially deleted tenant behind.
  try {
    for (const uid of authUids) {
      await auth.deleteUser(uid).catch(error => {
        if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
      });
    }
  } catch (error) {
    logger.error('Platform company deletion could not remove all Auth accounts', { companyId, actorUid, reason: error instanceof Error ? error.message : 'unknown' });
    return { success: false, message: 'تعذر حذف أحد حسابات الشركة. لم يتم حذف بيانات الشركة؛ أعد المحاولة.' };
  }

  const slug = typeof company.slug === 'string' ? company.slug.trim() : '';
  const companyCode = typeof company.companyCode === 'string' ? company.companyCode.trim() : '';
  const [supportTickets, notifications, auditLogs] = await Promise.all([
    db.collection('platformSupportTickets').where('companyId', '==', companyId).get(),
    db.collection('platformNotifications').where('companyId', '==', companyId).get(),
    db.collection('platformAuditLogs').where('companyId', '==', companyId).get(),
  ]);
  try {
    await db.recursiveDelete(companyRef);
    await db.recursiveDelete(db.doc(`companyDriveConnections/${companyId}`));
    for (const document of [...supportTickets.docs, ...notifications.docs, ...auditLogs.docs]) await db.recursiveDelete(document.ref);
    for (const uid of authUids) await db.doc(`users/${uid}`).delete().catch(() => undefined);
    for (const indexRef of [slug ? db.doc(`companyIndexes/slug_${slug}`) : null, /^\d{6}$/.test(companyCode) ? db.doc(`companyIndexes/code_${companyCode}`) : null]) {
      if (!indexRef) continue;
      const index = await indexRef.get();
      if (index.exists && index.data()?.companyId === companyId) await indexRef.delete();
    }
    await db.collection('platformAuditLogs').add({ action: 'platform_company_permanently_deleted', deletedCompanyId: companyId, deletedCompanyName: companyName, deletedAuthAccounts: authUids.size, createdBy: actorUid, timestamp: FieldValue.serverTimestamp() });
    return { success: true, message: 'تم حذف الشركة وكل بياناتها وحساباتها نهائيًا.' };
  } catch (error) {
    logger.error('Platform company deletion failed during data cleanup', { companyId, actorUid, reason: error instanceof Error ? error.message : 'unknown' });
    return { success: false, message: 'تم حذف حسابات الشركة، لكن تعذر إكمال حذف البيانات. تواصل مع الدعم لإكمال التنظيف.' };
  }
});
const timestampIso = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate().toISOString();
  return undefined;
};

/** Central, owner-only console data. Browser clients never write these paths directly. */
export const getPlatformConsoleState = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:console:read');
  if (!uid) throw new Error('UNAUTHORIZED');
  const [settingsSnapshot, ticketsSnapshot, notificationsSnapshot] = await Promise.all([
    db.doc('platformSettings/main').get(),
    db.collection('platformSupportTickets').get(),
    db.collection('platformNotifications').get(),
  ]);
  const stored = settingsSnapshot.data() || {};
  const settings = {
    expiryDays: Number.isInteger(stored.expiryDays) && stored.expiryDays >= 1 && stored.expiryDays <= 365 ? stored.expiryDays : defaultPlatformConsoleSettings.expiryDays,
    compactMode: stored.compactMode === true,
    dailyDigest: stored.dailyDigest !== false,
  };
  const supportTickets = ticketsSnapshot.docs.map(ticket => {
    const data = ticket.data();
    return {
      id: ticket.id,
      companyId: String(data.companyId || ''),
      companyName: String(data.companyName || 'شركة غير معرّفة'),
      subject: String(data.subject || 'طلب دعم'),
      status: ['open', 'in_progress', 'resolved'].includes(String(data.status)) ? String(data.status) : 'open',
      priority: ['low', 'normal', 'high', 'urgent'].includes(String(data.priority)) ? String(data.priority) : 'normal',
      assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : null,
      commentCount: Math.max(0, Number(data.commentCount || 0)),
      createdAt: timestampIso(data.createdAt),
      updatedAt: timestampIso(data.updatedAt),
    };
  }).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  const notifications = notificationsSnapshot.docs.map(notification => {
    const data = notification.data();
    return {
      id: notification.id,
      title: String(data.title || 'إشعار المنصة'),
      body: String(data.body || ''),
      severity: ['info', 'warning', 'critical'].includes(String(data.severity)) ? String(data.severity) : 'info',
      status: ['unread', 'read', 'archived'].includes(String(data.status)) ? String(data.status) : 'unread',
      companyId: typeof data.companyId === 'string' ? data.companyId : null,
      createdAt: timestampIso(data.createdAt),
    };
  }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { settings, supportTickets, notifications };
});

export const savePlatformConsoleSettings = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:settings:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const expiryDays = data.expiryDays;
  if (!uid || !Number.isInteger(expiryDays) || Number(expiryDays) < 1 || Number(expiryDays) > 365 || typeof data.compactMode !== 'boolean' || typeof data.dailyDigest !== 'boolean') return { success: false, message: 'بيانات الإعدادات غير صالحة.' };
  const timestamp = FieldValue.serverTimestamp();
  await db.doc('platformSettings/main').set({ expiryDays, compactMode: data.compactMode, dailyDigest: data.dailyDigest, updatedAt: timestamp, updatedBy: uid }, { merge: true });
  await db.collection('platformAuditLogs').add({ action: 'platform_console_settings_updated', createdBy: uid, timestamp });
  return { success: true, message: 'تم حفظ الإعدادات.' };
});

export const createPlatformSupportTicket = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:support:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const subject = typeof data.subject === 'string' ? data.subject.trim() : '';
  if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId) || subject.length < 4 || subject.length > 300) return { success: false, message: 'بيانات طلب الدعم غير صالحة.' };
  const company = await db.doc(`companies/${companyId}`).get();
  if (!company.exists) return { success: false, message: 'الشركة غير موجودة.' };
  const timestamp = FieldValue.serverTimestamp();
  const ticket = await db.collection('platformSupportTickets').add({ companyId, companyName: String(company.data()?.name || 'شركة'), subject, status: 'open', priority: 'normal', commentCount: 0, createdAt: timestamp, updatedAt: timestamp, createdBy: uid });
  await db.collection('platformAuditLogs').add({ action: 'platform_support_ticket_created', companyId, ticketId: ticket.id, createdBy: uid, timestamp });
  return { success: true, message: 'تم تسجيل طلب الدعم.' };
});

export const updatePlatformSupportTicket = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:support:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const ticketId = typeof data.ticketId === 'string' ? data.ticketId.trim() : '';
  const status = typeof data.status === 'string' ? data.status : '';
  const priority = typeof data.priority === 'string' ? data.priority : undefined;
  const assignedTo = data.assignedTo === null || typeof data.assignedTo === 'string' ? data.assignedTo : undefined;
  if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(ticketId) || !['open', 'in_progress', 'resolved'].includes(status) || (priority !== undefined && !['low', 'normal', 'high', 'urgent'].includes(priority))) return { success: false, message: 'بيانات طلب الدعم غير صالحة.' };
  const ticket = db.doc(`platformSupportTickets/${ticketId}`);
  const current = await ticket.get();
  if (!current.exists) return { success: false, message: 'طلب الدعم غير موجود.' };
  const timestamp = FieldValue.serverTimestamp();
  await ticket.update({ status, ...(priority !== undefined ? { priority } : {}), ...(assignedTo !== undefined ? { assignedTo } : {}), updatedAt: timestamp, updatedBy: uid });
  await db.collection('platformAuditLogs').add({ action: 'platform_support_ticket_updated', companyId: current.data()?.companyId || null, ticketId, createdBy: uid, timestamp, metadata: { status, priority: priority || null, assignedTo: assignedTo || null } });
  return { success: true, message: 'تم تحديث طلب الدعم.' };
});

export const addPlatformSupportComment = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:support:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const ticketId = typeof data.ticketId === 'string' ? data.ticketId.trim() : '';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(ticketId) || body.length < 1 || body.length > 2000) return { success: false, message: 'تعليق الدعم غير صالح.' };
  const ticket = db.doc(`platformSupportTickets/${ticketId}`);
  const current = await ticket.get();
  if (!current.exists) return { success: false, message: 'طلب الدعم غير موجود.' };
  const timestamp = FieldValue.serverTimestamp();
  await db.runTransaction(async tx => {
    const fresh = await tx.get(ticket);
    if (!fresh.exists) throw new Error('TICKET_NOT_FOUND');
    tx.create(ticket.collection('comments').doc(), { body, createdBy: uid, createdAt: timestamp });
    tx.update(ticket, { commentCount: FieldValue.increment(1), updatedAt: timestamp, updatedBy: uid });
  });
  await db.collection('platformAuditLogs').add({ action: 'platform_support_comment_added', companyId: current.data()?.companyId || null, ticketId, createdBy: uid, timestamp });
  return { success: true, message: 'تمت إضافة التعليق.' };
});

export const createPlatformNotification = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:notifications:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const severity = typeof data.severity === 'string' ? data.severity : '';
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : null;
  if (!uid || title.length < 3 || title.length > 160 || body.length < 3 || body.length > 1000 || !['info', 'warning', 'critical'].includes(severity)) return { success: false, message: 'بيانات الإشعار غير صالحة.' };
  if (companyId && !(await db.doc(`companies/${companyId}`).get()).exists) return { success: false, message: 'الشركة غير موجودة.' };
  const timestamp = FieldValue.serverTimestamp();
  const notification = await db.collection('platformNotifications').add({ title, body, severity, companyId, status: 'unread', createdBy: uid, createdAt: timestamp });
  await db.collection('platformAuditLogs').add({ action: 'platform_notification_created', companyId, notificationId: notification.id, createdBy: uid, timestamp, metadata: { severity } });
  return { success: true, message: 'تم إنشاء الإشعار.' };
});

export const updatePlatformNotification = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:notifications:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const notificationId = typeof data.notificationId === 'string' ? data.notificationId.trim() : '';
  const status = typeof data.status === 'string' ? data.status : '';
  if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(notificationId) || !['unread', 'read', 'archived'].includes(status)) return { success: false, message: 'بيانات الإشعار غير صالحة.' };
  const notification = db.doc(`platformNotifications/${notificationId}`);
  const current = await notification.get();
  if (!current.exists) return { success: false, message: 'الإشعار غير موجود.' };
  const timestamp = FieldValue.serverTimestamp();
  await notification.update({ status, updatedBy: uid, updatedAt: timestamp });
  await db.collection('platformAuditLogs').add({ action: 'platform_notification_updated', companyId: current.data()?.companyId || null, notificationId, createdBy: uid, timestamp, metadata: { status } });
  return { success: true, message: 'تم تحديث الإشعار.' };
});

export const deletePlatformNotification = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:notifications:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const notificationId = typeof data.notificationId === 'string' ? data.notificationId.trim() : '';
  if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(notificationId)) return { success: false, message: 'بيانات الإشعار غير صالحة.' };
  const notification = db.doc(`platformNotifications/${notificationId}`);
  const current = await notification.get();
  if (!current.exists) return { success: false, message: 'الإشعار غير موجود.' };
  const timestamp = FieldValue.serverTimestamp();
  await notification.delete();
  await db.collection('platformAuditLogs').add({ action: 'platform_notification_deleted', companyId: current.data()?.companyId || null, notificationId, createdBy: uid, timestamp });
  return { success: true, message: 'تم حذف الإشعار.' };
});

export const setPlatformMemberStatus = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:users:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const memberUid = typeof data.memberUid === 'string' ? data.memberUid.trim() : '';
  const status = typeof data.status === 'string' ? data.status : '';
  if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId) || !memberUid || !['active', 'disabled'].includes(status)) return { success: false, message: 'بيانات المستخدم غير صالحة.' };
  const company = db.doc(`companies/${companyId}`), member = company.collection('members').doc(memberUid);
  const current = await member.get();
  if (!current.exists) return { success: false, message: 'المستخدم غير موجود.' };
  if (current.data()?.status === status) return { success: true, message: 'الحالة محدثة بالفعل.' };
  if (status === 'disabled' && current.data()?.role === 'company_super_admin') {
    const owners = await company.collection('members').where('role', '==', 'company_super_admin').where('status', '==', 'active').get();
    if (owners.size <= 1) return { success: false, message: 'لا يمكن تعطيل آخر صاحب شركة نشط.' };
  }
  await auth.updateUser(memberUid, { disabled: status === 'disabled' });
  const timestamp = FieldValue.serverTimestamp();
  await db.runTransaction(async tx => {
    const fresh = await tx.get(member); if (!fresh.exists) throw new Error('MEMBER_NOT_FOUND');
    tx.update(member, { status, updatedAt: timestamp, updatedBy: uid });
    tx.update(company, { activeMemberCount: FieldValue.increment(status === 'active' ? 1 : -1), updatedAt: timestamp });
  });
  await db.collection('platformAuditLogs').add({ action: `platform_member_${status}`, companyId, targetUid: memberUid, createdBy: uid, timestamp });
  return { success: true, message: 'تم تحديث حالة المستخدم.' };
});

export const updatePlatformMember = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const actorUid = await isActivePlatformUserFor(request, 'platform:users:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const memberUid = typeof data.memberUid === 'string' ? data.memberUid.trim() : '';
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (!actorUid || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId) || !memberUid || name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, message: 'بيانات المستخدم غير صالحة.' };
  const member = db.doc(`companies/${companyId}/members/${memberUid}`);
  const current = await member.get();
  if (!current.exists) return { success: false, message: 'المستخدم غير موجود.' };
  try {
    await auth.updateUser(memberUid, { displayName: name, email });
    const timestamp = FieldValue.serverTimestamp();
    await member.update({ name, email, updatedAt: timestamp, updatedBy: actorUid });
    await db.doc(`users/${memberUid}`).set({ name, email, updatedAt: timestamp }, { merge: true });
    await db.collection('platformAuditLogs').add({ action: 'platform_member_updated', companyId, targetUid: memberUid, createdBy: actorUid, timestamp, metadata: { name, email } });
    return { success: true, message: 'تم تحديث حساب المستخدم.' };
  } catch (error) {
    return { success: false, message: (error as { code?: string }).code === 'auth/email-already-exists' ? 'البريد الإلكتروني مستخدم بالفعل.' : 'تعذر تحديث حساب المستخدم.' };
  }
});

export const setPlatformMemberTemporaryPassword = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:users:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const memberUid = typeof data.memberUid === 'string' ? data.memberUid.trim() : '';
  const temporaryPassword = typeof data.temporaryPassword === 'string' ? data.temporaryPassword : '';
  if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId) || !memberUid || temporaryPassword.length < 12 || temporaryPassword.length > 128) return { success: false, message: 'بيانات كلمة المرور غير صالحة.' };
  const member = await db.doc(`companies/${companyId}/members/${memberUid}`).get();
  if (!member.exists) return { success: false, message: 'المستخدم غير موجود.' };
  await auth.updateUser(memberUid, { password: temporaryPassword, disabled: false });
  const timestamp = FieldValue.serverTimestamp();
  await db.doc(`companies/${companyId}/members/${memberUid}`).update({ status: 'active', updatedAt: timestamp, updatedBy: uid });
  await db.collection('platformAuditLogs').add({ action: 'platform_member_temporary_password_set', companyId, targetUid: memberUid, createdBy: uid, timestamp });
  return { success: true, message: 'تم تعيين كلمة المرور المؤقتة وتفعيل الحساب.' };
});

const validPlanLimit = (value: unknown): value is number | null => value === null || (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 1_000_000);
const planIdIsValid = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);

export const listPlatformPlans = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:plans:read') || await isActivePlatformUserFor(request, 'platform:plans:manage');
  if (!uid) return { success: false, message: 'غير مصرح بعرض الباقات.' };
  const snapshot = await db.collection('platformPlans').get();
  const plans = snapshot.docs.map(doc => {
    const data = doc.data();
    return { id: doc.id, name: String(data.name || ''), maxUsers: validPlanLimit(data.maxUsers) ? data.maxUsers : null };
  }).filter(plan => plan.name.length > 0).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return { success: true, message: 'تم تحميل الباقات.', plans };
});

export const createPlatformPlan = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:plans:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const maxUsers = data.maxUsers;
  if (!uid || name.length < 2 || name.length > 80 || !validPlanLimit(maxUsers)) return { success: false, message: 'بيانات الباقة غير صالحة.' };
  const timestamp = FieldValue.serverTimestamp();
  const plan = db.collection('platformPlans').doc();
  await plan.create({ name, maxUsers, createdAt: timestamp, createdBy: uid, updatedAt: timestamp, updatedBy: uid });
  await db.collection('platformAuditLogs').add({ action: 'platform_plan_created', targetPlanId: plan.id, createdBy: uid, timestamp, metadata: { name, maxUsers } });
  return { success: true, message: 'تم إنشاء الباقة.' };
});

export const updatePlatformPlan = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:plans:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const planId = typeof data.planId === 'string' ? data.planId.trim() : '';
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const maxUsers = data.maxUsers;
  if (!uid || !planIdIsValid(planId) || name.length < 2 || name.length > 80 || !validPlanLimit(maxUsers)) return { success: false, message: 'بيانات الباقة غير صالحة.' };
  const plan = db.doc(`platformPlans/${planId}`);
  if (!(await plan.get()).exists) return { success: false, message: 'الباقة غير موجودة.' };
  const timestamp = FieldValue.serverTimestamp();
  await plan.update({ name, maxUsers, updatedAt: timestamp, updatedBy: uid });
  const subscribedCompanies = await db.collection('companies').where('planId', '==', planId).get();
  for (let index = 0; index < subscribedCompanies.docs.length; index += 450) {
    const batch = db.batch();
    subscribedCompanies.docs.slice(index, index + 450).forEach(company => batch.update(company.ref, { plan: name, maxUsers, updatedAt: timestamp, updatedBy: uid }));
    await batch.commit();
  }
  await db.collection('platformAuditLogs').add({ action: 'platform_plan_updated', targetPlanId: planId, createdBy: uid, timestamp, metadata: { name, maxUsers } });
  return { success: true, message: 'تم تحديث الباقة.' };
});

export const managePlatformSubscription = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const uid = await isActivePlatformUserFor(request, 'platform:subscriptions:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const planId = typeof data.planId === 'string' ? data.planId.trim() : '';
  const status = typeof data.status === 'string' ? data.status : '';
  const subscriptionEnd = typeof data.subscriptionEnd === 'string' ? data.subscriptionEnd : '';
  if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId) || !planIdIsValid(planId) || !['trial', 'active', 'past_due', 'expired', 'suspended'].includes(status) || !Number.isFinite(Date.parse(subscriptionEnd))) return { success: false, message: 'بيانات الاشتراك غير صالحة.' };
  const [companySnapshot, planSnapshot] = await Promise.all([db.doc(`companies/${companyId}`).get(), db.doc(`platformPlans/${planId}`).get()]);
  if (!companySnapshot.exists) return { success: false, message: 'الشركة غير موجودة.' };
  if (!planSnapshot.exists) return { success: false, message: 'الباقة غير موجودة.' };
  const planName = typeof planSnapshot.data()?.name === 'string' ? planSnapshot.data()!.name.trim() : '';
  const maxUsers = planSnapshot.data()?.maxUsers;
  if (planName.length < 2 || !validPlanLimit(maxUsers)) return { success: false, message: 'بيانات الباقة غير صالحة.' };
  const timestamp = FieldValue.serverTimestamp();
  await db.doc(`companies/${companyId}`).update({ plan: planName, planId, maxUsers, status, subscriptionEnd, updatedAt: timestamp, updatedBy: uid });
  await db.collection('platformAuditLogs').add({ action: 'platform_subscription_updated', companyId, createdBy: uid, timestamp, metadata: { planId, plan: planName, maxUsers, status, subscriptionEnd } });
  return { success: true, message: 'تم تحديث الاشتراك.' };
});

const platformRoles = ['platform_owner', 'platform_admin', 'platform_support', 'platform_billing', 'platform_read_only'] as const;
type ManagedPlatformRole = typeof platformRoles[number];
const validPlatformRole = (value: unknown): value is ManagedPlatformRole => typeof value === 'string' && (platformRoles as readonly string[]).includes(value);
const claimsForPlatformRole = (role: ManagedPlatformRole) => ({ platformRole: role, ...(role === 'platform_owner' ? { platform_owner: true } : {}) });
const protectedPlatformAdminEmail = 'eslam.madeh93@gmail.com';
const isProtectedPlatformAdmin = (data: { email?: unknown } | undefined) => String(data?.email || '').trim().toLowerCase() === protectedPlatformAdminEmail;

export const getPlatformPermissionConfiguration = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const actorUid = await isActivePlatformOwner(request);
  if (!actorUid) return { success: false, message: 'غير مصرح بعرض إعدادات الصلاحيات.' };
  const roles = Object.keys(platformRolePermissionDefaults);
  const entries = await Promise.all(roles.map(async role => [role, await rolePermissions(role)] as const));
  return { success: true, message: 'تم تحميل إعدادات الصلاحيات.', rolePermissions: Object.fromEntries(entries) };
});

export const updatePlatformRolePermissions = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const actorUid = await isActivePlatformOwner(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const role = typeof data.role === 'string' ? data.role : '';
  const permissions = validPlatformPermissions(data.permissions);
  if (!actorUid || !validPlatformRole(role) || !permissions) return { success: false, message: 'بيانات صلاحيات المنصب غير صالحة.' };
  if (role === 'platform_owner' && (!permissions.includes('platform:dashboard:read') || !permissions.includes('platform:admins:manage'))) return { success: false, message: 'يجب أن يحتفظ صاحب المنصة بصلاحية لوحة التحكم وإدارة المشرفين لتفادي فقدان الوصول.' };
  const timestamp = FieldValue.serverTimestamp();
  await rolePermissionRef(role).set({ role, permissions, updatedAt: timestamp, updatedBy: actorUid }, { merge: true });
  const accounts = await db.collection('platformUsers').where('role', '==', role).get();
  const batch = db.batch();
  accounts.docs.filter(account => account.data()?.permissionsCustomized !== true).forEach(account => batch.set(account.ref, { permissions, permissionsCustomized: false, updatedAt: timestamp, updatedBy: actorUid }, { merge: true }));
  await batch.commit();
  await db.collection('platformAuditLogs').add({ action: 'platform_role_permissions_updated', targetRole: role, createdBy: actorUid, timestamp, metadata: { permissions } });
  return { success: true, message: 'تم تحديث صلاحيات المنصب.' };
});

export const createPlatformAdmin = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const actorUid = await isActivePlatformUserFor(request, 'platform:admins:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const password = typeof data.password === 'string' ? data.password : '';
  const role = data.role;
  const useRolePermissions = data.useRolePermissions !== false;
  const customPermissions = data.permissions === undefined ? undefined : validPlatformPermissions(data.permissions);
  if (!actorUid || name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128 || !validPlatformRole(role) || customPermissions === null || (!useRolePermissions && !customPermissions)) return { success: false, message: 'بيانات المشرف غير صالحة.' };
  const permissions = useRolePermissions ? await rolePermissions(role) : customPermissions || [];
  if (role === 'platform_owner' && (!permissions.includes('platform:dashboard:read') || !permissions.includes('platform:admins:manage'))) return { success: false, message: 'لا يمكن إزالة صلاحيات الإدارة الأساسية من حساب صاحب المنصة.' };
  try {
    const user = await auth.createUser({ displayName: name, email, password, emailVerified: false });
    try {
      await auth.setCustomUserClaims(user.uid, claimsForPlatformRole(role));
      const timestamp = FieldValue.serverTimestamp();
      await db.doc(`platformUsers/${user.uid}`).create({ uid: user.uid, name, email, role, status: 'active', permissions, permissionsCustomized: !useRolePermissions, createdAt: timestamp, updatedAt: timestamp, createdBy: actorUid });
      await db.collection('platformAuditLogs').add({ action: 'platform_admin_created', targetUid: user.uid, createdBy: actorUid, timestamp, metadata: { role, permissionsCustomized: !useRolePermissions } });
      return { success: true, message: 'تم إنشاء حساب المشرف.' };
    } catch (error) {
      await auth.deleteUser(user.uid).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const code = (error as { code?: string }).code || '';
    return { success: false, message: code === 'auth/email-already-exists' ? 'البريد الإلكتروني مستخدم بالفعل.' : 'تعذر إنشاء حساب المشرف.' };
  }
});

export const updatePlatformAdmin = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const actorUid = await isActivePlatformUserFor(request, 'platform:admins:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const targetUid = typeof data.uid === 'string' ? data.uid.trim() : '';
  const name = typeof data.name === 'string' ? data.name.trim() : undefined;
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : undefined;
  const role = data.role;
  const status = data.status;
  const useRolePermissions = data.useRolePermissions === true;
  const customPermissions = data.permissions === undefined ? undefined : validPlatformPermissions(data.permissions);
  if (!actorUid || !targetUid || !validPlatformRole(role) || !['active', 'disabled'].includes(String(status)) || (name !== undefined && (name.length < 2 || name.length > 120)) || (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || customPermissions === null) return { success: false, message: 'بيانات المشرف غير صالحة.' };
  if (targetUid === actorUid && (status !== 'active' || role !== 'platform_owner')) return { success: false, message: 'لا يمكنك تقليل صلاحية أو تعطيل حسابك الحالي.' };
  const target = db.doc(`platformUsers/${targetUid}`);
  const current = await target.get();
  if (!current.exists) return { success: false, message: 'حساب المشرف غير موجود.' };
  if (isProtectedPlatformAdmin(current.data())) {
    const actor = await auth.getUser(actorUid);
    if (targetUid !== actorUid || actor.email?.trim().toLowerCase() !== protectedPlatformAdminEmail) return { success: false, message: 'هذا الحساب محمي ولا يمكن تعديله إلا عند تسجيل الدخول به.' };
    if (email !== undefined && email !== protectedPlatformAdminEmail) return { success: false, message: 'البريد الإلكتروني للحساب المحمي لا يمكن تغييره.' };
  }
  if (current.data()?.role === 'platform_owner' && current.data()?.status === 'active' && (role !== 'platform_owner' || status !== 'active')) {
    const owners = await db.collection('platformUsers').where('role', '==', 'platform_owner').where('status', '==', 'active').get();
    if (owners.size <= 1) return { success: false, message: 'لا يمكن تعديل أو تعطيل آخر صاحب منصة نشط.' };
  }
  const nextPermissions = useRolePermissions ? await rolePermissions(role) : customPermissions;
  if (role === 'platform_owner' && nextPermissions && (!nextPermissions.includes('platform:dashboard:read') || !nextPermissions.includes('platform:admins:manage'))) return { success: false, message: 'لا يمكن إزالة صلاحيات الإدارة الأساسية من حساب صاحب المنصة.' };
  await auth.setCustomUserClaims(targetUid, claimsForPlatformRole(role));
  await auth.updateUser(targetUid, { disabled: status === 'disabled', ...(name !== undefined ? { displayName: name } : {}), ...(email !== undefined ? { email } : {}) });
  const timestamp = FieldValue.serverTimestamp();
  await target.update({ role, status, ...(name !== undefined ? { name } : {}), ...(email !== undefined ? { email } : {}), ...(nextPermissions ? { permissions: nextPermissions, permissionsCustomized: !useRolePermissions } : {}), updatedAt: timestamp, updatedBy: actorUid });
  await db.collection('platformAuditLogs').add({ action: 'platform_admin_updated', targetUid, createdBy: actorUid, timestamp, metadata: { role, status, ...(name !== undefined ? { name } : {}), ...(email !== undefined ? { email } : {}), ...(nextPermissions ? { permissionsCustomized: !useRolePermissions } : {}) } });
  return { success: true, message: 'تم تحديث حساب المشرف.' };
});

export const deletePlatformAdmin = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const actorUid = await isActivePlatformUserFor(request, 'platform:admins:manage');
  const data = (request.data || {}) as Record<string, unknown>;
  const targetUid = typeof data.uid === 'string' ? data.uid.trim() : '';
  if (!actorUid || !targetUid) return { success: false, message: 'بيانات المشرف غير صالحة.' };
  if (targetUid === actorUid) return { success: false, message: 'لا يمكنك حذف حسابك الحالي.' };
  const target = db.doc(`platformUsers/${targetUid}`);
  const current = await target.get();
  if (!current.exists) return { success: false, message: 'حساب المشرف غير موجود.' };
  if (isProtectedPlatformAdmin(current.data())) return { success: false, message: 'هذا الحساب محمي ولا يمكن حذفه.' };
  if (current.data()?.role === 'platform_owner' && current.data()?.status === 'active') {
    const owners = await db.collection('platformUsers').where('role', '==', 'platform_owner').where('status', '==', 'active').get();
    if (owners.size <= 1) return { success: false, message: 'لا يمكن حذف آخر صاحب منصة نشط.' };
  }
  await auth.deleteUser(targetUid);
  const timestamp = FieldValue.serverTimestamp();
  await target.delete();
  await db.collection('platformAuditLogs').add({ action: 'platform_admin_deleted', targetUid, createdBy: actorUid, timestamp });
  return { success: true, message: 'تم حذف حساب المشرف.' };
});

export const createAdditionalCompanyOwner = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: { auth?: { uid: string; token: Record<string, unknown> }; data: unknown }): Promise<CreateAdditionalCompanyOwnerResponse> => {
  const actorUid = request.auth?.uid;
  if (!actorUid || request.auth?.token.platform_owner !== true) return { success: false, code: 'UNAUTHORIZED', message: 'غير مصرح بهذه العملية.' };
  const platformUser = await db.doc(`platformUsers/${actorUid}`).get();
  if (!platformUser.exists || platformUser.data()?.role !== 'platform_owner' || platformUser.data()?.status !== 'active') return { success: false, code: 'UNAUTHORIZED', message: 'غير مصرح بهذه العملية.' };
  const data = (request.data || {}) as Partial<CreateAdditionalCompanyOwnerRequest>;
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const temporaryPassword = typeof data.temporaryPassword === 'string' ? data.temporaryPassword : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(companyId) || name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || temporaryPassword.length < 12 || temporaryPassword.length > 128) return { success: false, code: 'INVALID_INPUT', message: 'بيانات الشريك غير صالحة.' };
  const companyRef = db.doc(`companies/${companyId}`);
  const company = await companyRef.get();
  if (!company.exists) return { success: false, code: 'COMPANY_NOT_FOUND', message: 'الشركة غير موجودة.' };
  if (company.data()?.maxUsers !== null && Number(company.data()?.memberCount || 0) >= Number(company.data()?.maxUsers || 0)) return { success: false, code: 'MAX_USERS_REACHED', message: 'تم الوصول للحد الأقصى لمستخدمي الشركة.' };
  try {
    await auth.getUserByEmail(email);
    return { success: false, code: 'EMAIL_EXISTS', message: 'البريد الإلكتروني مستخدم بالفعل.' };
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') return { success: false, code: 'UNKNOWN_ERROR', message: 'تعذر التحقق من البريد الإلكتروني.' };
  }
  let newUid = '';
  try {
    const user = await auth.createUser({ displayName: name, email, password: temporaryPassword, emailVerified: false });
    newUid = user.uid;
    await auth.setCustomUserClaims(newUid, { companyId, role: 'company_super_admin' });
    await db.runTransaction(async tx => {
      const freshCompany = await tx.get(companyRef);
      if (!freshCompany.exists) throw new Error('COMPANY_NOT_FOUND');
      if (freshCompany.data()?.maxUsers !== null && Number(freshCompany.data()?.memberCount || 0) >= Number(freshCompany.data()?.maxUsers || 0)) throw new Error('MAX_USERS_REACHED');
      const timestamp = FieldValue.serverTimestamp();
      tx.create(companyRef.collection('members').doc(newUid), { uid: newUid, companyId, companyCode: freshCompany.data()?.companyCode || null, name, email, role: 'company_super_admin', status: 'active', createdAt: timestamp, updatedAt: timestamp, createdBy: actorUid });
      tx.update(companyRef, { memberCount: FieldValue.increment(1), activeMemberCount: FieldValue.increment(1), updatedAt: timestamp });
      tx.create(companyRef.collection('activityLogs').doc(), { companyId, action: 'additional_company_owner_created', actorUid, targetUid: newUid, createdAt: timestamp });
    });
    return { success: true, code: 'OK', message: 'تم إنشاء حساب شريك بصلاحية صاحب المشروع.' };
  } catch (error) {
    if (newUid) await auth.deleteUser(newUid).catch(rollbackError => logger.error('Additional owner rollback failed', { reason: rollbackError instanceof Error ? rollbackError.message : 'unknown' }));
    const reason = error instanceof Error ? error.message : '';
    return { success: false, code: reason === 'COMPANY_NOT_FOUND' ? 'COMPANY_NOT_FOUND' : reason === 'MAX_USERS_REACHED' ? 'MAX_USERS_REACHED' : 'UNKNOWN_ERROR', message: reason === 'COMPANY_NOT_FOUND' ? 'الشركة غير موجودة.' : reason === 'MAX_USERS_REACHED' ? 'تم الوصول للحد الأقصى لمستخدمي الشركة.' : 'تعذر إنشاء حساب الشريك.' };
  }
});

const memberService = new CompanyMemberService({ db, auth, emulator: process.env.FUNCTIONS_EMULATOR === 'true' });
// These callables are invoked by the current Render frontend, which does not
// provide App Check yet. Transport is public for CORS; every operation still
// enforces Firebase Auth, active tenant membership, role checks, and rate limits.
const memberFunctionOptions = { region: 'us-central1' as const, enforceAppCheck: false, invoker: 'public' as const };
type MemberRequest = { auth?: { uid: string; token?: Record<string, unknown> }; data: unknown };
// Render does not currently provide an App Check token. Firebase Auth plus
// the active tenant membership and role checks remain mandatory in the service.
export const createCompanyMember = onCall({ ...memberFunctionOptions, enforceAppCheck: false }, (request: MemberRequest): Promise<CreateCompanyMemberResponse> => memberService.create(request.data as CreateCompanyMemberRequest, request.auth));
export const updateCompanyMember = onCall(memberFunctionOptions, (request: MemberRequest): Promise<UpdateCompanyMemberResponse> => memberService.update(request.data as UpdateCompanyMemberRequest, request.auth));
export const changeCompanyMemberRole = onCall(memberFunctionOptions, (request: MemberRequest): Promise<ChangeCompanyMemberRoleResponse> => memberService.changeRole(request.data as ChangeCompanyMemberRoleRequest, request.auth));
export const disableCompanyMember = onCall(memberFunctionOptions, (request: MemberRequest): Promise<DisableCompanyMemberResponse> => memberService.disable(request.data as DisableCompanyMemberRequest, request.auth));
export const reactivateCompanyMember = onCall(memberFunctionOptions, (request: MemberRequest): Promise<ReactivateCompanyMemberResponse> => memberService.reactivate(request.data as ReactivateCompanyMemberRequest, request.auth));
export const sendCompanyMemberPasswordReset = onCall(memberFunctionOptions, (request: MemberRequest): Promise<SendCompanyMemberPasswordResetResponse> => memberService.passwordReset(request.data as SendCompanyMemberPasswordResetRequest, request.auth));
export const resetWorkerLoginCode = onCall(memberFunctionOptions, (request: MemberRequest): Promise<ResetWorkerLoginCodeResponse> => memberService.resetWorkerCode(request.data as ResetWorkerLoginCodeRequest, request.auth));
export const deleteCompanyMember = onCall(memberFunctionOptions, (request: MemberRequest): Promise<DeleteCompanyMemberResponse> => memberService.deleteMember(request.data as DeleteCompanyMemberRequest, request.auth));
// Render does not currently provide an App Check token. The service still
// requires Firebase Auth, an active membership, and a permitted manager role.
export const deleteWorker = onCall({ ...memberFunctionOptions, enforceAppCheck: false }, (request: MemberRequest): Promise<DeleteWorkerResponse> => memberService.deleteWorker(request.data as DeleteWorkerRequest, request.auth));
export const updateOwnCompanyProfile = onCall({ ...memberFunctionOptions, enforceAppCheck: false }, (request: MemberRequest): Promise<UpdateOwnCompanyProfileResponse> => memberService.updateOwnProfile(request.data as UpdateOwnCompanyProfileRequest, request.auth));
export const updateWorker = onCall(memberFunctionOptions, (request: MemberRequest): Promise<UpdateWorkerResponse> => memberService.updateWorker(request.data as UpdateWorkerRequest, request.auth));
export const setWorkerStatus = onCall(memberFunctionOptions, (request: MemberRequest): Promise<SetWorkerStatusResponse> => memberService.setWorkerStatus(request.data as SetWorkerStatusRequest, request.auth));
export const recordOrderActivity = onCall(memberFunctionOptions, (request: MemberRequest): Promise<RecordOrderActivityResponse> => memberService.recordOrderActivity(request.data as RecordOrderActivityRequest, request.auth));
export const recordWorkerMovement = onCall(memberFunctionOptions, (request: MemberRequest): Promise<RecordWorkerMovementResponse> => memberService.recordWorkerMovement(request.data as RecordWorkerMovementRequest, request.auth));
export const updateWorkerOrderStatus = onCall(memberFunctionOptions, (request: MemberRequest): Promise<UpdateWorkerOrderStatusResponse> => memberService.updateWorkerOrderStatus(request.data as UpdateWorkerOrderStatusRequest, request.auth));
export const markCompanyNotificationsRead = onCall(memberFunctionOptions, (request: MemberRequest): Promise<MarkCompanyNotificationsReadResponse> => memberService.markNotificationsRead(request.data as MarkCompanyNotificationsReadRequest, request.auth));

/** Stores a browser's FCM registration token privately under its authenticated worker account. */
export const registerWorkerPushDevice = onCall(memberFunctionOptions, async (request: MemberRequest) => {
  const input = (request.data || {}) as { companyId?: unknown; workerId?: unknown; deviceId?: unknown; token?: unknown };
  const companyId = typeof input.companyId === 'string' ? input.companyId.trim() : '';
  const workerId = typeof input.workerId === 'string' ? input.workerId.trim() : '';
  const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (!request.auth) return { success: false, code: 'UNAUTHORIZED', message: 'سجّل الدخول أولًا.' };
  if (!companyId || !workerId || !/^[A-Za-z0-9_-]{8,128}$/.test(deviceId) || token.length < 20 || token.length > 4096) return { success: false, code: 'INVALID_INPUT', message: 'بيانات جهاز الإشعارات غير صالحة.' };
  const memberRef = db.collection('companies').doc(companyId).collection('members').doc(request.auth.uid);
  const member = await memberRef.get();
  if (!member.exists || member.data()?.status !== 'active') return { success: false, code: 'MEMBER_DISABLED', message: 'الحساب غير نشط.' };
  if (member.data()?.role !== 'worker' || member.data()?.workerId !== workerId) return { success: false, code: 'FORBIDDEN', message: 'لا يمكن تسجيل إشعارات هذا الجهاز لحساب آخر.' };
  await memberRef.collection('pushDevices').doc(deviceId).set({ token, workerId, companyId, updatedAt: new Date().toISOString() }, { merge: true });
  return { success: true, code: 'OK', message: 'تم تفعيل إشعارات الجهاز.' };
});

/** Registers or removes the current member's browser only. This is shared by
 * owners, managers, employees, and workers; no account can change another
 * person's notification setting. */
export const setPushDevice = onCall(memberFunctionOptions, async (request: MemberRequest) => {
  const input = (request.data || {}) as { companyId?: unknown; deviceId?: unknown; token?: unknown; enabled?: unknown };
  const companyId = typeof input.companyId === 'string' ? input.companyId.trim() : '';
  const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
  const enabled = input.enabled === true;
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (!request.auth) return { success: false, code: 'UNAUTHORIZED', message: 'سجّل الدخول أولًا.' };
  if (!companyId || !/^[A-Za-z0-9_-]{8,128}$/.test(deviceId) || (enabled && (token.length < 20 || token.length > 4096))) return { success: false, code: 'INVALID_INPUT', message: 'بيانات جهاز الإشعارات غير صالحة.' };
  const memberRef = db.collection('companies').doc(companyId).collection('members').doc(request.auth.uid);
  const member = await memberRef.get();
  if (!member.exists || member.data()?.status !== 'active') return { success: false, code: 'MEMBER_DISABLED', message: 'الحساب غير نشط.' };
  const deviceRef = memberRef.collection('pushDevices').doc(deviceId);
  if (!enabled) {
    await deviceRef.delete();
    return { success: true, code: 'OK', message: 'تم إيقاف إشعارات هذا الجهاز.' };
  }
  await deviceRef.set({ token, companyId, uid: request.auth.uid, updatedAt: new Date().toISOString() }, { merge: true });
  return { success: true, code: 'OK', message: 'تم تفعيل إشعارات الجهاز.' };
});
