import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import app from './firebase/config';
import { companyMembersService } from './multiTenant/companyMembersService';

// VAPID public keys identify this web app to push services; they are not secrets.
const VAPID_PUBLIC_KEY = 'BLfnGYBS6TvN4lUDjAP9f79ku7-_vyYC88CcRgjf2BB1okA8ZrHgOKB6J9U9OQ423Jcfh7xmpGRMDre6rM3ncig';
let foregroundListenerStarted = false;

const deviceKey = (companyId: string, uid: string) => `wwm-push-device:${companyId}:${uid}`;
const getDeviceId = (companyId: string, uid: string) => {
  const key = deviceKey(companyId, uid);
  const existing = localStorage.getItem(key);
  if (existing && /^[A-Za-z0-9_-]{8,128}$/.test(existing)) return existing;
  const next = crypto.randomUUID().replaceAll('-', '_');
  localStorage.setItem(key, next);
  return next;
};

const startForegroundListener = () => {
  if (foregroundListenerStarted) return;
  foregroundListenerStarted = true;
  const messaging = getMessaging(app);
  onMessage(messaging, (payload) => {
    const title = payload.data?.title || 'مدير أعمال الويدينج';
    const body = payload.data?.body || '';
    if (Notification.permission === 'granted') new Notification(title, { body, icon: '/wwm-logo.png', badge: '/wwm-notification-crown.png' });
  });
};

export type PushSetupResult = { success: boolean; message?: string };

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
  startForegroundListener();
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
