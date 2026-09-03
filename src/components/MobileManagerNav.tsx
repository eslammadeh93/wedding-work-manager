import React, { useEffect, useState } from 'react';
import { BellOff, BellRing, Calculator, CalendarDays, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { USE_MULTI_TENANT_DATA } from '../multiTenant/featureFlags';
import { disablePushNotifications, enablePushNotifications } from '../pushNotifications';

interface MobileManagerNavProps {
  onCreateOrder: () => void;
  onOpenTodaysOrders: () => void;
  onOpenWorkerMovements: () => void;
  onOpenCalculator: () => void;
  variant?: 'mobile' | 'desktop';
}

/** Fast actions for managers plus the notification switch for office accounts. */
export const MobileManagerNav: React.FC<MobileManagerNavProps> = ({
  onCreateOrder,
  onOpenTodaysOrders,
  onOpenWorkerMovements,
  onOpenCalculator,
  variant = 'mobile',
}) => {
  const { profile, authSession } = useAuth();
  const { notifications } = useData();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  const isWorker = profile?.role === 'worker';
  const isCompanyMember = Boolean(authSession?.companyId && authSession?.uid);
  const canControlPush = isCompanyMember && !isWorker;
  const isDesktop = variant === 'desktop';
  // Notification permission is deliberately a handheld-only action. Desktop
  // users should not be interrupted or offered this setting in the dashboard.
  const showPushControl = canControlPush && !isDesktop;
  const pushPreferenceKey = authSession?.companyId && authSession?.uid ? `wwm-push-enabled:${authSession.companyId}:${authSession.uid}` : '';
  const permissions = authSession?.permissions || [];
  const canCreateOrder = !USE_MULTI_TENANT_DATA || permissions.includes('company:orders:write');
  const canViewOrders = !USE_MULTI_TENANT_DATA || permissions.includes('company:orders:read');
  const canViewNotifications = !USE_MULTI_TENANT_DATA || permissions.includes('company:notifications:read');
  const canUseCalculator = !USE_MULTI_TENANT_DATA || permissions.includes('company:calculator:use');
  const unreadMovements = notifications.filter(
    (notification) => !notification.read && ['worker_arrived', 'worker_completed'].includes(notification.type),
  ).length;

  useEffect(() => {
    setPushEnabled(pushPreferenceKey ? localStorage.getItem(pushPreferenceKey) === 'true' : false);
    setPushMessage(null);
  }, [pushPreferenceKey]);

  const togglePushNotifications = async () => {
    if (!authSession?.companyId || !authSession.uid) return;
    setPushBusy(true); setPushMessage(null);
    try {
      const result = pushEnabled
        ? await disablePushNotifications({ companyId: authSession.companyId, uid: authSession.uid })
        : await enablePushNotifications({ companyId: authSession.companyId, uid: authSession.uid });
      if (!result.success) {
        setPushMessage(result.message || 'تعذر تحديث الإشعارات.');
        return;
      }
      setPushEnabled((enabled) => !enabled);
      if (pushEnabled) localStorage.removeItem(pushPreferenceKey);
      else localStorage.setItem(pushPreferenceKey, 'true');
    } catch {
      setPushMessage('تعذر تحديث الإشعارات. تأكد من اتصال الإنترنت ثم حاول مرة أخرى.');
    } finally { setPushBusy(false); }
  };

  if (!showPushControl && !canUseCalculator && !canCreateOrder && !canViewOrders && !canViewNotifications) return null;

  const containerClass = isDesktop
    ? 'hidden lg:grid w-full lg:w-auto lg:min-w-[450px]'
    : 'fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/90 bg-white/95 backdrop-blur-lg dark:border-slate-700 dark:bg-slate-900/95 lg:hidden';
  const contentClass = isDesktop
    ? 'grid grid-cols-4 gap-1.5'
    : 'mx-auto flex max-w-lg items-stretch gap-1 px-2 pt-2 pb-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]';
  const buttonClass = isDesktop ? 'min-h-[62px] border border-slate-200 dark:border-slate-700' : 'min-h-[58px] min-w-0 flex-1';
  const secondaryButtonClass = isDesktop ? `${buttonClass} bg-slate-50 dark:bg-slate-800/70` : buttonClass;
  const pushBlocked = typeof Notification !== 'undefined' && Notification.permission === 'denied';

  return (
    <nav
      className={containerClass}
      aria-label="إجراءات المدير السريعة"
    >
      <div className={contentClass} dir="rtl">
        {canCreateOrder && (
          <button
            type="button"
            onClick={onCreateOrder}
            className={`group flex flex-col items-center justify-center gap-1 rounded-xl bg-amber-500 text-white shadow-sm shadow-amber-500/25 transition-transform active:scale-95 ${buttonClass}`}
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
            <span className="text-[10px] font-extrabold">إضافة طلب زفاف</span>
          </button>
        )}

        {canUseCalculator && (
          <button
            type="button"
            onClick={onOpenCalculator}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl text-slate-600 transition-colors hover:bg-emerald-50 dark:text-slate-300 dark:hover:bg-emerald-950/30 active:scale-95 ${secondaryButtonClass}`}
          >
            <Calculator className="h-5 w-5 text-emerald-500" />
            <span className="text-[10px] font-bold">الحاسبة</span>
          </button>
        )}

        {canViewOrders && (
          <button
            type="button"
            onClick={onOpenTodaysOrders}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 active:scale-95 ${secondaryButtonClass}`}
          >
            <CalendarDays className="h-5 w-5 text-amber-500" />
            <span className="text-[10px] font-bold">أوردرات اليوم</span>
          </button>
        )}

        {canViewNotifications && (
          <button
            type="button"
            onClick={onOpenWorkerMovements}
            className={`relative flex flex-col items-center justify-center gap-1 rounded-xl text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 active:scale-95 ${secondaryButtonClass}`}
          >
            <BellRing className="h-5 w-5 text-amber-500" />
            {unreadMovements > 0 && (
              <span className="absolute top-1.5 right-3.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-extrabold text-white">
                {unreadMovements}
              </span>
            )}
            <span className="text-[10px] font-bold">تحرك العمال</span>
          </button>
        )}

        {showPushControl && (
          <button
            type="button"
            onClick={() => void togglePushNotifications()}
            disabled={pushBusy || pushBlocked}
            title={pushBlocked ? 'الإذن مرفوض من المتصفح؛ فعّله من إعدادات الموقع.' : pushEnabled ? 'إيقاف إشعارات هذا الجهاز' : 'تفعيل إشعارات هذا الجهاز'}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl transition-colors active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${buttonClass} ${pushEnabled ? 'bg-indigo-600 text-white hover:bg-indigo-700' : `text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${isDesktop ? 'bg-slate-50 dark:bg-slate-800/70' : ''}`}`}
          >
            {pushEnabled ? <BellOff className="h-5 w-5" /> : <BellRing className="h-5 w-5 text-amber-500" />}
            <span className="text-[10px] font-bold">{pushBusy ? 'جارٍ الحفظ' : pushBlocked ? 'الإذن مرفوض' : pushEnabled ? 'إيقاف الإشعارات' : 'تفعيل الإشعارات'}</span>
          </button>
        )}
      </div>
      {pushMessage && !isDesktop && <p role="alert" className="mx-auto max-w-lg px-3 pb-2 text-center text-[11px] font-bold text-rose-600">{pushMessage}</p>}
    </nav>
  );
};
