import React, { useState, useMemo } from 'react';
import {
  Eye,
  Car,
  CheckCircle2,
  Search,
  Calendar,
  Download,
  FileSpreadsheet,
  FileText,
  Clock,
  UserCheck,
  ClipboardList,
  Filter,
  ArrowUpDown,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { ActivityLogRecord, Order } from '../../types';
import { OrderDetailModal } from '../orders/OrderDetailModal';

type DateFilterType = 'today' | 'yesterday' | 'week' | 'month' | 'custom' | 'all';

export const ActivityLogModule: React.FC = () => {
  const { t, language } = useLanguage();
  const { activityLogs, orders } = useData();
  const { profile } = useAuth();

  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';

  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilterType>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | 'opened' | 'arrived' | 'finished'>('all');

  // Selected Order for Modal
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Quick dates
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  
  const yesterdayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }, []);

  // Filtered Activity Logs
  const filteredLogs = useMemo(() => {
    const now = new Date();

    return activityLogs.filter((log) => {
      // 1. Action filter
      if (actionFilter !== 'all' && log.action !== actionFilter) {
        return false;
      }

      // 2. Search Term filter (Worker, Customer, Order Number)
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const workerMatch = (log.workerName || '').toLowerCase().includes(term);
        const customerMatch = (log.customerName || '').toLowerCase().includes(term);
        const orderMatch = (log.orderNumber || '').toLowerCase().includes(term);
        if (!workerMatch && !customerMatch && !orderMatch) {
          return false;
        }
      }

      // 3. Date Filter
      const logDate = new Date(log.timestamp);
      const logDateStr = log.timestamp ? log.timestamp.split('T')[0] : '';

      if (dateFilter === 'today') {
        if (logDateStr !== todayStr) return false;
      } else if (dateFilter === 'yesterday') {
        if (logDateStr !== yesterdayStr) return false;
      } else if (dateFilter === 'week') {
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        if (logDate < oneWeekAgo) return false;
      } else if (dateFilter === 'month') {
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        if (logDate < oneMonthAgo) return false;
      } else if (dateFilter === 'custom') {
        if (startDate && logDateStr < startDate) return false;
        if (endDate && logDateStr > endDate) return false;
      }

      return true;
    });
  }, [activityLogs, actionFilter, searchTerm, dateFilter, todayStr, yesterdayStr, startDate, endDate]);

  // Statistics Summary Metrics (calculated from all activityLogs for today)
  const stats = useMemo(() => {
    const todaysLogs = activityLogs.filter((log) => {
      const logDateStr = log.timestamp ? log.timestamp.split('T')[0] : '';
      return logDateStr === todayStr;
    });

    return {
      totalToday: todaysLogs.length,
      openedToday: todaysLogs.filter((l) => l.action === 'opened').length,
      arrivedToday: todaysLogs.filter((l) => l.action === 'arrived').length,
      finishedToday: todaysLogs.filter((l) => l.action === 'finished').length,
    };
  }, [activityLogs, todayStr]);

  // Handle clicking an order to open its modal
  const handleOpenOrder = (orderId: string) => {
    const foundOrder = orders.find((o) => o.id === orderId || o.orderNumber === orderId);
    if (foundOrder) {
      setSelectedOrder(foundOrder);
    } else {
      alert(language === 'ar' ? 'عذراً، لم يتم العثور على الأوردر!' : 'Order details not found');
    }
  };

  const getActionLabel = (action: ActivityLogRecord['action']) => {
    if (action === 'opened') return language === 'ar' ? 'فتح الأوردر' : 'Opened Order';
    if (action === 'arrived') return language === 'ar' ? 'تم الوصول' : 'Arrived';
    if (action === 'finished') return language === 'ar' ? 'تم الانتهاء' : 'Finished';
    return action;
  };

  // Export the current filtered view as a native Excel workbook.
  const handleExportExcel = () => {
    if (filteredLogs.length === 0) {
      alert(language === 'ar' ? 'لا توجد بيانات للتصدير' : 'No data to export');
      return;
    }

    const rows = filteredLogs.map((log) => ({
      'وقت التنفيذ': new Date(log.timestamp).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US'),
      'اسم العامل': log.workerName || '',
      'اسم العميل': log.customerName || '',
      'رقم الأوردر': log.orderNumber || '',
      'التاريخ': log.eventDate || '',
      'الإجراء': getActionLabel(log.action),
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, language === 'ar' ? 'سجل النشاط' : 'Activity Log');
    XLSX.writeFile(workbook, `Activity_Log_${todayStr}.xlsx`);
  };

  // Export the current filtered view as a PDF file.
  const handleExportPdf = () => {
    if (filteredLogs.length === 0) {
      alert(language === 'ar' ? 'لا توجد بيانات للتصدير' : 'No data to export');
      return;
    }

    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(16);
    doc.text('Activity Log', 14, 16);
    doc.setFontSize(10);
    doc.text(new Date().toLocaleDateString('en-GB'), 14, 23);
    autoTable(doc, {
      startY: 28,
      head: [[
        language === 'ar' ? 'وقت التنفيذ' : 'Timestamp',
        language === 'ar' ? 'اسم العامل' : 'Worker',
        language === 'ar' ? 'اسم العميل' : 'Customer',
        language === 'ar' ? 'رقم الأوردر' : 'Order #',
        language === 'ar' ? 'التاريخ' : 'Event Date',
        language === 'ar' ? 'الإجراء' : 'Action',
      ]],
      body: filteredLogs.map((log) => [
        new Date(log.timestamp).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US'),
        log.workerName || '-',
        log.customerName || '-',
        log.orderNumber || '-',
        log.eventDate || '-',
        getActionLabel(log.action),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [217, 119, 6] },
    });
    doc.save(`Activity_Log_${todayStr}.pdf`);
  };

  // Access Denied Protection for Non-Admins
  if (!isAdmin) {
    return (
      <div className="p-8 max-w-lg mx-auto my-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl text-center space-y-4">
        <div className="w-16 h-16 bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 rounded-2xl flex items-center justify-center mx-auto">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-slate-900 dark:text-white">
          {t('accessDenied')}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('accessDeniedDesc')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Title & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white flex items-center gap-3">
            <span className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-2xl">
              <Clock className="w-7 h-7" />
            </span>
            <span>{t('activityLog')}</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            {language === 'ar'
              ? 'متابعة سجل تحركات وإجراءات العمال على الأوردرات لحظياً'
              : 'Real-time tracking of worker actions on field orders'}
          </p>
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <button
            onClick={handleExportExcel}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-600/20 cursor-pointer min-h-[44px]"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{t('exportExcel')}</span>
          </button>
          <button
            onClick={handleExportPdf}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-amber-600/20 cursor-pointer min-h-[44px]"
          >
            <FileText className="w-4 h-4" />
            <span>{t('exportPdf')}</span>
          </button>
        </div>
      </div>

      {/* STATISTICS SUMMARY CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Today's Activities */}
        <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {t('todaysActivities')}
            </p>
            <h3 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mt-1 font-mono">
              {stats.totalToday}
            </h3>
          </div>
          <div className="p-3 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl">
            <ClipboardList className="w-6 h-6" />
          </div>
        </div>

        {/* Orders Opened */}
        <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {t('ordersOpened')}
            </p>
            <h3 className="text-2xl sm:text-3xl font-black text-blue-600 dark:text-blue-400 mt-1 font-mono">
              {stats.openedToday}
            </h3>
          </div>
          <div className="p-3 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
            <Eye className="w-6 h-6" />
          </div>
        </div>

        {/* Arrivals */}
        <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {t('arrivals')}
            </p>
            <h3 className="text-2xl sm:text-3xl font-black text-amber-600 dark:text-amber-400 mt-1 font-mono">
              {stats.arrivedToday}
            </h3>
          </div>
          <div className="p-3 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl">
            <Car className="w-6 h-6" />
          </div>
        </div>

        {/* Finished Jobs */}
        <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {t('finishedJobs')}
            </p>
            <h3 className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
              {stats.finishedToday}
            </h3>
          </div>
          <div className="p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* FILTERS & SEARCH BAR */}
      <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute ltr:left-3.5 rtl:right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('searchActivityPlaceholder')}
              className="w-full ltr:pl-10 ltr:pr-4 rtl:pr-10 rtl:pl-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute ltr:right-3 rtl:left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Action Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
            <button
              onClick={() => setActionFilter('all')}
              className={`px-3 py-2 rounded-xl text-xs font-extrabold cursor-pointer transition-all whitespace-nowrap min-h-[38px] ${
                actionFilter === 'all'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              {language === 'ar' ? 'جميع الإجراءات' : 'All Actions'}
            </button>
            <button
              onClick={() => setActionFilter('opened')}
              className={`px-3 py-2 rounded-xl text-xs font-extrabold cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 min-h-[38px] ${
                actionFilter === 'opened'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{t('actionOpened')}</span>
            </button>
            <button
              onClick={() => setActionFilter('arrived')}
              className={`px-3 py-2 rounded-xl text-xs font-extrabold cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 min-h-[38px] ${
                actionFilter === 'arrived'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
              }`}
            >
              <Car className="w-3.5 h-3.5" />
              <span>{t('actionArrived')}</span>
            </button>
            <button
              onClick={() => setActionFilter('finished')}
              className={`px-3 py-2 rounded-xl text-xs font-extrabold cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 min-h-[38px] ${
                actionFilter === 'finished'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{t('actionFinished')}</span>
            </button>
          </div>
        </div>

        {/* Date Filter Bar */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <span className="text-xs font-extrabold text-slate-500 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-amber-500" />
            <span>{language === 'ar' ? 'الفترة الزمنية:' : 'Timeframe:'}</span>
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setDateFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                dateFilter === 'all'
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              {language === 'ar' ? 'الكل' : 'All'}
            </button>
            <button
              onClick={() => setDateFilter('today')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                dateFilter === 'today'
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              {t('filterToday')}
            </button>
            <button
              onClick={() => setDateFilter('yesterday')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                dateFilter === 'yesterday'
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              {t('filterYesterday')}
            </button>
            <button
              onClick={() => setDateFilter('week')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                dateFilter === 'week'
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              {t('filterThisWeek')}
            </button>
            <button
              onClick={() => setDateFilter('month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                dateFilter === 'month'
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              {t('filterThisMonth')}
            </button>
            <button
              onClick={() => setDateFilter('custom')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                dateFilter === 'custom'
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              {t('filterCustom')}
            </button>
          </div>

          {/* Custom Date Range Pickers */}
          {dateFilter === 'custom' && (
            <div className="flex items-center gap-2 mt-2 sm:mt-0 w-full sm:w-auto">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono focus:ring-1 focus:ring-amber-500"
              />
              <span className="text-xs font-bold text-slate-400">إلى</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono focus:ring-1 focus:ring-amber-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* ACTIVITY LOGS TABLE */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right rtl:text-right ltr:text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-3.5">{t('executionTime')}</th>
                <th className="px-4 py-3.5">{t('workerName')}</th>
                <th className="px-4 py-3.5">{t('customerName')}</th>
                <th className="px-4 py-3.5">{t('orderNumber')}</th>
                <th className="px-4 py-3.5">{t('eventDate')}</th>
                <th className="px-4 py-3.5">{t('action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Clock className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                      <p className="font-bold text-sm text-slate-500 dark:text-slate-400">
                        {language === 'ar'
                          ? 'لا توجد سجلات نشاط مطابقة للبحث أو الفلتر'
                          : 'No activity logs match your search or filter'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const logDate = new Date(log.timestamp);
                  const formattedTime = logDate.toLocaleString(
                    language === 'ar' ? 'ar-EG' : 'en-US',
                    {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }
                  );

                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* وقت التنفيذ */}
                      <td className="px-4 py-3.5 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {formattedTime}
                      </td>

                      {/* اسم العامل */}
                      <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-black text-[10px]">
                            {(log.workerName || 'W').charAt(0)}
                          </div>
                          <span>{log.workerName || '-'}</span>
                        </div>
                      </td>

                      {/* اسم العميل */}
                      <td className="px-4 py-3.5 text-slate-700 dark:text-slate-300">
                        {log.customerName || '-'}
                      </td>

                      {/* رقم الأوردر */}
                      <td className="px-4 py-3.5">
                        <button
                          onClick={() => handleOpenOrder(log.orderId || log.orderNumber)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300 font-extrabold font-mono rounded-lg border border-amber-200 dark:border-amber-800 transition-colors cursor-pointer"
                          title={language === 'ar' ? 'عرض تفاصيل الأوردر' : 'View Order Details'}
                        >
                          <span>{log.orderNumber}</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </td>

                      {/* التاريخ */}
                      <td className="px-4 py-3.5 font-mono text-slate-600 dark:text-slate-400">
                        {log.eventDate || '-'}
                      </td>

                      {/* الإجراء (Action Chips) */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {log.action === 'opened' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80 rounded-full font-extrabold text-[11px]">
                            <Eye className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                            <span>👁 {t('actionOpened')}</span>
                          </span>
                        )}

                        {log.action === 'arrived' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80 rounded-full font-extrabold text-[11px]">
                            <Car className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                            <span>🚗 {t('actionArrived')}</span>
                          </span>
                        )}

                        {log.action === 'finished' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 rounded-full font-extrabold text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>✅ {t('actionFinished')}</span>
                          </span>
                        )}

                        {log.action !== 'opened' && log.action !== 'arrived' && log.action !== 'finished' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-full font-bold text-[11px]">
                            <span>{log.action}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Details Modal Integration */}
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
