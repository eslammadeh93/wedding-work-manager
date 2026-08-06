import React from 'react';
import { Bell, X, Calendar, DollarSign, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useData } from '../context/DataContext';
import { ActiveTab } from './Sidebar';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: ActiveTab, refId?: string) => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const { t, language } = useLanguage();
  const { notifications, markNotificationAsRead, clearAllNotifications } = useData();

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40"
        onClick={onClose}
      />
      <div className="fixed top-0 ltr:right-0 rtl:left-0 z-50 h-screen w-full max-w-sm bg-white dark:bg-slate-900 shadow-2xl border-x border-slate-200 dark:border-slate-800 flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-500" />
            <h3 className="font-bold text-slate-900 dark:text-white text-base">
              {t('notifications')}
            </h3>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 text-xs font-bold bg-amber-500 text-white rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={clearAllNotifications}
                className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline px-2 py-1"
              >
                {t('markAllRead')}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="p-3 overflow-y-auto space-y-2 flex-1">
          {notifications.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-emerald-500 opacity-50" />
              <p className="text-sm">{t('noNotifications')}</p>
            </div>
          ) : (
            notifications.map((notif) => {
              const title = language === 'ar' ? (notif.titleAr || notif.title || '') : (notif.titleEn || notif.title || '');
              const message = language === 'ar' ? (notif.messageAr || notif.body || '') : (notif.messageEn || notif.body || '');
              const dateValue = notif.createdAt && typeof notif.createdAt === 'object' && 'toDate' in notif.createdAt && typeof notif.createdAt.toDate === 'function'
                ? notif.createdAt.toDate() as Date : new Date(notif.date || Date.now());

              let icon = <AlertTriangle className="w-4 h-4 text-amber-500" />;
              let bgClass = 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50';

              if (notif.type === 'upcoming_wedding') {
                icon = <Calendar className="w-4 h-4 text-blue-500" />;
                bgClass = 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/50';
              } else if (notif.type === 'pending_payment') {
                icon = <DollarSign className="w-4 h-4 text-rose-500" />;
                bgClass = 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50';
              }

              return (
                <div
                  key={notif.id}
                  onClick={() => {
                    markNotificationAsRead(notif.id);
                    if (notif.linkModule) {
                      onNavigate(notif.linkModule as ActiveTab, notif.referenceId || notif.orderId);
                      onClose();
                    }
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer relative ${bgClass} ${
                    !notif.read ? 'ring-2 ring-amber-500/30 font-medium' : 'opacity-80'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white dark:bg-slate-800 rounded-lg shadow-xs">
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {title}
                      </h4>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                        {message}
                      </p>
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        {dateValue.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};
