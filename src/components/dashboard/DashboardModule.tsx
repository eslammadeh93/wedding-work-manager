import React from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  ClipboardList,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Boxes,
  ArrowUpRight,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { ActiveTab } from '../Sidebar';
import { MobileManagerNav } from '../MobileManagerNav';
import { completedOrderFulfillmentCosts, recordedOrderPayment } from '../../utils/orderPayments';
import { getOrderStatusLabel } from '../../utils/orderStatus';
import { OrderSourceBadge } from '../orders/OrderSourceBadge';
import { MoneyValue } from '../ui/MoneyValue';
import { ImportantAlertsCenter } from './ImportantAlertsCenter';
import { getImportantAlerts } from '../../utils/importantAlerts';

interface DashboardModuleProps {
  onNavigate: (tab: ActiveTab, refId?: string) => void;
  onCreateOrder: () => void;
  onOpenTodaysOrders: () => void;
  onOpenWorkerMovements: () => void;
}

export const DashboardModule: React.FC<DashboardModuleProps> = ({
  onNavigate,
  onCreateOrder,
  onOpenTodaysOrders,
  onOpenWorkerMovements,
}) => {
  const { t, language } = useLanguage();
  const { profile } = useAuth();
  const { orders, inventory, activityLogs, totalCapital, totalGeneralExpenses, currentCashBalance } = useData();

  // Metrics Calculations
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  const bookingsThisMonth = orders.filter((o) => {
    const d = new Date(o.bookingDate || o.createdAt);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  }).length;

  const eventsThisMonth = orders.filter((o) => {
    const d = new Date(o.eventDate || o.weddingDate);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  }).length;

  const monthlyOrders = orders.filter((o) => {
    const d = new Date(o.createdAt || o.weddingDate);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const monthlyRevenue = monthlyOrders.reduce((sum, order) => sum + recordedOrderPayment(order), 0);

  const monthlyOrderExpenses = monthlyOrders.reduce((sum, order) => sum + completedOrderFulfillmentCosts(order) + (order.otherExpenses || 0), 0);

  // Order profitability stays independent from the company capital/expense ledger.
  const netProfit = monthlyRevenue - monthlyOrderExpenses;
  const firstName = profile?.displayName?.trim().split(/\s+/)[0] || (language === 'ar' ? 'مدير' : 'Manager');

  const totalOrdersCount = orders.length;
  const pendingOrdersCount = orders.filter((o) => o.orderStatus === 'pending' || o.orderStatus === 'in_progress' || o.orderStatus === 'confirmed').length;
  const completedOrdersCount = orders.filter((o) => o.orderStatus === 'completed').length;

  const upcomingWeddings = orders
    .filter((o) => o.orderStatus !== 'completed' && o.orderStatus !== 'cancelled' && o.orderStatus !== 'cancelled_deposit_retained')
    .sort((a, b) => new Date(a.weddingDate).getTime() - new Date(b.weddingDate).getTime());

  const lowInventoryItems = inventory.filter((i) => i.availableQuantity <= i.minStockLevel);
  const importantAlerts = getImportantAlerts({ orders, inventory, activityLogs });

  // Status Breakdown
  const statusCounts = {
    pending: orders.filter((o) => o.orderStatus === 'pending').length,
    confirmed: orders.filter((o) => o.orderStatus === 'confirmed').length,
    in_progress: orders.filter((o) => o.orderStatus === 'in_progress').length,
    completed: orders.filter((o) => o.orderStatus === 'completed').length,
    cancelled: orders.filter((o) => o.orderStatus === 'cancelled' || o.orderStatus === 'cancelled_deposit_retained').length,
  };

  // 6 Month Revenue Chart based on real orders & expenses
  const monthsData = [5, 4, 3, 2, 1, 0].map((offset) => {
    const d = new Date();
    d.setMonth(d.getMonth() - offset);
    const m = d.getMonth();
    const y = d.getFullYear();
    const monthName = d.toLocaleString(language === 'ar' ? 'ar' : 'en-US', { month: 'short' });

    const monthOrders = orders.filter((o) => {
      const od = new Date(o.createdAt || o.weddingDate);
      return od.getMonth() === m && od.getFullYear() === y;
    });

    const rev = monthOrders.reduce((acc, o) => acc + o.totalPrice, 0);

    const orderExp = monthOrders.reduce((sum, order) => sum + completedOrderFulfillmentCosts(order) + (order.otherExpenses || 0), 0);

    const exp = orderExp;

    return { name: monthName, rev, exp };
  });

  const maxVal = Math.max(...monthsData.map((m) => Math.max(m.rev, m.exp)), 1000);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner Greetings */}
      <div className="theme-dashboard-welcome p-6 rounded-2xl border shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">System Dashboard</span>
          </div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">{t('welcomeBack')}, {firstName}</h2>
        </div>
        <MobileManagerNav
          variant="desktop"
          onCreateOrder={onCreateOrder}
          onOpenTodaysOrders={onOpenTodaysOrders}
          onOpenWorkerMovements={onOpenWorkerMovements}
        />
      </div>

      {/* Company Financial Balance Summary Banner */}
      <div className="p-5 bg-gradient-to-r from-slate-100 via-white to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-md text-slate-900 dark:text-white">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-700/60">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 block">
              {language === 'ar' ? 'الوضع المالي للشركة' : 'Company Financial Balance'}
            </span>
            <h3 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
              {t('capitalAndExpenses')}
            </h3>
          </div>
          <button
            onClick={() => onNavigate('expenses')}
            className="px-3.5 py-1.5 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-amber-700 dark:text-amber-400 border border-amber-400/30 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span>{language === 'ar' ? 'عرض السجل المالي' : 'View Financial Ledger'}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
          {/* Total Capital */}
          <div className="min-w-0 overflow-hidden p-3.5 bg-white/80 dark:bg-slate-800/80 rounded-xl border border-emerald-500/30">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              {t('totalCapital')}
            </span>
            <MoneyValue amount={totalCapital} className="mt-1 text-[clamp(0.875rem,2.1vw,1.25rem)] font-black text-emerald-400" />
          </div>

          {/* Total General Expenses */}
          <div className="min-w-0 overflow-hidden p-3.5 bg-white/80 dark:bg-slate-800/80 rounded-xl border border-rose-500/30">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              {t('totalGeneralExpenses')}
            </span>
            <MoneyValue amount={totalGeneralExpenses} className="mt-1 text-[clamp(0.875rem,2.1vw,1.25rem)] font-black text-rose-400" />
          </div>

          {/* Current Cash Balance */}
          <div className="min-w-0 overflow-hidden p-3.5 bg-white/80 dark:bg-slate-800/80 rounded-xl border border-amber-500/30">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              {t('currentCashBalance')}
            </span>
            <MoneyValue amount={currentCashBalance} className={`mt-1 text-[clamp(0.875rem,2.1vw,1.25rem)] font-black ${currentCashBalance >= 0 ? 'text-amber-400' : 'text-rose-400'}`} />
          </div>
        </div>
      </div>

      <ImportantAlertsCenter alerts={importantAlerts} language={language} onNavigate={onNavigate} />

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 min-[1700px]:grid-cols-6 gap-4">
        {/* Bookings This Month */}
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('bookingsThisMonth')}
            </span>
            <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black premium-gold mt-3 tracking-tight">
            {bookingsThisMonth}
          </p>
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider block mt-1.5">
            Deposits Received
          </span>
        </div>

        {/* Events This Month */}
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('eventsThisMonth')}
            </span>
            <div className="p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-3 tracking-tight">
            {eventsThisMonth}
          </p>
          <span className="text-[10px] premium-gold font-bold uppercase tracking-wider block mt-1.5">
            Weddings Executed
          </span>
        </div>

        {/* Monthly Revenue */}
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('monthlyRevenue')}
            </span>
            <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <MoneyValue amount={monthlyRevenue} className="mt-3 text-[clamp(1.25rem,5vw,1.5rem)] font-black text-slate-900 dark:text-white tracking-tight" />
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1 mt-1.5">
            <ArrowUpRight className="w-3 h-3" />
            Active month billing
          </span>
        </div>

        {/* Direct Order Costs */}
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {language === 'ar' ? 'تكاليف الأوردرات' : 'Order Costs'}
            </span>
            <div className="p-2 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-lg">
              <TrendingDown className="w-4 h-4" />
            </div>
          </div>
          <MoneyValue amount={monthlyOrderExpenses} className="mt-3 text-[clamp(1.25rem,5vw,1.5rem)] font-black text-slate-900 dark:text-white tracking-tight" />
          <span className="text-[10px] text-rose-500 font-bold uppercase tracking-wider block mt-1.5">
            {language === 'ar' ? 'تكاليف مرتبطة بالأوردرات فقط' : 'Direct order costs only'}
          </span>
        </div>

        {/* Net Profit */}
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('netProfit')}
            </span>
            <div className="p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <MoneyValue amount={netProfit} className="mt-3 text-[clamp(1.25rem,5vw,1.5rem)] font-black premium-gold tracking-tight" />
          <span className="text-[10px] premium-gold font-bold uppercase tracking-wider block mt-1.5">
            {language === 'ar' ? 'ربح الأوردرات فقط' : 'Orders profit only'}
          </span>
        </div>

        {/* Total Orders */}
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:shadow-sm transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('totalOrders')}
            </span>
            <div className="p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg">
              <ClipboardList className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-3 tracking-tight">
            {totalOrdersCount}
          </p>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-1.5">
            <span className="text-amber-600">{pendingOrdersCount} {t('pendingOrders')}</span>
            <span>•</span>
            <span className="text-emerald-600">{completedOrdersCount} {t('completedOrders')}</span>
          </div>
        </div>
      </div>

      {/* Visual Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bar Chart: Revenue vs Expenses */}
        <div className="lg:col-span-2 p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-bold uppercase tracking-tight text-slate-900 dark:text-white text-sm">
                {t('revenueVsExpenses')}
              </h3>
              <p className="text-[11px] text-slate-400">6-Month Financial Trend</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-semibold uppercase text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500"></span>
                <span className="text-[10px]">{t('monthlyRevenue')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-rose-500"></span>
                <span className="text-[10px]">{language === 'ar' ? 'تكاليف الأوردرات' : 'Order Costs'}</span>
              </div>
            </div>
          </div>

          {/* SVG Bar Chart */}
          <div className="h-56 w-full flex items-end justify-between gap-3 pt-6 border-b border-slate-100 dark:border-slate-800 pb-2">
            {monthsData.map((m, idx) => {
              const revHeight = Math.max(10, Math.round((m.rev / maxVal) * 100));
              const expHeight = Math.max(10, Math.round((m.exp / maxVal) * 100));

              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                  <div className="w-full flex items-end justify-center gap-1.5 h-full">
                    {/* Revenue Bar */}
                    <div
                      style={{ height: `${revHeight}%` }}
                      className="w-1/2 max-w-[18px] bg-emerald-500 hover:bg-emerald-400 rounded-t transition-all relative group/bar"
                    >
                      <span className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] py-0.5 px-1.5 rounded opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 font-bold">
                        <MoneyValue amount={m.rev} fit={false} className="text-[10px]" />
                      </span>
                    </div>

                    {/* Expense Bar */}
                    <div
                      style={{ height: `${expHeight}%` }}
                      className="w-1/2 max-w-[18px] bg-rose-500 hover:bg-rose-400 rounded-t transition-all relative group/bar"
                    >
                      <span className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] py-0.5 px-1.5 rounded opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 font-bold">
                        <MoneyValue amount={m.exp} fit={false} className="text-[10px]" />
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                    {m.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Orders by Status Cards */}
        <div className="p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <h3 className="font-bold uppercase tracking-tight text-slate-900 dark:text-white text-sm mb-4">
            {t('ordersByStatus')}
          </h3>

          <div className="space-y-2.5 my-auto">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg flex items-center justify-between border border-slate-200/80 dark:border-slate-700/60">
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-bold uppercase text-slate-800 dark:text-slate-200">
                  {t('statusPending')}
                </span>
              </div>
              <span className="text-xs font-black px-2 py-0.5 bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 rounded uppercase">
                {statusCounts.pending}
              </span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg flex items-center justify-between border border-slate-200/80 dark:border-slate-700/60">
              <div className="flex items-center gap-2.5">
                <Calendar className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-bold uppercase text-slate-800 dark:text-slate-200">
                  {t('statusConfirmed')}
                </span>
              </div>
              <span className="text-xs font-black px-2 py-0.5 bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 rounded uppercase">
                {statusCounts.confirmed}
              </span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg flex items-center justify-between border border-slate-200/80 dark:border-slate-700/60">
              <div className="flex items-center gap-2.5">
                <Boxes className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-bold uppercase text-slate-800 dark:text-slate-200">
                  {t('statusInProgress')}
                </span>
              </div>
              <span className="text-xs font-black px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 rounded uppercase">
                {statusCounts.in_progress}
              </span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg flex items-center justify-between border border-slate-200/80 dark:border-slate-700/60">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-bold uppercase text-slate-800 dark:text-slate-200">
                  {t('statusCompleted')}
                </span>
              </div>
              <span className="text-xs font-black px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 rounded uppercase">
                {statusCounts.completed}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tables Row: Upcoming Weddings & Low Inventory */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Weddings */}
        <div className="lg:col-span-2 p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold uppercase tracking-tight text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-500" />
              <span>{t('upcomingWeddingsTitle')}</span>
            </h3>
            <button
              onClick={() => onNavigate('calendar')}
              className="text-xs font-bold uppercase text-amber-600 dark:text-amber-400 hover:underline"
            >
              {t('view')} {t('calendar')}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase font-bold text-[10px] border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3 text-start">{t('orderNumber')}</th>
                  <th className="p-3 text-start">{t('customerName')}</th>
                  <th className="p-3 text-start">{t('weddingDate')}</th>
                  <th className="p-3 text-start">{t('eventLocation')}</th>
                  <th className="p-3 text-start">{t('remainingBalance')}</th>
                  <th className="p-3 text-start">{t('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {upcomingWeddings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400 font-medium">
                      {language === 'ar' ? 'لا توجد طلبات حتى الآن' : 'No orders yet'}
                    </td>
                  </tr>
                ) : (
                  upcomingWeddings.slice(0, 5).map((ord) => (
                    <tr
                      key={ord.id}
                      onClick={() => onNavigate('orders', ord.id)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                    >
                      <td className="p-3 font-extrabold text-amber-600 dark:text-amber-400 uppercase">
                        <span className="inline-flex items-center gap-1.5">
                          {ord.orderNumber}
                          {profile?.role !== 'worker' && <OrderSourceBadge source={ord.orderSource} language={language} compact />}
                        </span>
                      </td>
                      <td className="p-3 font-semibold text-slate-900 dark:text-white">
                        {ord.customerName}
                      </td>
                      <td className="p-3 text-slate-500 font-mono">{ord.weddingDate}</td>
                      <td className="p-3 text-slate-500 max-w-[150px] truncate">
                        {ord.eventLocation}
                      </td>
                      <td className="p-3 text-end font-bold text-slate-900 dark:text-white">
                        <MoneyValue amount={ord.remainingBalance} />
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300">
                          {getOrderStatusLabel(ord.orderStatus, t)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Low Inventory Alerts Box */}
        <div className="p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold uppercase tracking-tight text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500" />
              <span>{t('lowInventoryAlerts')}</span>
            </h3>
            <button
              onClick={() => onNavigate('inventory')}
              className="text-xs font-bold uppercase text-rose-600 dark:text-rose-400 hover:underline"
            >
              {t('inventory')}
            </button>
          </div>

          <div className="space-y-3">
            {lowInventoryItems.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">
                {language === 'ar' ? 'لا توجد عناصر بالمخزن' : 'No inventory items'}
              </p>
            ) : (
              lowInventoryItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => onNavigate('inventory', item.id)}
                  className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.nameEn}
                        className="w-8 h-8 rounded object-cover border border-slate-200 dark:border-slate-700"
                      />
                    ) : (
                      <Boxes className="w-5 h-5 text-rose-500" />
                    )}
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-[120px]">
                        {language === 'ar' ? item.nameAr : item.nameEn}
                      </p>
                      <span className="text-[10px] text-slate-400">
                        {t('storageLocation')}: {item.storageLocation}
                      </span>
                    </div>
                  </div>
                  <div className="text-end">
                    <span className="text-xs font-black text-rose-600 dark:text-rose-400 block uppercase">
                      {item.availableQuantity} left
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Min: {item.minStockLevel}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
