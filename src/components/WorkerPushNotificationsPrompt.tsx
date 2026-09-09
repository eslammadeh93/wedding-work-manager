import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listenForForegroundPushNotifications } from '../pushNotifications';

/** Handles foreground worker delivery; the mobile navigation owns this device's enable/disable setting. */
export const WorkerPushNotificationsPrompt: React.FC = () => {
  const { profile, authSession } = useAuth();
  const preferenceKey = authSession?.companyId && authSession?.uid ? `wwm-push-enabled:${authSession.companyId}:${authSession.uid}` : '';
  const [enabled, setEnabled] = useState(false);
  const isWorker = profile?.role === 'worker';

  useEffect(() => {
    const refresh = () => setEnabled(preferenceKey ? localStorage.getItem(preferenceKey) === 'true' : false);
    refresh();
    window.addEventListener('wwm-push-preference-changed', refresh);
    return () => window.removeEventListener('wwm-push-preference-changed', refresh);
  }, [preferenceKey]);

  useEffect(() => {
    if (!isWorker || !enabled || !authSession?.companyId || !authSession.uid || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void listenForForegroundPushNotifications({ companyId: authSession.companyId, uid: authSession.uid }).then((listener) => {
      if (active) unsubscribe = listener;
      else listener();
    });
    return () => { active = false; unsubscribe?.(); };
  }, [enabled, isWorker, authSession?.companyId, authSession?.uid]);

  return null;
};
