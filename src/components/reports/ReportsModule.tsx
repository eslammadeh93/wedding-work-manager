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
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';

export const ReportsModule: React.FC = () => {
  const { t, language } = useLanguage();
  const { orders, expenses, inventory, settings, totalCapital, totalGeneralExpenses, currentCashBalance } = useData();

  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [reportDateBasis, setReportDateBasis] = useState<'booking' | 'event'>('event');

  // Filtered orders & company finances by month/year & date basis
  const reportOrders = orders.filter((o) => {
    const targetDateStr = reportDateBasis === 'booking' ? (o.bookingDate || o.createdAt) : (o.eventDate || o.weddingDate);
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
  const monthCashBalance = monthCapital - monthGeneralExpenses;

  // Category breakdown of General Expenses
  const categoryBreakdown: Record<string, number> = {};
  monthGeneralExpensesList.forEach((exp) => {
    const cat = exp.category || 'عام';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + exp.amount;
  });

  const totalRevenue = reportOrders.reduce((sum, o) => sum + o.totalPrice, 0);
  const averageOrderPrice = reportOrders.length > 0 ? totalRevenue / reportOrders.length : 0;
  const totalPaidRevenue = reportOrders.reduce((sum, o) => sum + o.deposit + (o.paymentStatus === 'fully_paid' ? o.remainingBalance : 0), 0);
  const totalOrderExpenses = reportOrders.reduce((sum, o) => sum + ((o.workerCost || 0) + (o.transportationCost || 0) + (o.otherExpenses || 0)), 0);
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
        ['Total Order Contracting Revenue', `$${totalRevenue.toLocaleString()}`],
        ['Total Collected Paid Deposits', `$${totalPaidRevenue.toLocaleString()}`],
        ['Total Direct Order Expenses', `$${totalOrderExpenses.toLocaleString()}`],
        ['Total Capital Deposited', `$${monthCapital.toLocaleString()}`],
        ['Total General Expenses', `$${monthGeneralExpenses.toLocaleString()}`],
        ['Current Cash Balance', `$${monthCashBalance.toLocaleString()}`],
        ['Order Profit (before company expenses)', `$${netProfit.toLocaleString()}`],
        ['Total Orders Booked', `${reportOrders.length}`],
      ],
    });

    // Orders Details Table
    const lastY = (doc as any).lastAutoTable.finalY + 10;
    doc.text('Monthly Orders Breakdown', 14, lastY);

    autoTable(doc, {
      startY: lastY + 5,
      head: [['Order #', 'Customer', 'Executor', 'Location', 'Location Link', 'Wedding Date', 'Total ($)', 'Status']],
      body: reportOrders.map((o) => [
        o.orderNumber,
        o.customerName,
        o.executorName || '-',
        o.eventLocation,
        o.locationLink || '-',
        o.weddingDate,
        `$${o.totalPrice}`,
        o.orderStatus,
      ]),
    });

    doc.save(`Wedding_ERP_Report_${selectedYear}_${selectedMonth + 1}.pdf`);
  };

  // Excel Export Function
  const handleExportExcel = () => {
    const summaryData = [
      { Metric: 'Company', Value: settings.companyNameEn },
      { Metric: 'Period', Value: `${selectedMonth + 1}/${selectedYear}` },
      { Metric: 'Total Revenue', Value: totalRevenue },
      { Metric: 'Collected Paid Revenue', Value: totalPaidRevenue },
      { Metric: 'Total Direct Order Expenses', Value: totalOrderExpenses },
      { Metric: 'Total Capital', Value: monthCapital },
      { Metric: 'General Expenses', Value: monthGeneralExpenses },
      { Metric: 'Current Cash Balance', Value: monthCashBalance },
      { Metric: 'Order Profit', Value: netProfit },
    ];

    const ordersExportData = reportOrders.map((o) => {
      const orderExp = (o.workerCost || 0) + (o.transportationCost || 0) + (o.otherExpenses || 0);
      return {
        'Order Number': o.orderNumber,
        Customer: o.customerName,
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
        Status: o.orderStatus,
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

      {/* Date Filter Selectors */}
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

        {/* Date Basis Toggle */}
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
          <span className="text-[11px] font-bold text-slate-500 px-2">Calculate by:</span>
          <button
            onClick={() => setReportDateBasis('event')}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              reportDateBasis === 'event'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <ClipboardList className="w-3.5 h-3.5 inline-block me-1" /> {t('eventDate')}
          </button>
          <button
            onClick={() => setReportDateBasis('booking')}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              reportDateBasis === 'booking'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 inline-block me-1" /> {t('bookingDate')}
          </button>
        </div>
      </div>

      {/* Order accounts: revenue, direct costs, and profit */}
      <section className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-amber-500" />
          <span>{language === 'ar' ? 'حسابات الأوردرات والربحية' : 'Orders & Profitability'}</span>
        </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase">{t('totalPrice')}</span>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-2">
            ${totalRevenue.toLocaleString()}
          </p>
          <span className="text-[11px] text-slate-400 mt-1 block">Contracted Revenue</span>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase">{t('paidAmount')}</span>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-2">
            ${totalPaidRevenue.toLocaleString()}
          </p>
          <span className="text-[11px] text-emerald-600 font-medium mt-1 block">Collected Cash</span>
        </div>
        <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase">
            {language === 'ar' ? 'متوسط سعر الأوردر' : 'Average Order Price'}
          </span>
          <p className="text-2xl font-black text-sky-600 dark:text-sky-400 mt-2">
            ${averageOrderPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          <span className="text-[11px] text-slate-400 font-medium mt-1 block">
            {language === 'ar' ? 'إجمالي قيمة الأوردرات ÷ عدد الأوردرات' : 'Total order value ÷ number of orders'}
          </span>
        </div>
        <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase">{language === 'ar' ? 'تكاليف الأوردرات' : 'Order Costs'}</span>
          <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-2">
            ${totalOrderExpenses.toLocaleString()}
          </p>
          <span className="text-[11px] text-rose-500 font-medium mt-1 block">Direct order costs</span>
        </div>
        <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-semibold text-slate-400 uppercase">{t('netProfit')}</span>
          <p className={`text-2xl font-black mt-2 ${netProfit >= 0 ? 'premium-gold' : 'text-rose-600 dark:text-rose-400'}`}>
            ${netProfit.toLocaleString()}
          </p>
          <span className="text-[11px] text-slate-400 font-medium mt-1 block">Orders only</span>
        </div>
      </div>
      </section>

      {/* Company finance ledger: capital and general expenses */}
      <section className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-500" />
          <span>{language === 'ar' ? 'حسابات رأس المال والمصروفات' : 'Capital & Operating Expenses'}</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-2xl border border-emerald-200 dark:border-emerald-900/50">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">{t('totalCapital')}</span>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-2">${monthCapital.toLocaleString()}</p>
            <span className="text-[11px] text-emerald-600 font-medium mt-1 block">Monthly capital</span>
          </div>
          <div className="p-5 bg-rose-50/50 dark:bg-rose-950/20 rounded-2xl border border-rose-200 dark:border-rose-900/50">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">{t('totalGeneralExpenses')}</span>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-2">${monthGeneralExpenses.toLocaleString()}</p>
            <span className="text-[11px] text-rose-500 font-medium mt-1 block">Company operating expenses</span>
          </div>
          <div className="p-5 bg-amber-50/50 dark:bg-amber-950/20 rounded-2xl border border-amber-200 dark:border-amber-900/50">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">{t('currentCashBalance')}</span>
            <p className={`text-2xl font-black mt-2 ${monthCashBalance >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>${monthCashBalance.toLocaleString()}</p>
            <span className="text-[11px] text-slate-400 font-medium mt-1 block">Capital − expenses</span>
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
                <span className="font-black text-xs text-rose-600 dark:text-rose-400">${val.toLocaleString()}</span>
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
