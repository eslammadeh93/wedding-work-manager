import { deleteToken, getMessaging, getToken, isSupported, onMessage, type MessagePayload } from 'firebase/messaging';
import app from './firebase/config';
import { companyMembersService } from './multiTenant/companyMembersService';

// VAPID public keys identify this web app to push services; they are not secrets.
const VAPID_PUBLIC_KEY = 'BLfnGYBS6TvN4lUDjAP9f79ku7-_vyYC88CcRgjf2BB1okA8ZrHgOKB6J9U9OQ423Jcfh7xmpGRMDre6rM3ncig';

const deviceKey = (companyId: string, uid: string) => `wwm-push-device:${companyId}:${uid}`;
const getDeviceId = (companyId: string, uid: string) => {
  const key = deviceKey(companyId, uid);
  const existing = localStorage.getItem(key);
  if (existing && /^[A-Za-z0-9_-]{8,128}$/.test(existing)) return existing;
  const next = crypto.randomUUID().replaceAll('-', '_');
  localStorage.setItem(key, next);
  return next;
};

export type PushSetupResult = { success: boolean; message?: string };

const shownPushes = new Set<string>();
const shownPushesKey = (companyId: string, uid: string) => `wwm-shown-pushes:${companyId}:${uid}`;
const notificationIdFrom = (data: Record<string, string | undefined>) => data.notificationId || data.deliveryId || '';

function readShownPushes(companyId: string, uid: string): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(shownPushesKey(companyId, uid)) || '[]');
    if (Array.isArray(stored)) stored.filter((id): id is string => typeof id === 'string').slice(-200).forEach(id => shownPushes.add(`${companyId}:${uid}:${id}`));
  } catch {
    // Browser storage is optional; the in-memory guard still prevents duplicate
    // messages during this app session.
  }
  return shownPushes;
}

function rememberShownPush(companyId: string, uid: string, notificationId: string) {
  if (!notificationId) return;
  const key = `${companyId}:${uid}:${notificationId}`;
  shownPushes.add(key);
  try {
    const storageKey = shownPushesKey(companyId, uid);
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const ids = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && id !== notificationId) : [];
    ids.push(notificationId);
    localStorage.setItem(storageKey, JSON.stringify(ids.slice(-200)));
  } catch {
    // Keep working in private browsing and quota-limited webviews.
  }
}

/** Records notifications already present when a device first enables push. */
export function markPushShown(input: { companyId: string; uid: string; notificationId: string }) {
  rememberShownPush(input.companyId, input.uid, input.notificationId);
}

export function hasPushHistory(input: { companyId: string; uid: string }): boolean {
  try { return localStorage.getItem(shownPushesKey(input.companyId, input.uid)) !== null; }
  catch { return false; }
}

/** Returns true when this notification was already shown on this browser. */
export function wasPushShown(input: { companyId: string; uid: string; notificationId: string }): boolean {
  if (!input.notificationId) return false;
  readShownPushes(input.companyId, input.uid);
  return shownPushes.has(`${input.companyId}:${input.uid}:${input.notificationId}`);
}

type PushDisplayData = Record<string, string | undefined>;

/**
 * Show a native notification through the same service-worker registration in
 * both foreground and background. The tag makes duplicate FCM deliveries (or
 * an old duplicated device registration) replace one another instead of
 * producing two alerts on the phone.
 */
export async function showPushNotification(input: { companyId: string; uid: string; data: PushDisplayData }): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return false;
  const notificationId = notificationIdFrom(input.data);
  if (notificationId && wasPushShown({ companyId: input.companyId, uid: input.uid, notificationId })) return false;
  // Claim it before awaiting the registration so a simultaneous Firestore
  // catch-up and foreground FCM callback cannot display it twice.
  if (notificationId) rememberShownPush(input.companyId, input.uid, notificationId);
  try {
    const registration = (await navigator.serviceWorker.getRegistration()) || await navigator.serviceWorker.register('/service-worker.js');
    await registration.showNotification(input.data.title || 'مدير أعمال الويدينج', {
      body: input.data.body || '',
      icon: '/wwm-logo.png',
      badge: '/wwm-notification-crown.png',
      tag: notificationId || undefined,
      data: { url: input.data.url || '/', notificationId },
    });
    return true;
  } catch {
    return false;
  }
}

/** Receives data-only FCM messages while the PWA is open. */
export async function listenForForegroundPushNotifications(input: { companyId: string; uid: string }): Promise<() => void> {
  if (!(await isSupported())) return () => undefined;
  const messaging = getMessaging(app);
  return onMessage(messaging, (payload: MessagePayload) => {
    void showPushNotification({ companyId: input.companyId, uid: input.uid, data: payload.data || {} });
  });
}

export async function enablePushNotifications(input: { companyId: string; uid: string }): Promise<PushSetupResult> {
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('Notification' in window)) return { success: false, message: 'الإشعارات تحتاج نسخة HTTPS من التطبيق.' };
  if (!(await isSupported())) return { success: false, message: 'هذا المتصفح لا يدعم إشعارات التطبيق.' };
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return { success: false, message: 'لم يتم السماح بالإشعارات على هذا الجهاز.' };

  const registration = (await navigator.serviceWorker.getRegistration()) || await navigator.serviceWorker.register('/service-worker.js');
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: registration });
  if (!token) return { success: false, message: 'تعذر تجهيز إشعارات هذا الجهاز.' };
  const result = await companyMembersService.setPushDevice({ companyId: input.companyId, deviceId: getDeviceId(input.companyId, input.uid), token, enabled: true });
  if (!result.success) return { success: false, message: result.message };
  // While the app is open, its live Firestore notification centre already
  // shows the event. Do not create a second native browser notification.
  return { success: true };
}

export async function disablePushNotifications(input: { companyId: string; uid: string }): Promise<PushSetupResult> {
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('Notification' in window)) return { success: false, message: 'الإشعارات تحتاج نسخة HTTPS من التطبيق.' };
  if (!(await isSupported())) return { success: false, message: 'هذا المتصفح لا يدعم إشعارات التطبيق.' };
  const deviceId = getDeviceId(input.companyId, input.uid);
  const messaging = getMessaging(app);
  await deleteToken(messaging).catch(() => undefined);
  const result = await companyMembersService.setPushDevice({ companyId: input.companyId, deviceId, enabled: false });
  if (!result.success) return { success: false, message: result.message };
  return { success: true };
}
