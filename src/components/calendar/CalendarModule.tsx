import React, { useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { Order } from '../../types';
import { OrderDetailModal } from '../orders/OrderDetailModal';

export const CalendarModule: React.FC = () => {
  const { t, language } = useLanguage();
  const { orders } = useData();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarMode, setCalendarMode] = useState<'booking' | 'event'>('event');
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

  const todayStr = new Date().toISOString().split('T')[0];

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

  // Get orders for a specific date based on mode
  const getEventsForDate = (dateStr: string) => {
    if (calendarMode === 'booking') {
      const bookingOrders = orders.filter((o) => (o.bookingDate || o.createdAt.split('T')[0]) === dateStr);
      return { primaryOrders: bookingOrders, secondaryOrders: [] };
    } else {
      const weddingOrders = orders.filter((o) => (o.eventDate || o.weddingDate) === dateStr);
      const deliveryOrders = orders.filter((o) => o.deliveryDate === dateStr);
      return { primaryOrders: weddingOrders, secondaryOrders: deliveryOrders };
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarIcon className="w-6 h-6 text-amber-500" />
            <span>{calendarMode === 'booking' ? t('bookingCalendar') : t('eventCalendar')}</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Calendar Mode Switcher */}
          <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl flex items-center border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setCalendarMode('event')}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all ${
                calendarMode === 'event'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              💍 {t('eventCalendar')}
            </button>
            <button
              onClick={() => setCalendarMode('booking')}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all ${
                calendarMode === 'booking'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              📅 {t('bookingCalendar')}
            </button>
          </div>

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
            const { primaryOrders, secondaryOrders } = getEventsForDate(fullDateStr);
            const totalCount = primaryOrders.length + secondaryOrders.length;

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
                      {totalCount} {calendarMode === 'booking' ? 'bookings' : 'events'}
                    </span>
                  )}
                </div>

                {/* Event badges */}
                <div className="space-y-1 flex-1 overflow-y-auto max-h-[80px]">
                  {primaryOrders.map((ord) => (
                    <div
                      key={ord.id}
                      onClick={() => setSelectedOrder(ord)}
                      className={`p-1.5 text-white rounded-lg text-[10px] font-bold truncate cursor-pointer shadow-xs transition-colors flex items-center gap-1 ${
                        calendarMode === 'booking'
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : 'bg-amber-500 hover:bg-amber-600'
                      }`}
                      title={`${ord.customerName} - ${ord.eventLocation}`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                      <span className="truncate">
                        {calendarMode === 'booking' ? `Booked: ${ord.customerName}` : ord.customerName}
                      </span>
                    </div>
                  ))}

                  {secondaryOrders.map((ord) => (
                    <div
                      key={ord.id}
                      onClick={() => setSelectedOrder(ord)}
                      className="p-1.5 bg-blue-500 text-white rounded-lg text-[10px] font-bold truncate cursor-pointer shadow-xs hover:bg-blue-600 transition-colors flex items-center gap-1"
                      title={`Setup: ${ord.customerName}`}
                    >
                      <Clock className="w-3 h-3 shrink-0" />
                      <span className="truncate">Setup: {ord.customerName}</span>
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
