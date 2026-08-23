import * as crypto from 'node:crypto';
import { getMessaging } from 'firebase-admin/messaging';
import type { Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

type WorkerOrderPush = {
  companyId: string;
  workerId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  eventDate: string;
  kind: 'assignment' | 'today' | 'tomorrow';
};

type WorkerTaskPush = {
  companyId: string;
  workerId: string;
  taskId: string;
  title: string;
  executionDate: string;
};

const titleFor = (kind: WorkerOrderPush['kind']) => kind === 'assignment' ? 'أوردر جديد تم إسناده إليك' : kind === 'today' ? 'لديك أوردر اليوم' : 'لديك أوردر غدًا';
const bodyFor = (push: WorkerOrderPush) => {
  const orderName = push.orderNumber || push.orderId;
  if (push.kind === 'assignment') return `الأوردر ${orderName} للعميل ${push.customerName || 'بدون اسم'} تم إسناده إليك.`;
  return `الأوردر ${orderName} للعميل ${push.customerName || 'بدون اسم'} بتاريخ ${push.eventDate}.`;
};
const deliveryId = (push: WorkerOrderPush) => crypto.createHash('sha256').update(`${push.kind}:${push.orderId}:${push.workerId}:${push.eventDate}`).digest('hex');

/** Creates one idempotent in-app notification and sends a browser push to every registered worker device. */
export async function notifyWorkerAboutOrder(db: Firestore, push: WorkerOrderPush): Promise<void> {
  const companyRef = db.collection('companies').doc(push.companyId);
  const memberMatches = await companyRef.collection('members').where('workerId', '==', push.workerId).limit(2).get();
  const member = memberMatches.docs.find((candidate) => candidate.data().role === 'worker' && candidate.data().status === 'active');
  if (!member) return;

  const key = deliveryId(push);
  const deliveryRef = companyRef.collection('notificationDeliveries').doc(key);
  try {
    await deliveryRef.create({ ...push, workerUid: member.id, createdAt: new Date().toISOString() });
  } catch (error) {
    if ((error as { code?: number }).code === 6) return; // ALREADY_EXISTS: Firestore event/scheduler retry.
    throw error;
  }

  const title = titleFor(push.kind);
  const body = bodyFor(push);
  const notificationRef = companyRef.collection('notifications').doc(`worker_order_${key}`);
  await notificationRef.set({
    id: notificationRef.id,
    type: `worker_order_${push.kind}`,
    title,
    body,
    titleAr: title,
    messageAr: body,
    companyId: push.companyId,
    orderId: push.orderId,
    workerId: push.workerId,
    targetUid: member.id,
    read: false,
    linkModule: 'orders',
    referenceId: push.orderId,
    navigation: { module: 'orders', referenceId: push.orderId },
    createdAt: new Date().toISOString(),
  }, { merge: true });

  const response = await notifyMemberDevices(member.ref, { title, body, orderId: push.orderId, companyId: push.companyId, notificationId: notificationRef.id, url: '/?module=orders' });
  if (!response) return;
  logger.info('Worker order notification processed', { companyId: push.companyId, orderId: push.orderId, kind: push.kind, sent: response.successCount, stale: response.stale });
}

/** Notifies a worker when a standalone task is assigned to them. */
export async function notifyWorkerAboutTask(db: Firestore, push: WorkerTaskPush): Promise<void> {
  const companyRef = db.collection('companies').doc(push.companyId);
  const memberMatches = await companyRef.collection('members').where('workerId', '==', push.workerId).limit(2).get();
  const member = memberMatches.docs.find((candidate) => candidate.data().role === 'worker' && candidate.data().status === 'active');
  if (!member) return;

  const key = crypto.createHash('sha256').update(`task-assignment:${push.taskId}:${push.workerId}:${push.executionDate}`).digest('hex');
  const deliveryRef = companyRef.collection('notificationDeliveries').doc(key);
  try {
    await deliveryRef.create({ ...push, kind: 'task_assignment', workerUid: member.id, createdAt: new Date().toISOString() });
  } catch (error) {
    if ((error as { code?: number }).code === 6) return; // ALREADY_EXISTS on trigger retry.
    throw error;
  }

  const title = 'طلب عمل جديد تم إسناده إليك';
  const body = `${push.title || 'طلب عمل'} — موعد التنفيذ ${push.executionDate || 'غير محدد'}.`;
  const notificationRef = companyRef.collection('notifications').doc(`worker_task_${key}`);
  await notificationRef.set({
    id: notificationRef.id,
    type: 'worker_task_assignment',
    title,
    body,
    titleAr: title,
    messageAr: body,
    companyId: push.companyId,
    taskId: push.taskId,
    workerId: push.workerId,
    targetUid: member.id,
    read: false,
    linkModule: 'orders',
    referenceId: push.taskId,
    navigation: { module: 'orders', referenceId: push.taskId },
    createdAt: new Date().toISOString(),
  }, { merge: true });

  const response = await notifyMemberDevices(member.ref, { title, body, taskId: push.taskId, companyId: push.companyId, notificationId: notificationRef.id, url: '/?module=orders' });
  if (response) logger.info('Worker task notification processed', { companyId: push.companyId, taskId: push.taskId, sent: response.successCount, stale: response.stale });
}

/** Delivers a data-only web push to every browser registered by one company member. */
export async function notifyMemberDevices(memberRef: FirebaseFirestore.DocumentReference, data: Record<string, string>): Promise<{ successCount: number; stale: number } | null> {
  const devices = await memberRef.collection('pushDevices').get();
  // A browser can rotate its local device id while retaining the same FCM
  // token. Send once per unique token; otherwise one phone receives the exact
  // same arrival/completion alert twice.
  const devicesByToken = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  devices.docs.forEach(device => {
    const token = String(device.data().token || '').trim();
    if (!token) return;
    const group = devicesByToken.get(token) || [];
    group.push(device);
    devicesByToken.set(token, group);
  });
  const tokens = [...devicesByToken.keys()].slice(0, 500);
  if (!tokens.length) return null;

  // Data-only messages are intentionally non-collapsible. FCM keeps each one
  // for up to 28 days while the phone is offline, then delivers them when the
  // PWA/device reconnects.
  const response = await getMessaging().sendEachForMulticast({
    tokens,
    data,
    webpush: { headers: { TTL: String(28 * 24 * 60 * 60) } },
  });
  const staleDevices = tokens.flatMap((token, index) => {
    const result = response.responses[index];
    const code = result?.error?.code || '';
    return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token'
      ? devicesByToken.get(token) || []
      : [];
  });
  await Promise.all(staleDevices.map(device => device.ref.delete()));
  return { successCount: response.successCount, stale: staleDevices.length };
}

export function cairoDate(offsetDays = 0): string {
  const instant = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
