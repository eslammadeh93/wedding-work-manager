import React from 'react';
import { BellRing, CalendarClock, CircleDollarSign, PackageX, UserX } from 'lucide-react';
import type { ActiveTab } from '../Sidebar';
import type { ImportantAlert } from '../../utils/importantAlerts';

interface ImportantAlertsCenterProps {
  alerts: ImportantAlert[];
  language: 'ar' | 'en';
  onNavigate: (tab: ActiveTab, refId?: string) => void;
}

const alertPresentation = {
  upcoming_order: { icon: CalendarClock, classes: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' },
  overdue_payment: { icon: CircleDollarSign, classes: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' },
  low_inventory: { icon: PackageX, classes: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' },
  missing_worker_arrival: { icon: UserX, classes: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' },
} as const;

export const ImportantAlertsCenter: React.FC<ImportantAlertsCenterProps> = ({ alerts, language, onNavigate }) => {
  const isArabic = language === 'ar';

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <BellRing className="w-4 h-4" />
          </span>
          <div>
            <h3 className="font-black text-slate-900 dark:text-white">{isArabic ? 'التنبيهات المهمة' : 'Important alerts'}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{isArabic ? 'متابعة التشغيل التي تحتاج إجراءً' : 'Operational items that need action'}</p>
          </div>
        </div>
        <span className={`min-w-7 h-7 px-2 inline-flex items-center justify-center rounded-full text-xs font-black ${alerts.length ? 'bg-rose-500 text-white' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'}`}>
          {alerts.length}
        </span>
      </div>

      {alerts.length === 0 ? (
        <div className="px-5 py-6 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          <BellRing className="w-4 h-4" />
          {isArabic ? 'لا توجد تنبيهات مهمة الآن.' : 'There are no important alerts right now.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-4">
          {alerts.map((alert) => {
            const presentation = alertPresentation[alert.type];
            const Icon = presentation.icon;
            return (
              <button
                key={alert.id}
                type="button"
                onClick={() => onNavigate(alert.module, alert.referenceId)}
                className="text-start flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-amber-400/60 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors cursor-pointer"
              >
                <span className={`shrink-0 p-2 rounded-lg border ${presentation.classes}`}><Icon className="w-4 h-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-black text-slate-900 dark:text-white">{isArabic ? alert.titleAr : alert.titleEn}</span>
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400 truncate">{isArabic ? alert.detailsAr : alert.detailsEn}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
