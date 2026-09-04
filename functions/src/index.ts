import * as crypto from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentWritten, onDocumentWrittenWithAuthContext } from 'firebase-functions/v2/firestore';
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
const supportTicketStatusLabel: Record<string, string> = { open: 'جديد', in_progress: 'قيد المتابعة', resolved: 'تم الحل' };
const platformActorIdentity = async (uid: string) => {
  const profile = await db.doc(`platformUsers/${uid}`).get();
  return { name: String(profile.data()?.name || profile.data()?.email || 'حساب دعم المنصة'), email: String(profile.data()?.email || '') };
};
type PlatformCapability = 'platform:companies:read' | 'platform:companies:create' | 'platform:companies:update' | 'platform:users:manage' | 'platform:subscriptions:read' | 'platform:subscriptions:manage' | 'platform:plans:read' | 'platform:plans:manage' | 'platform:console:read' | 'platform:notifications:manage' | 'platform:support:manage' | 'platform:support:impersonate' | 'platform:settings:manage' | 'platform:admins:manage';
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
  platform_owner: ['platform:companies:read', 'platform:companies:create', 'platform:companies:update', 'platform:users:manage', 'platform:subscriptions:read', 'platform:subscriptions:manage', 'platform:plans:read', 'platform:plans:manage', 'platform:console:read', 'platform:notifications:manage', 'platform:support:manage', 'platform:settings:manage', 'platform:admins:manage'],
  platform_admin: ['platform:companies:read', 'platform:companies:update', 'platform:users:manage', 'platform:console:read', 'platform:notifications:manage', 'platform:support:manage'],
  platform_support: ['platform:companies:read', 'platform:console:read', 'platform:support:manage'],
  platform_billing: ['platform:companies:read', 'platform:subscriptions:read', 'platform:subscriptions:manage', 'platform:plans:read'],
  platform_read_only: ['platform:companies:read'],
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

// Support impersonation is deliberately server-owned.  The browser never gets
// a reusable company password, and its temporary tenant token is constrained
// by a session record that Firestore Rules check on every request.
const supportSessionDurationMs = 5 * 60 * 1000;
const normalizePhone = (value: unknown) => String(value || '').replace(/\D/g, '');
const supportCodeHash = (sessionId: string, code: string) => crypto.createHash('sha256').update(`${sessionId}:${code}`).digest('hex');
const supportAudit = async (sessionId: string, input: Record<string, unknown>) => {
  await db.collection(`supportImpersonationSessions/${sessionId}/auditLogs`).add({ ...input, createdAt: FieldValue.serverTimestamp() });
};

/** A second confirmation before a platform user can open a company's private details. */
export const verifyPlatformCompanyDetailsPhone = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const platformUid = await isActivePlatformUserFor(request, 'platform:companies:read');
  const data = (request.data || {}) as Record<string, unknown>;
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const ownerPhone = normalizePhone(data.ownerPhone);
  if (!platformUid || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId)) return { success: false, message: 'غير مصرح لك بعرض تفاصيل الشركة.' };
  if (ownerPhone.length < 8) return { success: false, message: 'أدخل رقم موبايل صاحب الشركة المسجل.' };
  const owners = await db.collection(`companies/${companyId}/members`).where('role', '==', 'company_super_admin').where('status', '==', 'active').get();
  const matched = owners.docs.some(owner => normalizePhone(owner.data()?.phone) === ownerPhone);
  if (!matched) return { success: false, message: 'رقم الموبايل لا يطابق رقم صاحب الشركة المسجل.' };
  await db.collection('platformAuditLogs').add({ action: 'company_details_phone_verified', companyId, actorUid: platformUid, timestamp: FieldValue.serverTimestamp() });
  return { success: true, message: 'تم تأكيد رقم صاحب الشركة.' };
});

/** Platform-owner-only reader for the append-only support-session evidence. */
export const listSupportImpersonationAuditLogs = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  if (!await isActivePlatformOwner(request)) return { success: false, message: 'غير مصرح لك بعرض سجلات جلسات الدعم.' };
  const asIso = (value: unknown) => value && typeof (value as { toDate?: unknown }).toDate === 'function'
    ? ((value as { toDate: () => Date }).toDate().toISOString())
    : null;
  const sessions = await db.collection('supportImpersonationSessions').orderBy('requestedAt', 'desc').limit(50).get();
  const items = await Promise.all(sessions.docs.map(async session => {
    const value = session.data() || {};
    const audit = await session.ref.collection('auditLogs').orderBy('createdAt', 'asc').limit(500).get();
    return {
      id: session.id,
      companyId: String(value.companyId || ''),
      companyName: String(value.companyName || ''),
      status: String(value.status || 'unknown'),
      platformActorName: String(value.platformActorName || ''),
      platformActorEmail: String(value.platformActorEmail || ''),
      recipientName: String(value.recipientName || ''),
      recipientEmail: String(value.recipientEmail || ''),
      recipientPhone: String(value.recipientPhone || ''),
      requestedAt: asIso(value.requestedAt),
      activatedAt: asIso(value.activatedAt),
      endedAt: asIso(value.endedAt),
      expiresAtMs: Number(value.expiresAtMs || 0),
      auditLogs: audit.docs.map(row => {
        const item = row.data() || {};
        return {
          id: row.id,
          action: String(item.action || ''),
          actorUid: String(item.actorUid || ''),
          detail: typeof item.detail === 'string' ? item.detail : '',
          companyId: typeof item.companyId === 'string' ? item.companyId : '',
          collection: typeof item.collection === 'string' ? item.collection : '',
          documentId: typeof item.documentId === 'string' ? item.documentId : '',
          operation: typeof item.operation === 'string' ? item.operation : '',
          changedFields: Array.isArray(item.changedFields) ? item.changedFields.filter(field => typeof field === 'string').slice(0, 100) : [],
          entityLabel: typeof item.entityLabel === 'string' ? item.entityLabel : '',
          changes: Array.isArray(item.changes) ? item.changes.filter(change => change && typeof change === 'object').slice(0, 30) : [],
          createdAt: asIso(item.createdAt),
        };
      }),
    };
  }));
  return { success: true, sessions: items };
});

const supportSectionLabels: Record<string, string> = {
  dashboard: 'لوحة التحكم', calculator: 'الحاسبات', calculatorSettings: 'إعدادات الحاسبات', orders: 'الطلبات', workers: 'الموظفون', workerPerformance: 'أداء الموظفين', workerMovements: 'حركة الموظفين', customers: 'العملاء', suppliers: 'الموردون', inventory: 'المخزون', expenses: 'المصروفات', calendar: 'التقويم', reports: 'التقارير', activityLog: 'سجل النشاط', settings: 'الإعدادات', members: 'حسابات الشركة', profile: 'الملف الشخصي', recycleBin: 'سلة المحذوفات',
};

/** Records only meaningful navigation inside an already authorized support session. */
export const recordSupportImpersonationActivity = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async request => {
  const sessionId = typeof request.auth?.token.supportSessionId === 'string' ? request.auth.token.supportSessionId : '';
  const companyId = typeof request.auth?.token.companyId === 'string' ? request.auth.token.companyId : '';
  const input = (request.data as Record<string, unknown> | undefined) || {};
  const section = typeof input.section === 'string' ? input.section : '';
  const event = input.event === 'order_opened' ? 'order_opened' : '';
  const orderNumber = typeof input.orderNumber === 'string' ? input.orderNumber.slice(0, 100) : '';
  const customerName = typeof input.customerName === 'string' ? input.customerName.slice(0, 120) : '';
  const label = supportSectionLabels[section];
  if (!sessionId || !companyId || (!label && !(event === 'order_opened' && orderNumber)) || !request.auth?.uid) return { success: false, message: 'نشاط جلسة الدعم غير صالح.' };
  const [pointer, session] = await Promise.all([
    db.doc(`supportImpersonationActive/${request.auth.uid}`).get(),
    db.doc(`supportImpersonationSessions/${sessionId}`).get(),
  ]);
  if (!pointer.exists || pointer.data()?.sessionId !== sessionId || pointer.data()?.companyId !== companyId || Number(pointer.data()?.expiresAtMs || 0) <= Date.now() || !session.exists || session.data()?.status !== 'active') return { success: false, message: 'انتهت جلسة الدعم.' };
  await supportAudit(sessionId, event === 'order_opened'
    ? { action: 'order_opened', actorUid: request.auth.uid, companyId, entityLabel: `الطلب ${orderNumber}${customerName ? ` — ${customerName}` : ''}`, detail: `فتح تفاصيل الطلب ${orderNumber}${customerName ? ` — ${customerName}` : ''}.` }
    : { action: 'page_opened', actorUid: request.auth.uid, companyId, section, detail: `فتح قسم ${label}.` });
  return { success: true };
});

export const getCompanySupportApprovalRecipients = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request) => {
  const companyId = typeof request.auth?.token.companyId === 'string' ? request.auth.token.companyId : '';
  if (!request.auth?.uid || !companyId || request.auth.token.role !== 'company_super_admin') return { success: false, message: 'غير مصرح لك بإدارة موافقات الدعم.' };
  const members = await db.collection(`companies/${companyId}/members`).where('status', '==', 'active').get();
  const configured = await db.doc(`companies/${companyId}/settings/supportAccess`).get();
  const configuredUids: string[] = Array.isArray(configured.data()?.recipientUids) ? (configured.data()!.recipientUids as unknown[]).filter((uid: unknown): uid is string => typeof uid === 'string') : [];
  const fallback = members.docs.filter(item => item.data().role === 'company_super_admin').map(item => item.id);
  const allowed = configuredUids.length ? configuredUids : fallback;
  return { success: true, recipientUids: allowed, members: members.docs.filter(item => item.data().role !== 'worker').map(item => ({ uid: item.id, name: String(item.data().name || ''), email: String(item.data().email || ''), role: String(item.data().role || ''), phone: String(item.data().phone || ''), selected: allowed.includes(item.id) })) };
});

export const updateCompanySupportApprovalRecipients = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request) => {
  const companyId = typeof request.auth?.token.companyId === 'string' ? request.auth.token.companyId : '';
  const recipientUids = Array.isArray((request.data as Record<string, unknown> | undefined)?.recipientUids) ? (request.data as { recipientUids: unknown[] }).recipientUids.filter((uid): uid is string => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid)) : [];
  if (!request.auth?.uid || !companyId || request.auth.token.role !== 'company_super_admin') return { success: false, message: 'غير مصرح لك بإدارة موافقات الدعم.' };
  if (!recipientUids.length) return { success: false, message: 'اختر حسابًا واحدًا على الأقل لاستلام كود موافقة الدعم.' };
  const refs = recipientUids.map(uid => db.doc(`companies/${companyId}/members/${uid}`));
  const snapshots = await db.getAll(...refs);
  if (snapshots.some(item => !item.exists || item.data()?.status !== 'active' || item.data()?.role === 'worker')) return { success: false, message: 'توجد حسابات غير صالحة ضمن المستلمين.' };
  await db.doc(`companies/${companyId}/settings/supportAccess`).set({ companyId, recipientUids: [...new Set(recipientUids)], updatedAt: FieldValue.serverTimestamp(), updatedBy: request.auth.uid }, { merge: true });
  return { success: true, message: 'تم حفظ مستلمي كود موافقة الدعم.' };
});

export const startSupportImpersonationRequest = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const platformUid = await isActivePlatformUserFor(request, 'platform:support:impersonate');
  const data = (request.data || {}) as Record<string, unknown>;
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const recipientPhone = normalizePhone(data.recipientPhone);
  if (!platformUid || !companyId || recipientPhone.length < 8) return { success: false, message: 'اختر الشركة وأدخل رقم الحساب المصرح له باستلام كود الدعم.' };
  const activePointer = await db.doc(`supportImpersonationActive/${platformUid}`).get();
  if (activePointer.exists && Number(activePointer.data()?.expiresAtMs || 0) > Date.now()) return { success: false, message: 'لديك جلسة دعم فعّالة بالفعل؛ أنهِها أولًا.' };
  const company = await db.doc(`companies/${companyId}`).get();
  if (!company.exists) return { success: false, message: 'الشركة غير موجودة.' };
  const platformActor = await db.doc(`platformUsers/${platformUid}`).get();
  const owners = await db.collection(`companies/${companyId}/members`).where('role', '==', 'company_super_admin').where('status', '==', 'active').get();
  if (!owners.docs.length) return { success: false, message: 'لا يوجد حساب صاحب شركة نشط لاستلام موافقة الدعم.' };
  const activeMembers = await db.collection(`companies/${companyId}/members`).where('status', '==', 'active').get();
  const recipient = activeMembers.docs.find(member => normalizePhone(member.data().phone) === recipientPhone);
  if (!recipient || recipient.data()?.role === 'worker') return { success: false, message: 'هذا الرقم غير مصرح له باستلام كود موافقة الدعم.' };
  const recipientConfig = await db.doc(`companies/${companyId}/settings/supportAccess`).get();
  const configured: string[] = Array.isArray(recipientConfig.data()?.recipientUids) ? (recipientConfig.data()!.recipientUids as unknown[]).filter((uid: unknown): uid is string => typeof uid === 'string') : [];
  const recipientIsOwner = recipient.data()?.role === 'company_super_admin';
  // Owner accounts are always allowed. Any other account must be explicitly
  // selected by the company owner in the support-approval recipients setting.
  if (!recipientIsOwner && !configured.includes(recipient.id)) return { success: false, message: 'هذا الرقم غير مصرح له باستلام كود موافقة الدعم.' };
  // The entered, authorized account receives the code, and the company owner
  // is informed as well. A Set prevents duplicate notifications if that
  // account is itself the owner.
  const notificationRecipients = [...new Set([recipient.id, ...owners.docs.map(owner => owner.id)])];
  const sessionRef = db.collection('supportImpersonationSessions').doc();
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAtMs = Date.now() + supportSessionDurationMs;
  await sessionRef.create({ platformUid, platformActorName: String(platformActor.data()?.name || ''), platformActorEmail: String(platformActor.data()?.email || ''), companyId, companyName: String(company.data()?.name || ''), recipientPhone, recipientUid: recipient.id, recipientName: String(recipient.data()?.name || ''), recipientEmail: String(recipient.data()?.email || ''), recipientUids: notificationRecipients, codeHash: supportCodeHash(sessionRef.id, code), attempts: 0, status: 'pending', expiresAtMs, requestedAt: FieldValue.serverTimestamp() });
  const batch = db.batch();
  notificationRecipients.forEach(uid => batch.set(db.collection(`companies/${companyId}/notifications`).doc(), { companyId, targetUid: uid, type: 'support_impersonation_request', title: 'موافقة دخول الدعم الفني', body: `كود موافقة دخول الدعم: ${code}. صالح لمدة 5 دقائق فقط.`, status: 'unread', createdAt: FieldValue.serverTimestamp() }));
  await batch.commit();
  await supportAudit(sessionRef.id, { action: 'support_session_requested', actorUid: platformUid, detail: 'تم إرسال كود الموافقة إلى الحساب المصرح له وحساب صاحب الشركة.' });
  return { success: true, sessionId: sessionRef.id, expiresAtMs, message: 'تم إرسال كود الموافقة إلى الحساب المصرح له وحساب صاحب الشركة.' };
});

export const verifySupportImpersonationCode = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const platformUid = await isActivePlatformUserFor(request, 'platform:support:impersonate');
  const data = (request.data || {}) as Record<string, unknown>;
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
  const code = typeof data.code === 'string' ? data.code.trim() : '';
  if (!platformUid || !sessionId || !/^\d{6}$/.test(code)) return { success: false, message: 'بيانات التحقق غير صحيحة.' };
  const sessionRef = db.doc(`supportImpersonationSessions/${sessionId}`);
  const result = await db.runTransaction(async tx => {
    const session = await tx.get(sessionRef);
    if (!session.exists || session.data()?.platformUid !== platformUid) throw new Error('INVALID_SESSION');
    const value = session.data() || {};
    if (Number(value.expiresAtMs || 0) <= Date.now()) { tx.update(sessionRef, { status: 'expired', expiredAt: FieldValue.serverTimestamp() }); throw new Error('EXPIRED'); }
    // A browser can finish the server verification just before its Auth state
    // listener updates. Retrying the same approved code must resume that very
    // session rather than leaving the support agent locked outside it.
    if (value.status === 'active') {
      if (supportCodeHash(sessionId, code) !== value.codeHash) throw new Error('INVALID_CODE');
      return { companyId: String(value.companyId), expiresAtMs: Number(value.expiresAtMs), companyName: String(value.companyName || ''), resumed: true };
    }
    if (value.status !== 'pending') throw new Error('INVALID_SESSION');
    const attempts = Number(value.attempts || 0) + 1;
    if (attempts > 5) { tx.update(sessionRef, { status: 'blocked', attempts, blockedAt: FieldValue.serverTimestamp() }); throw new Error('BLOCKED'); }
    if (supportCodeHash(sessionId, code) !== value.codeHash) { tx.update(sessionRef, { attempts }); throw new Error('INVALID_CODE'); }
    const companyId = String(value.companyId);
    const companyMemberRef = db.doc(`companies/${companyId}/members/${platformUid}`);
    const member = await tx.get(companyMemberRef);
    if (member.exists && member.data()?.supportSession !== true) throw new Error('MEMBERSHIP_CONFLICT');
    tx.set(companyMemberRef, { uid: platformUid, companyId, name: 'دعم المنصة (جلسة مؤقتة)', email: '', role: 'company_super_admin', status: 'active', supportSession: true, supportSessionId: sessionId, createdAt: FieldValue.serverTimestamp(), createdBy: platformUid }, { merge: true });
    tx.set(db.doc(`supportImpersonationActive/${platformUid}`), { sessionId, companyId, expiresAtMs: Number(value.expiresAtMs), updatedAt: FieldValue.serverTimestamp() });
    tx.update(sessionRef, { status: 'active', attempts, activatedAt: FieldValue.serverTimestamp() });
    return { companyId, expiresAtMs: Number(value.expiresAtMs), companyName: String(value.companyName || '') };
  }).catch(error => ({ error: error instanceof Error ? error.message : 'INVALID_SESSION' }));
  if ('error' in result) {
    const messages: Record<string, string> = { EXPIRED: 'انتهت صلاحية الكود. اطلب كودًا جديدًا.', BLOCKED: 'تم إيقاف الطلب لكثرة المحاولات.', INVALID_CODE: 'كود الموافقة غير صحيح.', MEMBERSHIP_CONFLICT: 'تعذر بدء الجلسة بسبب تعارض حسابي.' };
    return { success: false, message: messages[result.error] || 'تعذر التحقق من جلسة الدعم.' };
  }
  await supportAudit(sessionId, { action: 'support_session_started', actorUid: platformUid, detail: 'تم التحقق من كود الموافقة وبدء جلسة دعم قابلة للتعديل.' });
  const customToken = await auth.createCustomToken(platformUid, { companyId: result.companyId, role: 'company_super_admin', supportSessionId: sessionId, supportSessionExpiresAt: result.expiresAtMs });
  return { success: true, customToken, expiresAtMs: result.expiresAtMs, companyName: result.companyName };
});

export const endSupportImpersonationSession = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request) => {
  const sessionId = typeof request.auth?.token.supportSessionId === 'string' ? request.auth.token.supportSessionId : '';
  const platformUid = request.auth?.uid || '';
  if (!sessionId || !platformUid) return { success: false, message: 'جلسة الدعم غير صالحة.' };
  const sessionRef = db.doc(`supportImpersonationSessions/${sessionId}`);
  const session = await sessionRef.get();
  if (!session.exists || session.data()?.platformUid !== platformUid) return { success: false, message: 'جلسة الدعم غير صالحة.' };
  const companyId = String(session.data()?.companyId || '');
  const profile = await db.doc(`platformUsers/${platformUid}`).get();
  const role = String(profile.data()?.role || '');
  if (!profile.exists || profile.data()?.status !== 'active' || !platformRolePermissionDefaults[role]) return { success: false, message: 'تعذر استعادة حساب المنصة.' };
  const memberRef = db.doc(`companies/${companyId}/members/${platformUid}`);
  const member = await memberRef.get();
  if (member.exists && member.data()?.supportSession === true && member.data()?.supportSessionId === sessionId) await memberRef.delete();
  await Promise.all([db.doc(`supportImpersonationActive/${platformUid}`).delete().catch(() => undefined), sessionRef.set({ status: 'ended', endedAt: FieldValue.serverTimestamp() }, { merge: true })]);
  await supportAudit(sessionId, { action: 'support_session_ended', actorUid: platformUid, detail: 'تم إنهاء جلسة الدعم واستعادة حساب المنصة.' });
  const customToken = await auth.createCustomToken(platformUid, role === 'platform_owner' ? { platform_owner: true, platformRole: role } : { platformRole: role });
  return { success: true, customToken };
});

/** Recover a verified session when the browser failed to switch its Auth token. */
export const resolveStuckSupportImpersonationSession = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  try {
    const platformUid = await isActivePlatformUserFor(request, 'platform:support:impersonate');
    const data = (request.data || {}) as Record<string, unknown>;
    const action = data.action === 'end' ? 'end' : 'resume';
    if (!platformUid) return { success: false, message: 'غير مصرح لك بإدارة جلسة الدعم.' };
    const pointerRef = db.doc(`supportImpersonationActive/${platformUid}`);
    const pointer = await pointerRef.get();
    if (!pointer.exists) return { success: false, message: 'لا توجد جلسة دعم معلقة.' };
    const sessionId = String(pointer.data()?.sessionId || '');
    if (!sessionId) { await pointerRef.delete(); return { success: false, message: 'الجلسة لم تعد صالحة.' }; }
    const sessionRef = db.doc(`supportImpersonationSessions/${sessionId}`);
    const session = await sessionRef.get();
    const value = session.data() || {};
    if (!session.exists || value.platformUid !== platformUid) { await pointerRef.delete(); return { success: false, message: 'الجلسة لم تعد صالحة.' }; }
    const companyId = String(value.companyId || '');
    if (action === 'end') {
      const memberRef = db.doc(`companies/${companyId}/members/${platformUid}`); const member = await memberRef.get();
      if (member.exists && member.data()?.supportSession === true && member.data()?.supportSessionId === session.id) await memberRef.delete();
      await Promise.all([pointerRef.delete(), sessionRef.set({ status: 'ended', endedAt: FieldValue.serverTimestamp() }, { merge: true })]);
      await supportAudit(session.id, { action: 'support_session_cancelled', actorUid: platformUid, detail: 'تم إنهاء الجلسة المعلقة من شاشة الدعم.' });
      return { success: true, message: 'تم إنهاء جلسة الدعم.' };
    }
    const phone = normalizePhone(data.phone);
    if (!phone || phone !== String(value.recipientPhone || value.ownerPhone || '')) return { success: false, message: 'رقم الهاتف لا يطابق الرقم الذي بدأ به طلب الجلسة.' };
    if (value.status !== 'active' || Number(value.expiresAtMs || 0) <= Date.now()) return { success: false, message: 'انتهت الجلسة؛ أرسل كود موافقة جديدًا.' };
    const customToken = await auth.createCustomToken(platformUid, { companyId, role: 'company_super_admin', supportSessionId: session.id, supportSessionExpiresAt: Number(value.expiresAtMs) });
    await supportAudit(session.id, { action: 'support_session_resumed', actorUid: platformUid, detail: 'تمت استعادة الجلسة بعد إعادة مطابقة رقم الهاتف.' });
    return { success: true, customToken, expiresAtMs: Number(value.expiresAtMs) };
  } catch (error) {
    logger.error('Failed to resolve a stuck support impersonation session.', {
      uid: request.auth?.uid || null,
      message: error instanceof Error ? error.message : String(error),
    });
    return { success: false, message: 'تعذر إتمام جلسة الدعم الآن. أعد المحاولة بعد لحظات.' };
  }
});

// This trigger makes each direct Firestore edit made during a support session
// append-only. Clients have no Firestore permissions for these records.
export const auditSupportSessionOperationalWrite = onDocumentWrittenWithAuthContext({ document: 'companies/{companyId}/{collectionId}/{documentId}', region: 'us-central1' }, async event => {
  if (!event.authId || event.authType === 'service_account' || event.authType === 'system') return;
  const pointer = await db.doc(`supportImpersonationActive/${event.authId}`).get();
  const active = pointer.data();
  if (!pointer.exists || active?.companyId !== event.params.companyId || Number(active.expiresAtMs || 0) <= Date.now()) return;
  const sessionRef = db.doc(`supportImpersonationSessions/${String(active.sessionId)}`);
  const session = await sessionRef.get();
  if (!session.exists || session.data()?.status !== 'active') return;
  const before = event.data?.before.exists ? event.data.before.data() || {} : {};
  const after = event.data?.after.exists ? event.data.after.data() || {} : {};
  const operation = !event.data?.before.exists ? 'create' : !event.data?.after.exists ? 'delete' : 'update';
  const changedFields = [...new Set([...Object.keys(before), ...Object.keys(after)].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])))].slice(0, 100);
  const source = Object.keys(after).length ? after : before;
  const asAuditValue = (value: unknown): string => {
    if (value === undefined || value === null || value === '') return 'فارغ';
    if (typeof value === 'string') return value.length > 180 ? `${value.slice(0, 177)}…` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `${value.length} عنصر`;
    if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') return ((value as { toDate: () => Date }).toDate()).toLocaleString('ar-EG');
    return 'تم تحديث بيانات مركبة';
  };
  const entityLabel = event.params.collectionId === 'orders'
    ? `الطلب ${String(source.orderNumber || event.params.documentId)}${source.customerName ? ` — ${String(source.customerName)}` : ''}`
    : event.params.collectionId === 'customers'
      ? `العميل ${String(source.name || source.customerName || event.params.documentId)}`
      : event.params.collectionId === 'workers' || event.params.collectionId === 'members'
        ? `الحساب ${String(source.name || source.displayName || event.params.documentId)}`
        : `${event.params.collectionId}/${event.params.documentId}`;
  const changes = changedFields.filter(field => !['updatedAt', 'createdAt'].includes(field)).slice(0, 30).map(field => ({ field, before: asAuditValue(before[field]), after: asAuditValue(after[field]) }));
  await supportAudit(String(active.sessionId), { action: `firestore_${operation}`, actorUid: event.authId, companyId: event.params.companyId, collection: event.params.collectionId, documentId: event.params.documentId, entityLabel, changedFields, changes });
});

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

type PlatformOrderAnalyticsRecord = {
  id: string; month: string; orderNumber: string; customerName: string; customerPhone: string;
  bookingDate: string; eventDate: string; deliveryDate: string; returnDate: string; eventLocation: string;
  totalPrice: number; deposit: number; totalPaid: number; remainingBalance: number;
  workerCost: number; transportationCost: number; otherExpenses: number; orderStatus: string; notes: string;
};
const platformNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};
const platformDate = (value: unknown) => {
  const iso = timestampIso(value) || '';
  const match = iso.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
};
const platformOrderMonth = (data: Record<string, unknown>) => {
  const date = platformDate(data.eventDate) || platformDate(data.weddingDate) || platformDate(data.bookingDate) || platformDate(data.createdAt);
  return date.slice(0, 7);
};
const platformOrderRecord = (id: string, data: Record<string, unknown>): PlatformOrderAnalyticsRecord => {
  const totalPrice = platformNumber(data.totalPrice);
  const totalPaid = platformNumber(data.totalPaid);
  return {
    id,
    month: platformOrderMonth(data),
    orderNumber: String(data.orderNumber || id),
    customerName: String(data.customerName || 'بدون اسم'),
    customerPhone: String(data.customerPhone || ''),
    bookingDate: platformDate(data.bookingDate),
    eventDate: platformDate(data.eventDate) || platformDate(data.weddingDate),
    deliveryDate: platformDate(data.deliveryDate),
    returnDate: platformDate(data.returnDate),
    eventLocation: String(data.eventLocation || ''),
    totalPrice,
    deposit: platformNumber(data.deposit),
    totalPaid,
    remainingBalance: Math.max(0, totalPrice - totalPaid),
    workerCost: platformNumber(data.workerCost),
    transportationCost: platformNumber(data.transportationCost),
    otherExpenses: platformNumber(data.otherExpenses),
    orderStatus: String(data.orderStatus || 'new'),
    notes: String(data.notes || ''),
  };
};
type PlatformCashOrder = {
  id: string; orderNumber: string; customerName: string; orderStatus: string; totalPrice: number; deposit: number; totalPaid: number;
  bookingDate: string; eventDate: string; weddingDate: string; createdAt: string; workerCost: number; transportationCost: number; otherExpenses: number;
  paymentMethod: string; paymentHistory: Array<Record<string, unknown>>;
};
const platformCashOrder = (id: string, data: Record<string, unknown>): PlatformCashOrder => ({
  id, orderNumber: String(data.orderNumber || id), customerName: String(data.customerName || 'بدون اسم'), orderStatus: String(data.orderStatus || 'new'),
  totalPrice: platformNumber(data.totalPrice), deposit: platformNumber(data.deposit), totalPaid: platformNumber(data.totalPaid),
  bookingDate: platformDate(data.bookingDate), eventDate: platformDate(data.eventDate), weddingDate: platformDate(data.weddingDate), createdAt: platformDate(data.createdAt),
  workerCost: platformNumber(data.workerCost), transportationCost: platformNumber(data.transportationCost), otherExpenses: platformNumber(data.otherExpenses),
  paymentMethod: String(data.paymentMethod || 'other'), paymentHistory: Array.isArray(data.paymentHistory) ? data.paymentHistory.filter((payment): payment is Record<string, unknown> => Boolean(payment && typeof payment === 'object')) : [],
});
const platformMonthMatches = (value: string, month: string) => value.startsWith(`${month}-`);
const platformCashCollections = (order: PlatformCashOrder) => {
  const history = order.paymentHistory.filter(payment => platformNumber(payment.amount) > 0);
  const historyTotal = history.reduce((sum, payment) => sum + platformNumber(payment.amount), 0);
  const actualPaid = order.totalPaid > 0 ? order.totalPaid : Math.max(order.deposit, historyTotal);
  const fallbackDate = order.bookingDate || order.createdAt;
  const entries = history.map((payment, index) => {
    const amount = platformNumber(payment.amount);
    const date = platformDate(payment.date) || fallbackDate;
    const explicitType = payment.type === 'deposit' || payment.type === 'settlement' ? payment.type : '';
    const paymentType = explicitType || (index === 0 && (date === fallbackDate || amount <= order.deposit) ? 'deposit' : 'settlement');
    return { orderId: order.id, amount, date, paymentType, retained: order.orderStatus === 'cancelled_deposit_retained' };
  });
  if (actualPaid > historyTotal) entries.push({ orderId: order.id, amount: actualPaid - historyTotal, date: order.orderStatus === 'completed' ? (order.eventDate || order.weddingDate || fallbackDate) : fallbackDate, paymentType: history.length === 0 && order.deposit > 0 ? 'deposit' : 'settlement', retained: order.orderStatus === 'cancelled_deposit_retained' });
  return entries;
};
const platformMonthlyAccounts = (orders: PlatformCashOrder[], expenses: Array<Record<string, unknown>>, month: string) => {
  const monthEnd = `${month}-31`;
  const eventDate = (order: PlatformCashOrder) => order.eventDate || order.weddingDate;
  const completedInMonth = (order: PlatformCashOrder) => order.orderStatus === 'completed' && platformMonthMatches(eventDate(order), month);
  const upcoming = (order: PlatformCashOrder) => !['cancelled', 'cancelled_deposit_retained'].includes(order.orderStatus) && !completedInMonth(order);
  const allCollections = orders.filter(order => order.orderStatus !== 'cancelled').flatMap(platformCashCollections);
  const collections = allCollections.filter(collection => platformMonthMatches(collection.date, month));
  const sum = (items: Array<{ amount: number }>) => items.reduce((total, item) => total + item.amount, 0);
  const byId = new Map(orders.map(order => [order.id, order]));
  const collectedFromCompletedOrders = sum(collections.filter(collection => { const order = byId.get(collection.orderId); return Boolean(order && completedInMonth(order)); }));
  const retainedCancelledDeposits = sum(collections.filter(collection => collection.retained));
  const advancesFromUpcomingOrders = sum(collections.filter(collection => { const order = byId.get(collection.orderId); return Boolean(order && upcoming(order) && !collection.retained); }));
  const standardCollections = collections.filter(collection => !collection.retained);
  const totalDepositsPaid = sum(standardCollections.filter(collection => collection.paymentType === 'deposit')) + retainedCancelledDeposits;
  const totalSettlementPayments = sum(standardCollections.filter(collection => collection.paymentType === 'settlement'));
  const grossMonthlyIncome = totalDepositsPaid + totalSettlementPayments;
  const expectedSettlementPayments = orders.filter(order => !['cancelled', 'cancelled_deposit_retained'].includes(order.orderStatus) && platformMonthMatches(eventDate(order), month)).reduce((total, order) => total + Math.max(0, order.totalPrice - (order.totalPaid > 0 ? order.totalPaid : order.deposit)), 0);
  const upcomingOrderDeposits = sum(collections.filter(collection => { const order = byId.get(collection.orderId); return Boolean(order && upcoming(order) && !collection.retained && collection.paymentType === 'deposit'); }));
  const operatingExpenses = expenses.filter(expense => platformMonthMatches(platformDate(expense.date), month) && expense.type !== 'capital' && String(expense.category || '') !== 'رأس مال' && !expense.deletedAt).reduce((total, expense) => total + platformNumber(expense.amount), 0);
  const completedOrderCosts = orders.filter(completedInMonth).reduce((total, order) => total + order.workerCost + order.transportationCost + order.otherExpenses, 0);
  const upcomingOrderOtherExpenses = orders.filter(order => upcoming(order) && platformMonthMatches(eventDate(order), month)).reduce((total, order) => total + order.otherExpenses, 0);
  const completedOrdersNetProfit = collectedFromCompletedOrders - completedOrderCosts;
  const netMonthlyCash = completedOrdersNetProfit + advancesFromUpcomingOrders + retainedCancelledDeposits - upcomingOrderOtherExpenses;
  const executedOrdersNetProfit = orders.filter(order => !['cancelled', 'cancelled_deposit_retained'].includes(order.orderStatus) && platformMonthMatches(eventDate(order), month)).reduce((total, order) => total + order.totalPrice - order.otherExpenses - order.workerCost - order.transportationCost, 0);
  const futureExecutionBookingDeposits = orders.filter(order => !['cancelled', 'cancelled_deposit_retained'].includes(order.orderStatus) && platformMonthMatches(order.bookingDate || order.createdAt, month) && eventDate(order) > monthEnd).flatMap(platformCashCollections).filter(collection => platformMonthMatches(collection.date, month) && collection.paymentType === 'deposit').reduce((total, collection) => total + collection.amount, 0);
  return { month, netMonthlyCash, grossMonthlyIncome, completedOrdersNetProfit, retainedCancelledDeposits, upcomingOrderDepositsNet: upcomingOrderDeposits - upcomingOrderOtherExpenses, upcomingOrderOtherExpenses, netMonthlyOrderProfit: executedOrdersNetProfit + retainedCancelledDeposits + futureExecutionBookingDeposits, expectedSettlementPayments, operatingExpenses };
};

/** Owner-only directory of company owners; this cross-tenant contact data is never exposed through Firestore rules. */
export const getPlatformCompanyContacts = onCall({ region: 'us-central1', timeoutSeconds: 120, enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const actorUid = await isActivePlatformOwner(request);
  if (!actorUid) return { success: false, message: 'غير مصرح بعرض جهات التواصل.' };
  const companies = await db.collection('companies').get();
  const contacts = (await Promise.all(companies.docs.map(async company => {
    const data = company.data();
    const companyName = String(data.name || 'شركة بدون اسم');
    const owners = await company.ref.collection('members').where('role', '==', 'company_super_admin').get();
    if (owners.empty) return [{
      companyId: company.id, companyName, name: String(data.ownerName || 'غير مسجل'), email: String(data.ownerEmail || ''), phone: '', status: 'unknown',
    }];
    return owners.docs.map(owner => {
      const member = owner.data();
      return {
        companyId: company.id, companyName,
        name: String(member.name || data.ownerName || 'غير مسجل'),
        email: String(member.email || data.ownerEmail || ''),
        phone: String(member.phone || ''),
        status: String(member.status || 'unknown'),
      };
    });
  }))).flat().sort((a, b) => a.companyName.localeCompare(b.companyName, 'ar') || a.name.localeCompare(b.name, 'ar'));
  await db.collection('platformAuditLogs').add({ action: 'platform_company_contacts_viewed', createdBy: actorUid, timestamp: FieldValue.serverTimestamp() });
  return { success: true, message: 'تم تحميل جهات التواصل.', contacts };
});

/** Cross-company orders are deliberately exposed only to the platform owner. */
export const getPlatformCompanyOrderAnalytics = onCall({ region: 'us-central1', timeoutSeconds: 120, memory: '512MiB', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const actorUid = await isActivePlatformOwner(request);
  const companyId = typeof (request.data as Record<string, unknown> | undefined)?.companyId === 'string' ? String((request.data as Record<string, unknown>).companyId).trim() : '';
  if (!actorUid || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId)) return { success: false, message: 'غير مصرح بعرض تحليل طلبات الشركة.' };
  const companyRef = db.doc(`companies/${companyId}`);
  const [company, ordersSnapshot, expensesSnapshot] = await Promise.all([
    companyRef.get(),
    companyRef.collection('orders').get(),
    companyRef.collection('expenses').get(),
  ]);
  if (!company.exists) return { success: false, message: 'الشركة غير موجودة.' };
  const rawOrders = ordersSnapshot.docs.filter(order => !order.data()?.deletedAt).map(order => ({ id: order.id, data: order.data() }));
  const orders = rawOrders.map(order => platformOrderRecord(order.id, order.data));
  const cashOrders = rawOrders.map(order => platformCashOrder(order.id, order.data));
  const expenseRecords = expensesSnapshot.docs.map(expense => expense.data());
  const monthly = [...new Set(orders.map(order => order.month).filter(Boolean))]
    .map(month => ({ month, orderCount: orders.filter(order => order.month === month).length }))
    .sort((a, b) => b.month.localeCompare(a.month));
  const latest = monthly[0];
  const previous = monthly[1];
  const growthRate = latest && previous && previous.orderCount > 0 ? ((latest.orderCount - previous.orderCount) / previous.orderCount) * 100 : null;
  const monthlyAccounts = monthly.map(month => platformMonthlyAccounts(cashOrders, expenseRecords, month.month));
  await db.collection('platformAuditLogs').add({ action: 'platform_company_orders_analytics_viewed', companyId, createdBy: actorUid, timestamp: FieldValue.serverTimestamp() });
  return {
    success: true,
    message: 'تم تحميل تحليل الطلبات.',
    analytics: {
      totalOrders: orders.length,
      totalNetProfit: monthlyAccounts.reduce((sum, month) => sum + month.netMonthlyCash, 0),
      growthRate,
      growthMonth: latest?.month || null,
      months: monthly,
      monthlyAccounts,
      orders: orders.sort((a, b) => (b.eventDate || b.bookingDate).localeCompare(a.eventDate || a.bookingDate)),
    },
  };
});

/** The platform owner can correct an order without receiving general tenant write access. */
export const updatePlatformCompanyOrder = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request: PlatformOwnerRequest) => {
  const actorUid = await isActivePlatformOwner(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : '';
  const orderId = typeof data.orderId === 'string' ? data.orderId.trim() : '';
  const clean = (key: string, max = 1000) => typeof data[key] === 'string' ? data[key].trim().slice(0, max) : '';
  const date = (key: string, optional = true) => {
    const value = clean(key, 10);
    return (optional && !value) || /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  };
  const number = (key: string) => {
    const value = Number(data[key]);
    return Number.isFinite(value) && value >= 0 && value <= 1000000000 ? value : null;
  };
  const orderStatus = clean('orderStatus', 40);
  const statuses = new Set(['new', 'confirmed', 'preparing', 'out_for_delivery', 'completed', 'returned', 'cancelled', 'cancelled_deposit_retained', 'pending', 'in_progress']);
  const bookingDate = date('bookingDate'); const eventDate = date('eventDate', false); const deliveryDate = date('deliveryDate'); const returnDate = date('returnDate');
  const totalPrice = number('totalPrice'); const deposit = number('deposit'); const requestedPaid = number('totalPaid'); const workerCost = number('workerCost'); const transportationCost = number('transportationCost'); const otherExpenses = number('otherExpenses');
  if (!actorUid || !/^[A-Za-z0-9_-]{1,128}$/.test(companyId) || !/^[A-Za-z0-9_-]{1,128}$/.test(orderId) || !clean('orderNumber', 120) || !clean('customerName', 200) || !eventDate || !statuses.has(orderStatus) || [totalPrice, deposit, requestedPaid, workerCost, transportationCost, otherExpenses].some(value => value === null)) return { success: false, message: 'بيانات الأوردر غير صالحة.' };
  const orderRef = db.doc(`companies/${companyId}/orders/${orderId}`);
  const current = await orderRef.get();
  if (!current.exists || current.data()?.deletedAt) return { success: false, message: 'الأوردر غير موجود.' };
  const historyTotal = Array.isArray(current.data()?.paymentHistory) ? current.data()!.paymentHistory.reduce((sum: number, payment: unknown) => sum + platformNumber((payment as Record<string, unknown>)?.amount), 0) : 0;
  const totalPaid = Math.max(deposit!, requestedPaid!, historyTotal);
  const paymentStatus = totalPaid >= totalPrice! && totalPrice! > 0 ? 'fully_paid' : totalPaid > 0 ? 'partially_paid' : 'unpaid';
  await orderRef.update({
    orderNumber: clean('orderNumber', 120), customerName: clean('customerName', 200), customerPhone: clean('customerPhone', 60),
    bookingDate, eventDate, weddingDate: eventDate, deliveryDate, returnDate, eventLocation: clean('eventLocation', 500),
    totalPrice, deposit, totalPaid, remainingBalance: Math.max(0, totalPrice! - totalPaid), workerCost, transportationCost, otherExpenses,
    orderStatus, paymentStatus, notes: clean('notes', 4000), updatedAt: FieldValue.serverTimestamp(), updatedByPlatformOwner: actorUid,
  });
  await db.collection('platformAuditLogs').add({ action: 'platform_company_order_updated', companyId, orderId, createdBy: actorUid, timestamp: FieldValue.serverTimestamp() });
  return { success: true, message: 'تم تحديث الأوردر بنجاح.' };
});

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
  const supportTickets = (await Promise.all(ticketsSnapshot.docs.map(async ticket => {
    const data = ticket.data();
    const activitySnapshot = await ticket.ref.collection('activity').orderBy('createdAt', 'desc').limit(12).get();
    return {
      id: ticket.id,
      companyId: String(data.companyId || ''),
      companyName: String(data.companyName || 'شركة غير معرّفة'),
      subject: String(data.subject || 'طلب دعم'),
      status: ['open', 'in_progress', 'resolved'].includes(String(data.status)) ? String(data.status) : 'open',
      priority: ['low', 'normal', 'high', 'urgent'].includes(String(data.priority)) ? String(data.priority) : 'normal',
      assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : null,
      source: data.source === 'company_user' ? 'company_user' : 'platform_support',
      requesterName: typeof data.requesterName === 'string' ? data.requesterName : '',
      requesterEmail: typeof data.requesterEmail === 'string' ? data.requesterEmail : '',
      requesterRole: typeof data.requesterRole === 'string' ? data.requesterRole : '',
      lastAction: typeof data.lastAction === 'string' ? data.lastAction : '',
      lastActionByName: typeof data.lastActionByName === 'string' ? data.lastActionByName : '',
      lastActionByEmail: typeof data.lastActionByEmail === 'string' ? data.lastActionByEmail : '',
      lastActionAt: timestampIso(data.lastActionAt),
      activity: activitySnapshot.docs.map(activity => {
        const value = activity.data();
        return { id: activity.id, action: String(value.action || 'إجراء على طلب الدعم'), actorName: String(value.actorName || ''), actorEmail: String(value.actorEmail || ''), createdAt: timestampIso(value.createdAt) };
      }),
      commentCount: Math.max(0, Number(data.commentCount || 0)),
      createdAt: timestampIso(data.createdAt),
      updatedAt: timestampIso(data.updatedAt),
    };
  }))).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
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
  const actor = await platformActorIdentity(uid);
  const ticket = await db.collection('platformSupportTickets').add({ companyId, companyName: String(company.data()?.name || 'شركة'), subject, source: 'platform_support', status: 'open', priority: 'normal', commentCount: 0, lastAction: 'سجّل طلب الدعم', lastActionByName: actor.name, lastActionByEmail: actor.email, lastActionAt: timestamp, createdAt: timestamp, updatedAt: timestamp, createdBy: uid });
  await ticket.collection('activity').add({ action: 'سجّل طلب الدعم', actorUid: uid, actorName: actor.name, actorEmail: actor.email, createdAt: FieldValue.serverTimestamp() });
  await db.collection('platformAuditLogs').add({ action: 'platform_support_ticket_created', companyId, ticketId: ticket.id, createdBy: uid, timestamp });
  return { success: true, message: 'تم تسجيل طلب الدعم.' };
});

/** A company member can submit a ticket only from their own tenant and only
 * when the company owner granted the support-request permission. */
export const createCompanySupportTicket = onCall({ region: 'us-central1', enforceAppCheck: false, invoker: 'public' }, async (request) => {
  const uid = request.auth?.uid || '';
  const token = (request.auth?.token || {}) as Record<string, unknown>;
  const companyId = typeof token.companyId === 'string' ? token.companyId : '';
  const role = typeof token.role === 'string' ? token.role : '';
  const data = (request.data || {}) as Record<string, unknown>;
  const issue = typeof data.issue === 'string' ? data.issue.trim() : '';
  if (!uid || !companyId || !role || typeof token.supportSessionId === 'string') return { success: false, message: 'يجب تسجيل الدخول بحساب شركة نشط لإرسال طلب الدعم.' };
  if (issue.length < 5 || issue.length > 2000) return { success: false, message: 'اكتب وصفًا للمشكلة بين 5 و2000 حرف.' };

  const [company, member] = await Promise.all([
    db.doc(`companies/${companyId}`).get(),
    db.doc(`companies/${companyId}/members/${uid}`).get(),
  ]);
  if (!company.exists || company.data()?.status === 'archived') return { success: false, message: 'بيانات الشركة غير متاحة لإرسال الطلب.' };
  if (!member.exists || member.data()?.status !== 'active' || String(member.data()?.role || '') !== role) return { success: false, message: 'حسابك غير مصرح له بإرسال طلبات الدعم.' };

  const savedPermissions = Array.isArray(member.data()?.permissions)
    ? member.data()?.permissions.filter((value: unknown): value is string => typeof value === 'string')
    : null;
  const canRequestSupport = savedPermissions
    ? savedPermissions.includes('company:support:request')
    : ['company_super_admin', 'manager', 'employee', 'worker'].includes(role);
  if (!canRequestSupport) return { success: false, message: 'صاحب الشركة لم يمنح هذا الحساب صلاحية إرسال طلبات الدعم الفني.' };

  const timestamp = FieldValue.serverTimestamp();
  const ticket = await db.collection('platformSupportTickets').add({
    companyId,
    companyName: String(company.data()?.name || 'شركة'),
    subject: issue,
    source: 'company_user',
    requesterUid: uid,
    requesterName: String(member.data()?.name || ''),
    requesterEmail: String(member.data()?.email || token.email || ''),
    requesterRole: role,
    status: 'open',
    priority: 'normal',
    commentCount: 0,
    lastAction: 'أرسل طلب الدعم',
    lastActionByName: String(member.data()?.name || member.data()?.email || 'مستخدم الشركة'),
    lastActionByEmail: String(member.data()?.email || token.email || ''),
    lastActionAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: uid,
  });
  await ticket.collection('activity').add({ action: 'أرسل طلب الدعم', actorUid: uid, actorName: String(member.data()?.name || member.data()?.email || 'مستخدم الشركة'), actorEmail: String(member.data()?.email || token.email || ''), createdAt: FieldValue.serverTimestamp() });
  await db.collection('platformAuditLogs').add({ action: 'company_user_support_ticket_created', companyId, ticketId: ticket.id, createdBy: uid, timestamp, metadata: { requesterRole: role } });
  return { success: true, message: 'تم إرسال طلبك إلى فريق الدعم الفني.' };
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
  const actor = await platformActorIdentity(uid);
  const previousStatus = String(current.data()?.status || 'open');
  const action = previousStatus !== status ? `نقل الطلب إلى ${supportTicketStatusLabel[status]}` : priority !== undefined ? 'غيّر أولوية الطلب' : assignedTo !== undefined ? 'حدّث المسؤول عن الطلب' : 'حدّث طلب الدعم';
  await Promise.all([
    ticket.update({ status, ...(priority !== undefined ? { priority } : {}), ...(assignedTo !== undefined ? { assignedTo } : {}), lastAction: action, lastActionByName: actor.name, lastActionByEmail: actor.email, lastActionAt: timestamp, updatedAt: timestamp, updatedBy: uid }),
    ticket.collection('activity').add({ action, actorUid: uid, actorName: actor.name, actorEmail: actor.email, createdAt: FieldValue.serverTimestamp() }),
  ]);
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
  const actor = await platformActorIdentity(uid);
  await db.runTransaction(async tx => {
    const fresh = await tx.get(ticket);
    if (!fresh.exists) throw new Error('TICKET_NOT_FOUND');
    tx.create(ticket.collection('comments').doc(), { body, createdBy: uid, createdAt: timestamp });
    tx.update(ticket, { commentCount: FieldValue.increment(1), lastAction: 'أضاف تعليقًا', lastActionByName: actor.name, lastActionByEmail: actor.email, lastActionAt: timestamp, updatedAt: timestamp, updatedBy: uid });
  });
  await ticket.collection('activity').add({ action: 'أضاف تعليقًا', actorUid: uid, actorName: actor.name, actorEmail: actor.email, createdAt: FieldValue.serverTimestamp() });
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
