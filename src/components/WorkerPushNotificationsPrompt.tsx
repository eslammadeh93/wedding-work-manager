import React, { useEffect, useState } from 'react';
import { BellOff, BellRing } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { disablePushNotifications, enablePushNotifications } from '../pushNotifications';

/** Workers activate this once; office accounts use the navigation switch. */
export const WorkerPushNotificationsPrompt: React.FC = () => {
  const { profile, authSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const preferenceKey = authSession?.companyId && authSession?.uid ? `wwm-push-enabled:${authSession.companyId}:${authSession.uid}` : '';
  const [enabled, setEnabled] = useState(false);
  const isWorker = profile?.role === 'worker';
  const isCompanyMember = Boolean(authSession?.companyId && authSession?.uid);

  const enable = async () => {
    if (!authSession?.companyId || !authSession.uid) return;
    setBusy(true); setMessage(null);
    try {
      const result = await enablePushNotifications({ companyId: authSession.companyId, uid: authSession.uid });
      if (result.success) {
        setEnabled(true);
        localStorage.setItem(preferenceKey, 'true');
      }
      else setMessage(result.message || 'تعذر تفعيل الإشعارات.');
    } catch {
      setMessage('تعذر تفعيل الإشعارات. تأكد من اتصال الإنترنت ثم حاول مرة أخرى.');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    if (!authSession?.companyId || !authSession.uid) return;
    setBusy(true); setMessage(null);
    try {
      const result = await disablePushNotifications({ companyId: authSession.companyId, uid: authSession.uid });
      if (result.success) {
        setEnabled(false);
        localStorage.removeItem(preferenceKey);
      }
      else setMessage(result.message || 'تعذر إيقاف الإشعارات.');
    } catch {
      setMessage('تعذر إيقاف الإشعارات. تأكد من اتصال الإنترنت ثم حاول مرة أخرى.');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    setEnabled(preferenceKey ? localStorage.getItem(preferenceKey) === 'true' : false);
  }, [preferenceKey]);

  useEffect(() => {
    if (!isCompanyMember || !isWorker || enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    void enable();
  // Renew a worker token if the browser rotates it; permission itself is only requested after a click.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompanyMember, isWorker, enabled, authSession?.companyId, authSession?.uid]);

  if (!isCompanyMember || !isWorker || enabled) return null;
  const blocked = typeof Notification !== 'undefined' && Notification.permission === 'denied';
  const accountLabel = isWorker ? 'فعّل إشعارات الأوردرات' : 'إشعارات البرنامج';
  const description = isWorker ? 'سيصلك أوردر جديد وتذكير بأوردرات اليوم وبكرة.' : 'فعّل أو أوقف إشعارات هذا الجهاز في أي وقت.';
  return <div className="fixed bottom-4 left-4 right-4 z-[71] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-indigo-900 dark:bg-slate-900/95 lg:hidden" dir="rtl"><div className="min-w-0 text-right"><p className="text-xs font-black text-slate-900 dark:text-white">{accountLabel}</p><p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{blocked ? 'الإذن مرفوض من المتصفح؛ فعّله من إعدادات الموقع.' : description}</p>{message && <p className="mt-1 text-[11px] font-bold text-rose-600">{message}</p>}</div><button type="button" onClick={() => void (enabled ? disable() : enable())} disabled={busy || blocked} className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black text-white disabled:opacity-60 ${enabled ? 'bg-slate-600 hover:bg-slate-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>{enabled ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}{busy ? 'جارٍ الحفظ' : enabled ? 'إيقاف' : 'تفعيل'}</button></div>;
};
