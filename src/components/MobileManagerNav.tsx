import React from 'react';
import { BellRing, CalendarDays, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { USE_MULTI_TENANT_DATA } from '../multiTenant/featureFlags';

interface MobileManagerNavProps {
  onCreateOrder: () => void;
  onOpenTodaysOrders: () => void;
  onOpenWorkerMovementNotifications: () => void;
  variant?: 'mobile' | 'desktop';
}

/** Fast, thumb-friendly actions reserved for manager accounts on small screens. */
export const MobileManagerNav: React.FC<MobileManagerNavProps> = ({
  onCreateOrder,
  onOpenTodaysOrders,
  onOpenWorkerMovementNotifications,
  variant = 'mobile',
}) => {
  const { profile, authSession } = useAuth();
  const { notifications } = useData();

  const isManager = ['super_admin', 'admin', 'manager'].includes(profile?.role || '');
  const permissions = authSession?.permissions || [];
  const canCreateOrder = !USE_MULTI_TENANT_DATA || permissions.includes('company:orders:write');
  const canViewOrders = !USE_MULTI_TENANT_DATA || permissions.includes('company:orders:read');
  const canViewNotifications = !USE_MULTI_TENANT_DATA || permissions.includes('company:notifications:read');
  const unreadMovements = notifications.filter(
    (notification) => !notification.read && ['worker_arrived', 'worker_completed'].includes(notification.type),
  ).length;

  if (!isManager) return null;

  const isDesktop = variant === 'desktop';
  const containerClass = isDesktop
    ? 'hidden lg:grid grid-cols-3 gap-1.5 w-full lg:w-auto lg:min-w-[345px]'
    : 'fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/90 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-lg lg:hidden';
  const contentClass = isDesktop
    ? 'grid grid-cols-3 gap-1.5'
    : 'mx-auto grid max-w-lg grid-cols-3 gap-1 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]';
  const buttonClass = isDesktop ? 'min-h-[62px] border border-slate-200 dark:border-slate-700' : 'min-h-[58px]';
  const secondaryButtonClass = isDesktop ? `${buttonClass} bg-slate-50 dark:bg-slate-800/70` : buttonClass;

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
            onClick={onOpenWorkerMovementNotifications}
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
      </div>
    </nav>
  );
};
