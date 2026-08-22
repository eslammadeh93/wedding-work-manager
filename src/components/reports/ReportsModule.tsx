import React, { useState } from 'react';
import {
  BarChart3,
  Download,
  FileSpreadsheet,
  FileText,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Boxes,
  ClipboardList,
  Calendar,
  ReceiptText,
  WalletCards,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { completedOrderFulfillmentCosts, recordedOrderPayment } from '../../utils/orderPayments';
import { calculateMonthlyCash } from '../../utils/monthlyCash';
import { getOrderStatusLabel } from '../../utils/orderStatus';
import { getOrderSourceLabel } from '../orders/OrderSourceBadge';
import { formatMoney, MoneyValue } from '../ui/MoneyValue';

export const ReportsModule: React.FC = () => {
  const { t, language } = useLanguage();
  const { orders, expenses, inventory, settings } = useData();

  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const reportDateBasis: 'event' = 'event';

  // Filtered orders & company finances by month/year & date basis
  const reportOrders = orders.filter((o) => {
    const targetDateStr = o.eventDate || o.weddingDate;
    const d = new Date(targetDateStr);
    return d.getFullYear() === selectedYear && d.getMonth() === selectedMonth;
  });

  const monthExpenses = expenses.filter((e) => {
    const d = new Date(e.date);
    return d.getFullYear() === selectedYear && d.getMonth() === selectedMonth;
  });

  const monthCapitalList = monthExpenses.filter((e) => e.type === 'capital' || e.category === 'رأس مال');
  const monthGeneralExpensesList = monthExpenses.filter((e) => e.type !== 'capital' && e.category !== 'رأس مال');

  const monthCapital = monthCapitalList.reduce((sum, e) => sum + e.amount, 0);
  const monthGeneralExpenses = monthGeneralExpensesList.reduce((sum, e) => sum + e.amount, 0);
  const cashSummary = calculateMonthlyCash(orders, expenses, selectedYear, selectedMonth);
  const selectedMonthName = new Date(selectedYear, selectedMonth, 1).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' });

  // Category breakdown of General Expenses
  const categoryBreakdown: Record<string, number> = {};
  monthGeneralExpensesList.forEach((exp) => {
    const cat = exp.category || 'عام';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + exp.amount;
  });

  const totalRevenue = reportOrders.reduce((sum, o) => sum + o.totalPrice, 0);
  const averageOrderPrice = reportOrders.length > 0 ? totalRevenue / reportOrders.length : 0;
  const totalPaidRevenue = reportOrders.reduce((sum, order) => sum + recordedOrderPayment(order), 0);
  const totalOrderExpenses = reportOrders.reduce((sum, order) => sum + completedOrderFulfillmentCosts(order) + (order.otherExpenses || 0), 0);
  // Actual collected cash less direct costs that have been recognized for orders.
  const netCollectedCash = totalPaidRevenue - totalOrderExpenses;
  // Keep order profitability completely separate from company capital and
  // operating expenses. The latter are shown in their own financial ledger.
  const netProfit = totalRevenue - totalOrderExpenses;

  // Top Rented Inventory Items count
  const itemUsageMap: Record<string, number> = {};
  orders.forEach((ord) => {
    if (ord.reservedItems) {
      ord.reservedItems.forEach((res) => {
        itemUsageMap[res.inventoryItemName] = (itemUsageMap[res.inventoryItemName] || 0) + res.quantity;
      });
    }
  });

  const topRentedItems = Object.entries(itemUsageMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // PDF Export Function
  const handleExportPdf = () => {
    const doc = new jsPDF();

    const title = language === 'ar' ? settings.companyNameAr : settings.companyNameEn;
    doc.setFontSize(16);
    doc.text(title, 14, 20);

    doc.setFontSize(12);
    doc.text(`Financial & Operations Report - ${selectedMonth + 1}/${selectedYear}`, 14, 30);

    // Summary Table
    autoTable(doc, {
      startY: 40,
      head: [['Metric', 'Amount ($)']],
      body: [
        ['Cash collected from completed orders', `$${cashSummary.collectedFromCompletedOrders.toLocaleString()}`],
        ['Advance collections from upcoming orders', `$${cashSummary.advancesFromUpcomingOrders.toLocaleString()}`],
        ['Retained deposits from cancelled orders', `$${cashSummary.retainedCancelledDeposits.toLocaleString()}`],
        ['Capital added', `$${cashSummary.capitalAdded.toLocaleString()}`],
        ['Operating expenses paid', `$${cashSummary.operatingExpenses.toLocaleString()}`],
        ['Completed order costs', `$${cashSummary.completedOrderCosts.toLocaleString()}`],
        ['Expected order-only cash in safe at month end', `$${cashSummary.orderCashBalanceToDate.toLocaleString()}`],
        ['Expected safe balance at month end', `$${cashSummary.expectedSafeBalance.toLocaleString()}`],
        ['Order Profit (before company expenses)', `$${netProfit.toLocaleString()}`],
        ['Total Orders Booked', `${reportOrders.length}`],
      ],
    });

    // Orders Details Table
    const lastY = (doc as any).lastAutoTable.finalY + 10;
    doc.text('Monthly Orders Breakdown', 14, lastY);

    autoTable(doc, {
      startY: lastY + 5,
      head: [['Order #', 'Customer', 'Source', 'Executor', 'Location', 'Location Link', 'Wedding Date', 'Total ($)', 'Status']],
      body: reportOrders.map((o) => [
        o.orderNumber,
        o.customerName,
        getOrderSourceLabel(o.orderSource, 'en'),
        o.executorName || '-',
        o.eventLocation,
        o.locationLink || '-',
        o.weddingDate,
        `$${o.totalPrice}`,
        getOrderStatusLabel(o.orderStatus, t),
      ]),
    });

    doc.save(`Wedding_ERP_Report_${selectedYear}_${selectedMonth + 1}.pdf`);
  };

  // Excel Export Function
  const handleExportExcel = () => {
    const summaryData = [
      { Metric: 'Company', Value: settings.companyNameEn },
      { Metric: 'Period', Value: `${selectedMonth + 1}/${selectedYear}` },
      { Metric: 'Cash from completed orders', Value: cashSummary.collectedFromCompletedOrders },
      { Metric: 'Advance cash from upcoming orders', Value: cashSummary.advancesFromUpcomingOrders },
      { Metric: 'Retained deposits from cancelled orders', Value: cashSummary.retainedCancelledDeposits },
      { Metric: 'Capital added', Value: cashSummary.capitalAdded },
      { Metric: 'Operating expenses paid', Value: cashSummary.operatingExpenses },
      { Metric: 'Completed order costs', Value: cashSummary.completedOrderCosts },
      { Metric: 'Expected order-only cash in safe at month end', Value: cashSummary.orderCashBalanceToDate },
      { Metric: 'Expected safe balance', Value: cashSummary.expectedSafeBalance },
      { Metric: 'Order Profit', Value: netProfit },
    ];

    const ordersExportData = reportOrders.map((o) => {
      const orderExp = completedOrderFulfillmentCosts(o) + (o.otherExpenses || 0);
      return {
        'Order Number': o.orderNumber,
        Customer: o.customerName,
        'Order Source': getOrderSourceLabel(o.orderSource, language),
        Phone: o.customerPhone,
        Executor: o.executorName || '',
        'Sales Employee': o.salesEmployee || '',
        'Wedding Date': o.weddingDate,
        'Event Location': o.eventLocation,
        'Installation Location Link': o.locationLink || '',
        'Total Price': o.totalPrice,
        Deposit: o.deposit,
        'Security Deposit': o.securityDeposit || 0,
        'Worker Cost': o.workerCost || 0,
        'Transportation Cost': o.transportationCost || 0,
        'Other Expenses': o.otherExpenses || 0,
        'Total Order Expenses': orderExp,
        'Expected Net Profit': o.totalPrice - orderExp,
        'Remaining Balance': o.remainingBalance,
        'Payment Method': o.paymentMethod || 'InstaPay',
        Status: getOrderStatusLabel(o.orderStatus, t),
      };
    });

    const expensesExportData = monthGeneralExpensesList.map((e) => ({
      Date: e.date,
      Category: e.category,
      Description: e.notes || e.description || '',
      Amount: e.amount,
      AddedBy: e.addedBy || '',
    }));

    const wb = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    const wsOrders = XLSX.utils.json_to_sheet(ordersExportData);
    const wsExpenses = XLSX.utils.json_to_sheet(expensesExportData);

    XLSX.utils.book_append_sheet(wb, wsSummary, 'Financial Summary');
    XLSX.utils.book_append_sheet(wb, wsOrders, 'Orders');
    XLSX.utils.book_append_sheet(wb, wsExpenses, 'Expenses');

    XLSX.writeFile(wb, `Wedding_ERP_Data_${selectedYear}_${selectedMonth + 1}.xlsx`);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-amber-500" />
            <span>{t('reportsTitle')}</span>
          </h2>
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportPdf}
            className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 cursor-pointer transition-colors"
          >
            <FileText className="w-4 h-4" />
            <span>{t('exportPdf')}</span>
          </button>
          <button
            onClick={handleExportExcel}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 cursor-pointer transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{t('exportExcel')}</span>
          </button>
        </div>
      </div>

      {/* Month selector: cash is always calculated by real transaction dates. */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs font-bold text-slate-500 uppercase">{t('reportPeriod')}:</span>

          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white outline-none cursor-pointer"
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <option key={i} value={i}>
                {new Date(2026, i, 1).toLocaleString(language === 'ar' ? 'ar' : 'en-US', {
                  month: 'long',
                })}
              </option>
            ))}
          </select>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white outline-none cursor-pointer"
          >
            {[2024, 2025, 2026, 2027, 2028].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-900/50">
          <ReceiptText className="w-4 h-4" />
          <span>{language === 'ar' ? 'الحساب حسب تاريخ التحصيل أو الصرف الفعلي' : 'Calculated from actual collection and spending dates'}</span>
        </div>
      </div>

      {/* Desktop-first monthly safe snapshot. */}
      <section className="p-5 md:p-6 bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100 rounded-[28px] border border-slate-200 dark:border-[#39272e] shadow-xl space-y-5" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="font-black text-slate-900 dark:text-white text-lg flex items-center gap-2">
              <WalletCards className="w-5 h-5 text-amber-400" />
              <span>{language === 'ar' ? 'حسابات الخزنة والتحصيلات' : 'Safe & Collections Summary'}</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{language === 'ar' ? `حركة النقد الفعلية لشهر ${selectedMonthName}` : `Actual cash movement for ${selectedMonthName}`}</p>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">{language === 'ar' ? 'كل الأرقام تعتمد على التحصيل والصرف المسجّل فعلياً.' : 'All figures use recorded collections and spending.'}</span>
        </div>

        {/* Monthly net: every collection in this period less its recognized order costs. */}
        <div className={`p-6 md:p-7 rounded-2xl border ${cashSummary.netMonthlyCash >= 0 ? 'bg-emerald-500/10 border-emerald-400/30' : 'bg-rose-500/10 border-rose-400/30'} flex flex-col items-center text-center md:flex-row md:items-center md:text-right justify-between gap-4`}>
          <div className="w-full md:w-auto">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white"><WalletCards className="w-5 h-5 text-amber-600 dark:text-amber-300" />{language === 'ar' ? `صافي فلوس الأوردرات لشهر ${selectedMonthName}` : `Net order cash for ${selectedMonthName}`}</div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">{language === 'ar' ? 'العربونات + دفعات السداد + العربونات المحتفظ بها − المصاريف الأخرى للحجوزات − أجور العمال والنقل للأوردرات المكتملة.' : 'Deposits + settlements + retained deposits − booking other expenses − worker and transport costs for completed orders.'}</p>
          </div>
          <MoneyValue amount={cashSummary.netMonthlyCash} className={`self-center max-w-full text-[clamp(1.875rem,9vw,3rem)] font-black tracking-tight ${cashSummary.netMonthlyCash >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[ 
            { label: language === 'ar' ? 'إجمالي الدخل هذا الشهر' : 'Total income this month', value: cashSummary.grossMonthlyIncome, color: 'text-emerald-700 dark:text-emerald-400' },
            { label: language === 'ar' ? 'صافي ربح الأوردرات المكتملة + العربونات المحتفظ بها' : 'Completed order profit + retained deposits', value: cashSummary.completedOrdersNetProfitWithRetainedDeposits, color: cashSummary.completedOrdersNetProfitWithRetainedDeposits >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400' },
            { label: language === 'ar' ? 'إجمالي مقدمات الأوردرات غير المكتملة' : 'Total deposits for uncompleted orders', value: cashSummary.upcomingOrderDepositsPaid, color: 'text-cyan-700 dark:text-cyan-400' },
            { label: language === 'ar' ? 'صافي عربونات الأوردرات غير المكتملة بعد المصاريف الأخرى' : 'Uncompleted order deposits after other expenses', value: cashSummary.upcomingOrderDepositsNet, color: cashSummary.upcomingOrderDepositsNet >= 0 ? 'text-cyan-700 dark:text-cyan-400' : 'text-rose-700 dark:text-rose-400' },
            { label: language === 'ar' ? 'إجمالي مصاريف الأوردرات غير المكتملة' : 'Total upcoming-order expenses', value: cashSummary.totalMonthlyOrderExpenses, color: 'text-rose-700 dark:text-rose-400' },
            { label: language === 'ar' ? 'إجمالي المصاريف الأخرى فقط' : 'Total other expenses only', value: cashSummary.bookedOrderOtherExpenses, color: 'text-orange-700 dark:text-orange-400' },
            { label: language === 'ar' ? 'إجمالي دفعات السداد المنتظرة' : 'Expected settlement payments', value: cashSummary.expectedSettlementPayments, color: 'text-violet-700 dark:text-violet-300' },
            { label: language === 'ar' ? 'إجمالي الربح الصافي للشهر' : 'Total net profit for the month', value: cashSummary.netMonthlyOrderProfit, color: cashSummary.netMonthlyOrderProfit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400' },
          ].map((card) => (
            <div key={card.label} className="min-h-36 min-w-0 p-4 rounded-2xl bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/[0.09] flex flex-col items-center justify-center gap-3 text-center sm:min-h-44 sm:p-5 sm:gap-5">
              <span className="w-full text-sm font-black leading-6 text-slate-800 dark:text-slate-200">{card.label}</span>
              <MoneyValue amount={card.value} className={`max-w-full text-center text-[clamp(1.5rem,2.5vw,2.25rem)] font-black tracking-tight ${card.color}`} />
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800">
          <div><h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2"><ReceiptText className="w-5 h-5 text-emerald-500" />{language === 'ar' ? 'كشف التحصيلات الفعلية' : 'Actual collections ledger'}</h3><p className="text-xs text-slate-500 mt-1">{language === 'ar' ? 'كل دفعة تم استلامها خلال الشهر المختار.' : 'Every customer payment received during the selected month.'}</p></div>
          <MoneyValue amount={cashSummary.collectedFromCompletedOrders + cashSummary.advancesFromUpcomingOrders + cashSummary.retainedCancelledDeposits} className="text-sm font-black text-emerald-600 dark:text-emerald-400" />
        </div>
        {cashSummary.retainedCancelledDeposits > 0 && <p className="px-5 py-2.5 bg-violet-50 text-xs font-bold text-violet-800 dark:bg-violet-950/30 dark:text-violet-200">{language === 'ar' ? `يشمل ${formatMoney(cashSummary.retainedCancelledDeposits)} عربونات محفوظة من طلبات أُلغيت.` : `Includes ${formatMoney(cashSummary.retainedCancelledDeposits)} in retained deposits from cancelled bookings.`}</p>}
        {cashSummary.collections.length === 0 ? <p className="p-8 text-center text-sm text-slate-400">{language === 'ar' ? 'لا توجد تحصيلات مسجلة في هذا الشهر.' : 'No collections recorded this month.'}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-xs text-start"><thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500"><tr><th className="p-3.5 text-start">{language === 'ar' ? 'التاريخ' : 'Date'}</th><th className="p-3.5 text-start">{language === 'ar' ? 'الأوردر / العميل' : 'Order / customer'}</th><th className="p-3.5 text-start">{language === 'ar' ? 'نوع التحصيل' : 'Collection type'}</th><th className="p-3.5 text-start">{language === 'ar' ? 'طريقة الدفع' : 'Method'}</th><th className="p-3.5 text-end">{language === 'ar' ? 'المبلغ' : 'Amount'}</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{cashSummary.collections.map((collection) => <tr key={collection.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40"><td className="p-3.5 font-semibold text-slate-500">{collection.date}</td><td className="p-3.5"><p className="font-bold text-slate-900 dark:text-white">{collection.orderNumber}</p><p className="text-slate-500 mt-0.5">{collection.customerName}</p></td><td className="p-3.5"><span className={`inline-flex px-2.5 py-1 rounded-lg font-bold ${collection.isCompletedOrder ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300'}`}>{collection.isCompletedOrder ? (language === 'ar' ? 'أوردر مكتمل' : 'Completed order') : (language === 'ar' ? 'مقدم أوردر قادم' : 'Upcoming advance')}{collection.isLegacyEstimate ? ` · ${language === 'ar' ? 'تقديري' : 'Estimated'}` : ''}</span></td><td className="p-3.5 text-slate-600 dark:text-slate-300">{collection.method}</td><td className="p-3.5 text-end font-black text-emerald-600 dark:text-emerald-400"><MoneyValue amount={collection.amount} prefix="+" /></td></tr>)}</tbody></table></div>}
        <p className="px-5 py-3 bg-amber-50/70 dark:bg-amber-950/20 text-[11px] leading-5 text-amber-800 dark:text-amber-200">{language === 'ar' ? 'ملاحظة: تكاليف الأوردرات تُخصم عند اكتمال الأوردر وبحسب تاريخ المناسبة، لعدم وجود تاريخ صرف منفصل لكل تكلفة. سجّل المصروفات العامة من صفحة المصروفات حتى يظهر رصيد الخزنة بدقة.' : 'Note: order costs are deducted on the completed event date because individual cost payment dates are not yet stored. Record operating expenses in the expense ledger for an accurate safe balance.'}</p>
      </section>

      {/* Company finance ledger: capital and general expenses */}
      <section className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-500" />
          <span>{language === 'ar' ? 'حسابات رأس المال والمصروفات' : 'Capital & Operating Expenses'}</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 sm:block">
            <div className="flex w-full items-center justify-between gap-3 text-right sm:block">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase block">{t('totalCapital')}</span>
                <span className="text-[11px] text-emerald-600 font-medium mt-1 block">Monthly capital</span>
              </div>
              <MoneyValue amount={monthCapital} className="shrink-0 text-[clamp(1.25rem,5vw,1.5rem)] font-black text-emerald-600 dark:text-emerald-400 sm:mt-2" />
            </div>
          </div>
          <div className="p-5 bg-rose-50/50 dark:bg-rose-950/20 rounded-2xl border border-rose-200 dark:border-rose-900/50 sm:block">
            <div className="flex w-full items-center justify-between gap-3 text-right sm:block">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase block">{t('totalGeneralExpenses')}</span>
                <span className="text-[11px] text-rose-500 font-medium mt-1 block">Company operating expenses</span>
              </div>
              <MoneyValue amount={monthGeneralExpenses} className="shrink-0 text-[clamp(1.25rem,5vw,1.5rem)] font-black text-rose-600 dark:text-rose-400 sm:mt-2" />
            </div>
          </div>
          <div className="p-5 bg-amber-50/50 dark:bg-amber-950/20 rounded-2xl border border-amber-200 dark:border-amber-900/50 sm:block">
            <div className="flex w-full items-center justify-between gap-3 text-right sm:block">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase block">{t('currentCashBalance')}</span>
                <span className="text-[11px] text-slate-400 font-medium mt-1 block">{language === 'ar' ? 'تحصيلات + رأس مال − مصروفات وتنفيذ' : 'Collections + capital − operating and order costs'}</span>
              </div>
              <MoneyValue amount={cashSummary.expectedSafeBalance} className={`shrink-0 text-[clamp(1.25rem,5vw,1.5rem)] font-black sm:mt-2 ${cashSummary.expectedSafeBalance >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`} />
            </div>
          </div>
        </div>
      </section>

      {/* General Expense Categories Breakdown */}
      <div className="p-6 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 className="font-bold text-slate-900 dark:text-white text-base mb-4 flex items-center gap-2">
          <TrendingDown className="w-5 h-5 text-rose-500" />
          <span>{language === 'ar' ? 'تصنيفات المصروفات العامة للشهر المحدد' : 'Monthly General Expenses Breakdown by Category'}</span>
        </h3>

        {Object.keys(categoryBreakdown).length === 0 ? (
          <p className="text-xs text-slate-400 py-4">{t('noData')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(categoryBreakdown).map(([cat, val]) => (
              <div
                key={cat}
                className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200/60 dark:border-slate-700/50 flex items-center justify-between"
              >
                <span className="font-bold text-xs text-slate-800 dark:text-slate-200">{cat}</span>
                <MoneyValue amount={val} className="font-black text-xs text-rose-600 dark:text-rose-400" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top Inventory Rental Equipment */}
      <div className="p-6 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 className="font-bold text-slate-900 dark:text-white text-base mb-4 flex items-center gap-2">
          <Boxes className="w-5 h-5 text-amber-500" />
          <span>{t('topInventoryRented')}</span>
        </h3>

        {topRentedItems.length === 0 ? (
          <p className="text-xs text-slate-400 py-4">No rental statistics recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {topRentedItems.slice(0, 5).map((item, idx) => (
              <div
                key={idx}
                className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold text-xs flex items-center justify-center">
                    #{idx + 1}
                  </span>
                  <span className="font-bold text-xs text-slate-900 dark:text-white">
                    {item.name}
                  </span>
                </div>
                <span className="px-3 py-1 bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 rounded-lg text-xs font-bold">
                  {item.count} units rented
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
