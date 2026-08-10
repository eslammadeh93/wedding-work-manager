import React, { useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  MapPin,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { Order } from '../../types';
import { OrderDetailModal } from '../orders/OrderDetailModal';
import { localDateString } from '../../utils/localDate';
import { OrderSourceBadge } from '../orders/OrderSourceBadge';

export const CalendarModule: React.FC = () => {
  const { t, language } = useLanguage();
  const { profile } = useAuth();
  const { orders } = useData();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // First day of current month
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startingDayIndex = firstDay.getDay(); // 0 = Sunday

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const todayStr = localDateString();

  const monthName = currentDate.toLocaleString(language === 'ar' ? 'ar' : 'en-US', {
    month: 'long',
    year: 'numeric',
  });

  const weekDays =
    language === 'ar'
      ? ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Days array
  const calendarDays = [];
  for (let i = 0; i < startingDayIndex; i++) {
    calendarDays.push(null);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day);
  }

  // The calendar is an installation schedule: only setup/delivery dates are shown.
  const getEventsForDate = (dateStr: string) => {
    return orders.filter((o) => o.deliveryDate === dateStr);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarIcon className="w-6 h-6 text-amber-500" />
            <span>{language === 'ar' ? 'تقويم التركيبات' : 'Installation Calendar'}</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <button
              onClick={prevMonth}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-300 transition-colors"
            >
              <ChevronLeft className="w-5 h-5 rtl:rotate-180" />
            </button>
            <span className="text-sm font-bold text-slate-900 dark:text-white px-3 min-w-[140px] text-center">
              {monthName}
            </span>
            <button
              onClick={nextMonth}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-300 transition-colors"
            >
              <ChevronRight className="w-5 h-5 rtl:rotate-180" />
            </button>
          </div>
        </div>
      </div>

      {/* Calendar Grid Container */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {/* Days Header */}
        <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80 text-center text-xs font-bold text-slate-500 py-3">
          {weekDays.map((day, idx) => (
            <div key={idx}>{day}</div>
          ))}
        </div>

        {/* Days Cells */}
        <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-slate-100 dark:divide-slate-800/60">
          {calendarDays.map((dayNum, index) => {
            if (dayNum === null) {
              return (
                <div key={index} className="min-h-[100px] p-2 bg-slate-50/40 dark:bg-slate-950/20" />
              );
            }

            const formattedDay = dayNum < 10 ? `0${dayNum}` : `${dayNum}`;
            const formattedMonth = month + 1 < 10 ? `0${month + 1}` : `${month + 1}`;
            const fullDateStr = `${year}-${formattedMonth}-${formattedDay}`;

            const isToday = fullDateStr === todayStr;
            const installationOrders = getEventsForDate(fullDateStr);
            const totalCount = installationOrders.length;

            return (
              <div
                key={index}
                className={`min-h-[110px] p-2 transition-colors flex flex-col justify-between ${
                  isToday ? 'bg-amber-500/5 dark:bg-amber-500/10' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
                      isToday
                        ? 'bg-amber-500 text-white shadow-xs'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {dayNum}
                  </span>
                  {totalCount > 0 && (
                    <span className="text-[10px] font-extrabold text-amber-600 dark:text-amber-400">
                      {totalCount} {language === 'ar' ? 'تركيبات' : 'setups'}
                    </span>
                  )}
                </div>

                {/* Event badges */}
                <div className="space-y-1 flex-1 overflow-y-auto max-h-[80px]">
                  {installationOrders.map((ord) => (
                    <div
                      key={ord.id}
                      onClick={() => setSelectedOrder(ord)}
                      className="p-1.5 bg-blue-500 text-white rounded-lg text-[10px] font-bold truncate cursor-pointer shadow-xs hover:bg-blue-600 transition-colors flex items-center gap-1"
                      title={`${language === 'ar' ? 'تركيب' : 'Setup'}: ${ord.customerName} - ${ord.eventLocation}`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                      <span className="truncate">
                        {language === 'ar' ? `تركيب: ${ord.customerName}` : `Setup: ${ord.customerName}`}
                      </span>
                      {profile?.role !== 'worker' && <OrderSourceBadge source={ord.orderSource} language={language} compact />}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Order Detail Modal when clicked */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onEdit={() => {}}
          onPrint={() => {}}
        />
      )}
    </div>
  );
};
