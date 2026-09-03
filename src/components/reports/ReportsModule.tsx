import React, { useEffect, useMemo, useState } from 'react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
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
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { completedOrderFulfillmentCosts, recordedOrderPayment } from '../../utils/orderPayments';
import { calculateMonthlyCash, orderCashCollections } from '../../utils/monthlyCash';
import { reconcileMonthlyCash } from '../../utils/monthlyCashReconciliation';
import { getOrderStatusLabel } from '../../utils/orderStatus';
import { getOrderSourceLabel } from '../orders/OrderSourceBadge';
import { formatMoney, MoneyValue } from '../ui/MoneyValue';
import { buildCustomerSourceBreakdown, buildMonthlySourceCashNet, buildMonthlyComparison, buildServiceProfitability } from '../../utils/reportInsights';
import { companyDataService } from '../../multiTenant/data/companyDataService';
import { trustedCompanyIdFromSession } from '../../multiTenant/data/useTrustedCompanyId';
import { USE_MULTI_TENANT_DATA } from '../../multiTenant/featureFlags';

type CashCardKey = 'income' | 'completedProfit' | 'retainedDeposits' | 'upcomingDeposits' | 'upcomingDepositsNet' | 'upcomingExpenses' | 'otherExpenses' | 'expectedSettlements' | 'expectedProfit';

interface CashCardDetailItem {
  id: string;
  orderNumber: string;
  customerName: string;
  type: 'deposit' | 'settlement' | 'completed-profit' | 'retained-deposit' | 'upcoming-expense' | 'expected-settlement' | 'expected-profit' | 'capital' | 'operating-expense' | 'completed-order-cost';
  amount: number;
  collectedThisMonth?: number;
  costs?: number;
}

const cashDetailTypeLabel = (type: CashCardDetailItem['type'], language: 'ar' | 'en') => {
  const labels = {
    deposit: language === 'ar' ? 'عربون / مقدم' : 'Deposit / advance',
    settlement: language === 'ar' ? 'دفعة سداد' : 'Settlement payment',
    'completed-profit': language === 'ar' ? 'أوردر مكتمل بعد التكاليف' : 'Completed order after costs',
    'retained-deposit': language === 'ar' ? 'عربون محتفَظ به' : 'Retained deposit',
    'upcoming-expense': language === 'ar' ? 'مصروف أوردر غير مكتمل' : 'Uncompleted-order expense',
    'expected-settlement': language === 'ar' ? 'دفعة سداد متوقعة' : 'Expected settlement',
    'expected-profit': language === 'ar' ? 'ربح متوقع من الأوردر' : 'Expected order profit',
    capital: language === 'ar' ? 'إضافة رأس مال' : 'Capital added',
    'operating-expense': language === 'ar' ? 'مصروف تشغيلي' : 'Operating expense',
    'completed-order-cost': language === 'ar' ? 'تكلفة أوردر منفّذ' : 'Completed-order cost',
  } as const;
  return labels[type];
};

const CashCardDetailsModal: React.FC<{
  title: string;
  total: number;
  items: CashCardDetailItem[];
  language: 'ar' | 'en';
  onClose: () => void;
}> = ({ title, total, items, language, onClose }) => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
    <section role="dialog" aria-modal="true" aria-label={title} dir={language === 'ar' ? 'rtl' : 'ltr'} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl dark:bg-slate-900" onMouseDown={(event) => event.stopPropagation()}>
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white">{title}</h2>
          <p className="mt-1 text-xs text-slate-500">{language === 'ar' ? 'تفاصيل كل أوردر داخل في هذا الرقم.' : 'Every order included in this amount.'}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={language === 'ar' ? 'إغلاق' : 'Close'}><X className="h-5 w-5" /></button>
      </header>
      <div className="space-y-3 p-5">
        {items.length === 0 ? <p className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-500 dark:bg-white/[0.05]">{language === 'ar' ? 'لا توجد أوردرات أو دفعات داخلة في هذا الرقم.' : 'No orders or payments are included in this amount.'}</p> : items.map((item) => {
          const isDeduction = item.amount < 0;
          return <div key={item.id} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="min-w-0">
              <p className="font-black text-slate-900 dark:text-white">{item.orderNumber} <span className="font-normal text-slate-500">— {item.customerName}</span></p>
              <span className="mt-2 inline-flex rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{cashDetailTypeLabel(item.type, language)}</span>
              {item.collectedThisMonth !== undefined && <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                {language === 'ar' ? 'تحصيل هذا الشهر: ' : 'Collected this month: '}<MoneyValue amount={item.collectedThisMonth} fit={false} className="font-black" />
                <span className="mx-1.5">−</span>{language === 'ar' ? 'تكاليف التنفيذ: ' : 'Execution costs: '}<MoneyValue amount={item.costs || 0} fit={false} className="font-black" />
              </p>}
            </div>
            <MoneyValue amount={Math.abs(item.amount)} prefix={isDeduction ? '-' : '+'} className={`shrink-0 text-lg font-black ${isDeduction ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-300'}`} />
          </div>;
        })}
      </div>
      <footer className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <span className="font-black text-slate-900 dark:text-white">{language === 'ar' ? 'إجمالي البطاقة' : 'Card total'}</span>
        <MoneyValue amount={total} className={`text-xl font-black ${total >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`} />
      </footer>
    </section>
  </div>
);

export const ReportsModule: React.FC = () => {
  const { t, language } = useLanguage();
  const { orders, expenses, inventory, settings } = useData();
  const { authSession, profile, isDemo } = useAuth();

  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const reportDateBasis: 'event' = 'event';
  const [reportDataOrders, setReportDataOrders] = useState<typeof orders>([]);
  const [isLoadingReportData, setIsLoadingReportData] = useState(false);
  const [reportDataError, setReportDataError] = useState<string | null>(null);
  const [showCashReview, setShowCashReview] = useState(false);
  const [showNetCashBreakdown, setShowNetCashBreakdown] = useState(false);
  const [selectedCashCard, setSelectedCashCard] = useState<CashCardKey | null>(null);
  const [showSafeBalanceDetails, setShowSafeBalanceDetails] = useState(false);

  const companyId = useMemo(() => {
    if (isDemo || !authSession || profile?.role === 'worker') return null;
    try { return trustedCompanyIdFromSession(authSession); } catch { return null; }
  }, [authSession, isDemo, profile?.role]);
  const usesReportQuery = USE_MULTI_TENANT_DATA && Boolean(companyId);

  useEffect(() => {
    if (!usesReportQuery || !companyId) return;
    let cancelled = false;
    setIsLoadingReportData(true); setReportDataError(null);
    const from = `${selectedYear}-01-01`;
    const to = `${selectedYear}-12-31`;
    void (async () => {
      const collected: typeof orders = [];
      let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
      // Reports are loaded on demand for the selected year, not with the app's
      // initial data. The cap protects the browser if a year is unusually busy.
      for (let page = 0; page < 20; page += 1) {
        const result = await companyDataService.getOrderPage<typeof orders[number]>(companyId, { scope: 'all', pageSize: 100, dateField: 'eventDate', dateFrom: from, dateTo: to, cursor });
        if (!result.success || !result.data) {
          if (!cancelled) setReportDataError(result.message || 'تعذر تحميل بيانات التقرير.');
          break;
        }
        collected.push(...result.data.records);
        if (!result.data.hasMore || !result.data.cursor) break;
        cursor = result.data.cursor;
      }
      if (!cancelled) { setReportDataOrders(collected); setIsLoadingReportData(false); }
    })();
    return () => { cancelled = true; };
  }, [companyId, selectedYear, usesReportQuery]);

  const sourceOrders = usesReportQuery ? reportDataOrders : orders;

  const availableYears = useMemo(() => {
    const years = new Set<number>([new Date().getFullYear()]);
    sourceOrders.forEach((order) => {
      const year = new Date(order.eventDate || order.weddingDate).getFullYear();
      if (Number.isFinite(year)) years.add(year);
    });
    expenses.forEach((expense) => {
      const year = new Date(expense.date).getFullYear();
      if (Number.isFinite(year)) years.add(year);
    });
    return [...years].sort((a, b) => b - a);
  }, [expenses, sourceOrders]);

  // Filtered orders & company finances by month/year & date basis
  const reportOrders = sourceOrders.filter((o) => {
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
  const cashSummary = calculateMonthlyCash(sourceOrders, expenses, selectedYear, selectedMonth);
  const cashReconciliation = useMemo(
    () => reconcileMonthlyCash(sourceOrders, expenses, selectedYear, selectedMonth),
    [expenses, selectedMonth, selectedYear, sourceOrders],
  );
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
  const monthlyComparison = useMemo(() => buildMonthlyComparison(sourceOrders, expenses, selectedYear), [expenses, sourceOrders, selectedYear]);
  const serviceProfitability = useMemo(() => buildServiceProfitability(reportOrders, language), [language, reportOrders]);
  const customerSourceBreakdown = useMemo(() => {
    const sourceCashNet = buildMonthlySourceCashNet(sourceOrders, selectedYear, selectedMonth);
    return buildCustomerSourceBreakdown(reportOrders).map((item) => ({ ...item, netProfit: sourceCashNet[item.source] }));
  }, [reportOrders, selectedMonth, selectedYear, sourceOrders]);
  const comparisonMax = Math.max(...monthlyComparison.map((item) => Math.max(item.revenue, item.directCosts, Math.abs(item.netProfit))), 1);
  const cashCardDetails = useMemo(() => {
    const monthPrefix = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-`;
    const monthEnd = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-31`;
    const inSelectedMonth = (date?: string) => Boolean(date?.startsWith(monthPrefix));
    const amount = (value: number | undefined) => Math.max(0, Number(value) || 0);
    const orderById = new Map(sourceOrders.map((order) => [order.id, order]));
    const isCompletedThisMonth = (order: typeof sourceOrders[number]) => order.orderStatus === 'completed' && inSelectedMonth(order.eventDate || order.weddingDate);
    const isUpcoming = (order: typeof sourceOrders[number]) => order.orderStatus !== 'cancelled'
      && order.orderStatus !== 'cancelled_deposit_retained' && !isCompletedThisMonth(order);
    const collectionDetail = (collection: typeof cashSummary.collections[number]): CashCardDetailItem => ({
      id: collection.id,
      orderNumber: collection.orderNumber,
      customerName: collection.customerName,
      type: collection.isRetainedDeposit ? 'retained-deposit' : collection.paymentType === 'deposit' ? 'deposit' : 'settlement',
      amount: collection.amount,
    });
    const upcomingDepositCollections = cashSummary.collections.filter((collection) => {
      const order = orderById.get(collection.orderId);
      return Boolean(order && isUpcoming(order) && !collection.isRetainedDeposit && collection.paymentType === 'deposit');
    });
    const upcomingExpenseItems = cashSummary.netMonthlyCashBreakdown
      .filter((item) => item.kind === 'upcoming-expense')
      .map((item) => ({ id: item.id, orderNumber: item.orderNumber, customerName: item.customerName, type: 'upcoming-expense' as const, amount: item.amount }));
    const expectedSettlements = sourceOrders
      .filter((order) => order.orderStatus !== 'cancelled' && order.orderStatus !== 'cancelled_deposit_retained' && inSelectedMonth(order.eventDate || order.weddingDate))
      .map((order) => ({
        id: `${order.id}-expected-settlement`, orderNumber: order.orderNumber, customerName: order.customerName,
        type: 'expected-settlement' as const, amount: Math.max(0, amount(order.totalPrice) - recordedOrderPayment(order)),
      }))
      .filter((item) => item.amount > 0);
    const expectedProfitItems = [
      ...sourceOrders
        .filter((order) => order.orderStatus !== 'cancelled' && order.orderStatus !== 'cancelled_deposit_retained' && inSelectedMonth(order.eventDate || order.weddingDate))
        .map((order) => ({
          id: `${order.id}-expected-profit`, orderNumber: order.orderNumber, customerName: order.customerName,
          type: 'expected-profit' as const, amount: amount(order.totalPrice) - amount(order.otherExpenses) - amount(order.workerCost) - amount(order.transportationCost),
        })),
      ...cashSummary.collections
        .filter((collection) => collection.isRetainedDeposit)
        .map((collection) => ({ ...collectionDetail(collection), id: `${collection.id}-expected-profit` })),
      ...sourceOrders
        .filter((order) => order.orderStatus !== 'cancelled' && order.orderStatus !== 'cancelled_deposit_retained'
          && inSelectedMonth(order.bookingDate || order.createdAt) && (order.eventDate || order.weddingDate || '') > monthEnd)
        .flatMap((order) => orderCashCollections(order)
          .filter((collection) => inSelectedMonth(collection.date) && collection.paymentType === 'deposit')
          .map((collection) => ({ ...collectionDetail(collection), id: `${collection.id}-future-profit` }))),
    ];

    return {
      income: cashSummary.collections.map(collectionDetail),
      completedProfit: cashSummary.netMonthlyCashBreakdown
        .filter((item) => item.kind === 'completed-order')
        .map((item) => ({ id: item.id, orderNumber: item.orderNumber, customerName: item.customerName, type: 'completed-profit' as const, amount: item.amount, collectedThisMonth: item.collectedThisMonth, costs: item.completedOrderCosts })),
      retainedDeposits: cashSummary.collections.filter((collection) => collection.isRetainedDeposit).map(collectionDetail),
      upcomingDeposits: upcomingDepositCollections.map(collectionDetail),
      upcomingDepositsNet: [...upcomingDepositCollections.map(collectionDetail), ...upcomingExpenseItems],
      upcomingExpenses: upcomingExpenseItems,
      otherExpenses: upcomingExpenseItems,
      expectedSettlements,
      expectedProfit: expectedProfitItems,
    } satisfies Record<CashCardKey, CashCardDetailItem[]>;
  }, [cashSummary, selectedMonth, selectedYear, sourceOrders]);
  const safeBalanceDetails = useMemo<CashCardDetailItem[]>(() => {
    const monthEnd = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-31`;
    const isOnOrBeforeMonthEnd = (date?: string) => Boolean(date && date.slice(0, 10) <= monthEnd);
    const amount = (value: number | undefined) => Math.max(0, Number(value) || 0);
    const isCapital = (entry: typeof expenses[number]) => entry.type === 'capital' || entry.category === 'رأس مال';

    return [
      ...sourceOrders
        .filter((order) => order.orderStatus !== 'cancelled')
        .flatMap((order) => orderCashCollections(order))
        .filter((collection) => isOnOrBeforeMonthEnd(collection.date))
        .map((collection) => ({
          id: `safe-${collection.id}`, orderNumber: collection.orderNumber, customerName: collection.customerName,
          type: collection.isRetainedDeposit ? 'retained-deposit' as const : collection.paymentType === 'deposit' ? 'deposit' as const : 'settlement' as const,
          amount: collection.amount,
        })),
      ...expenses
        .filter((entry) => isCapital(entry) && isOnOrBeforeMonthEnd(entry.date))
        .map((entry) => ({ id: `safe-capital-${entry.id}`, orderNumber: language === 'ar' ? 'رأس المال' : 'Capital', customerName: entry.notes || entry.description || '—', type: 'capital' as const, amount: amount(entry.amount) })),
      ...expenses
        .filter((entry) => !isCapital(entry) && isOnOrBeforeMonthEnd(entry.date))
        .map((entry) => ({ id: `safe-expense-${entry.id}`, orderNumber: entry.category || (language === 'ar' ? 'مصروف تشغيلي' : 'Operating expense'), customerName: entry.notes || entry.description || '—', type: 'operating-expense' as const, amount: -amount(entry.amount) })),
      ...sourceOrders
        .filter((order) => order.orderStatus === 'completed' && isOnOrBeforeMonthEnd(order.eventDate || order.weddingDate))
        .map((order) => ({ id: `safe-completed-cost-${order.id}`, orderNumber: order.orderNumber, customerName: order.customerName, type: 'completed-order-cost' as const, amount: -(completedOrderFulfillmentCosts(order) + amount(order.otherExpenses)) }))
        .filter((item) => item.amount < 0),
      ...sourceOrders
        .filter((order) => order.orderStatus !== 'completed' && order.orderStatus !== 'cancelled' && order.orderStatus !== 'cancelled_deposit_retained' && isOnOrBeforeMonthEnd(order.eventDate || order.weddingDate) && amount(order.otherExpenses) > 0)
        .map((order) => ({ id: `safe-upcoming-cost-${order.id}`, orderNumber: order.orderNumber, customerName: order.customerName, type: 'upcoming-expense' as const, amount: -amount(order.otherExpenses) })),
    ];
  }, [expenses, language, selectedMonth, selectedYear, sourceOrders]);

  // Top Rented Inventory Items count
  const itemUsageMap: Record<string, number> = {};
  sourceOrders.forEach((ord) => {
    if (ord.reservedItems) {
      ord.reservedItems.forEach((res) => {
        itemUsageMap[res.inventoryItemName] = (itemUsageMap[res.inventoryItemName] || 0) + res.quantity;
      });
    }
  });

  const topRentedItems = Object.entries(itemUsageMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const cashCards = [
    { key: 'income' as const, label: language === 'ar' ? 'إجمالي الدخل هذا الشهر' : 'Total income this month', value: cashSummary.grossMonthlyIncome, color: 'text-emerald-700 dark:text-emerald-400' },
    { key: 'completedProfit' as const, label: language === 'ar' ? 'صافي ربح الأوردرات المكتملة' : 'Completed order net profit', value: cashSummary.completedOrdersNetProfit, color: cashSummary.completedOrdersNetProfit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400' },
    { key: 'retainedDeposits' as const, label: language === 'ar' ? 'عربونات أوردرات ملغاة محتفَظ بها' : 'Retained deposits from cancelled orders', value: cashSummary.retainedCancelledDeposits, color: 'text-violet-700 dark:text-violet-300' },
    { key: 'upcomingDeposits' as const, label: language === 'ar' ? 'إجمالي مقدمات الأوردرات غير المكتملة' : 'Total deposits for uncompleted orders', value: cashSummary.upcomingOrderDepositsPaid, color: 'text-cyan-700 dark:text-cyan-400' },
    { key: 'upcomingDepositsNet' as const, label: language === 'ar' ? 'صافي عربونات الأوردرات غير المكتملة بعد المصاريف الأخرى' : 'Uncompleted order deposits after other expenses', value: cashSummary.upcomingOrderDepositsNet, color: cashSummary.upcomingOrderDepositsNet >= 0 ? 'text-cyan-700 dark:text-cyan-400' : 'text-rose-700 dark:text-rose-400' },
    { key: 'upcomingExpenses' as const, label: language === 'ar' ? 'إجمالي مصاريف الأوردرات غير المكتملة' : 'Total upcoming-order expenses', value: cashSummary.totalMonthlyOrderExpenses, color: 'text-rose-700 dark:text-rose-400' },
    { key: 'otherExpenses' as const, label: language === 'ar' ? 'إجمالي المصاريف الأخرى فقط' : 'Total other expenses only', value: cashSummary.bookedOrderOtherExpenses, color: 'text-orange-700 dark:text-orange-400' },
    { key: 'expectedSettlements' as const, label: language === 'ar' ? 'إجمالي دفعات السداد المنتظرة' : 'Expected settlement payments', value: cashSummary.expectedSettlementPayments, color: 'text-violet-700 dark:text-violet-300' },
    { key: 'expectedProfit' as const, label: language === 'ar' ? 'الربح المتوقع خلال الشهر' : 'Expected profit by month end', value: cashSummary.netMonthlyOrderProfit, color: cashSummary.netMonthlyOrderProfit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400' },
  ];
  const activeCashCard = selectedCashCard ? cashCards.find((card) => card.key === selectedCashCard) : null;

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
        ['Completed order net profit', `$${cashSummary.completedOrdersNetProfit.toLocaleString()}`],
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
    const comparisonExportData = monthlyComparison.map((item) => ({
      Month: new Date(selectedYear, item.month, 1).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US', { month: 'long' }),
      Orders: item.orderCount, Revenue: item.revenue, 'Direct costs': item.directCosts, 'Order net profit': item.netProfit, 'Operating expenses': item.operatingExpenses,
    }));
    const servicesExportData = serviceProfitability.map((item) => ({ Service: item.service, Orders: item.orderCount, Revenue: item.revenue, 'Direct costs': item.directCosts, 'Estimated net profit': item.netProfit }));
    const sourcesExportData = customerSourceBreakdown.map((item) => ({ Source: getOrderSourceLabel(item.source, language), Orders: item.orderCount, Revenue: item.revenue, Collected: item.collected, 'Estimated net profit': item.netProfit }));

    const wb = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    const wsOrders = XLSX.utils.json_to_sheet(ordersExportData);
    const wsExpenses = XLSX.utils.json_to_sheet(expensesExportData);
    const wsComparison = XLSX.utils.json_to_sheet(comparisonExportData);
    const wsServices = XLSX.utils.json_to_sheet(servicesExportData);
    const wsSources = XLSX.utils.json_to_sheet(sourcesExportData);

    XLSX.utils.book_append_sheet(wb, wsSummary, 'Financial Summary');
    XLSX.utils.book_append_sheet(wb, wsOrders, 'Orders');
    XLSX.utils.book_append_sheet(wb, wsExpenses, 'Expenses');
    XLSX.utils.book_append_sheet(wb, wsComparison, 'Monthly comparison');
    XLSX.utils.book_append_sheet(wb, wsServices, 'Service profitability');
    XLSX.utils.book_append_sheet(wb, wsSources, 'Customer sources');

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
            onChange={(e) => { setSelectedMonth(Number(e.target.value)); setShowCashReview(false); setSelectedCashCard(null); }}
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
            onChange={(e) => { setSelectedYear(Number(e.target.value)); setShowCashReview(false); setSelectedCashCard(null); }}
            className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white outline-none cursor-pointer"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-900/50">
          <ReceiptText className="w-4 h-4" />
          <span>{isLoadingReportData ? (language === 'ar' ? 'جارٍ تحميل بيانات السنة...' : 'Loading year data...') : (language === 'ar' ? 'الحساب حسب تاريخ التحصيل أو الصرف الفعلي' : 'Calculated from actual collection and spending dates')}</span>
        </div>
        {reportDataError && <p role="alert" className="w-full text-xs font-bold text-rose-600 dark:text-rose-400">{reportDataError}</p>}
      </div>

      {/* Growth and profitability insights for the selected year/month. */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-start justify-between gap-3 mb-5">
            <div>
              <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-500" />{language === 'ar' ? 'مقارنة الأشهر' : 'Monthly comparison'}</h3>
              <p className="text-xs text-slate-500 mt-1">{language === 'ar' ? `الإيراد والتكلفة وصافي ربح الأوردرات خلال ${selectedYear}` : `Order revenue, cost, and net profit in ${selectedYear}`}</p>
            </div>
            <span className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">{selectedYear}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {monthlyComparison.map((item) => {
              const label = new Date(selectedYear, item.month, 1).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US', { month: 'short' });
              const revenueWidth = Math.max(item.revenue ? 5 : 0, Math.round((item.revenue / comparisonMax) * 100));
              const costWidth = Math.max(item.directCosts ? 5 : 0, Math.round((item.directCosts / comparisonMax) * 100));
              return <div key={item.month} className="p-3 rounded-2xl border border-slate-100 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40">
                <div className="flex items-center justify-between text-[11px] font-black text-slate-700 dark:text-slate-200"><span>{label}</span><span>{item.orderCount}</span></div>
                <div className="mt-3 space-y-1.5">
                  <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${revenueWidth}%` }} /></div>
                  <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-rose-500 rounded-full" style={{ width: `${costWidth}%` }} /></div>
                </div>
                <MoneyValue amount={item.netProfit} className={`mt-2 block text-xs font-black ${item.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} />
              </div>;
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-[10px] font-bold text-slate-500"><span className="inline-flex items-center gap-1"><i className="w-2 h-2 bg-emerald-500 rounded-full" />{language === 'ar' ? 'الإيراد' : 'Revenue'}</span><span className="inline-flex items-center gap-1"><i className="w-2 h-2 bg-rose-500 rounded-full" />{language === 'ar' ? 'التكاليف المباشرة' : 'Direct costs'}</span><span>{language === 'ar' ? 'الرقم أسفل كل شهر = صافي ربح الأوردرات.' : 'The number under each month is order net profit.'}</span></div>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="mb-5"><h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2"><ClipboardList className="w-5 h-5 text-violet-500" />{language === 'ar' ? 'ربحية أنواع الخدمات' : 'Service profitability'}</h3><p className="text-xs text-slate-500 mt-1">{language === 'ar' ? 'حسب خدمات الموردين المسجلة في أوردرات الشهر.' : 'Based on supplier service lines recorded on this month’s orders.'}</p></div>
          {serviceProfitability.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">{t('noData')}</p> : <div className="space-y-2.5">{serviceProfitability.map((item) => <div key={item.service} className="p-3.5 rounded-2xl border border-slate-100 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40 flex items-center justify-between gap-3"><div className="min-w-0"><p className="font-black text-sm text-slate-800 dark:text-white truncate">{item.service}</p><p className="mt-1 text-[11px] text-slate-500">{item.orderCount} {language === 'ar' ? 'أوردر' : 'orders'} · {language === 'ar' ? 'إيراد' : 'Revenue'} {formatMoney(item.revenue)}</p></div><MoneyValue amount={item.netProfit} className={`shrink-0 text-sm font-black ${item.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} /></div>)}</div>}
          <p className="mt-4 text-[10px] leading-5 text-violet-700 dark:text-violet-300">{language === 'ar' ? 'في الأوردر الذي يحتوي أكثر من نوع خدمة، يتم توزيع الإيراد والتكاليف المباشرة بالتساوي كتقدير حتى تتوفر أسعار منفصلة لكل خدمة.' : 'For orders with multiple service types, revenue and direct costs are allocated equally until per-service prices are available.'}</p>
        </div>
      </section>

      <section className="p-5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="mb-5"><h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2"><ReceiptText className="w-5 h-5 text-amber-500" />{language === 'ar' ? 'مصادر العملاء' : 'Customer sources'}</h3><p className="text-xs text-slate-500 mt-1">{language === 'ar' ? 'الأوردرات حسب مصدرها، وصافي النقد محسوب بنفس قواعد الخزنة للشهر المحدد.' : 'Orders by lead source; net cash uses the same monthly rules as the safe summary.'}</p></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{customerSourceBreakdown.map((item) => <div key={item.source} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/40"><div className="flex items-center justify-between gap-2"><span className="font-black text-sm text-slate-900 dark:text-white">{getOrderSourceLabel(item.source, language)}</span><span className="text-xs font-black px-2 py-1 rounded-lg bg-white dark:bg-slate-900">{item.orderCount}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><p className="text-slate-500">{language === 'ar' ? 'الإيراد' : 'Revenue'}</p><MoneyValue amount={item.revenue} className="mt-1 text-sm font-black text-slate-800 dark:text-white" /></div><div><p className="text-slate-500">{language === 'ar' ? 'المحصّل' : 'Collected'}</p><MoneyValue amount={item.collected} className="mt-1 text-sm font-black text-emerald-600 dark:text-emerald-400" /></div></div><div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between text-xs"><span className="text-slate-500">{language === 'ar' ? 'صافي النقد' : 'Net cash'}</span><MoneyValue amount={item.netProfit} className={`font-black ${item.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} /></div></div>)}</div>
      </section>

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
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">{language === 'ar' ? 'كل الأرقام تعتمد على التحصيل والصرف المسجّل فعلياً.' : 'All figures use recorded collections and spending.'}</span>
            <button
              type="button"
              onClick={() => setShowCashReview(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-black text-white transition-colors hover:bg-slate-700 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300"
            >
              <RefreshCw className="w-4 h-4" />
              {language === 'ar' ? 'إعادة حساب ومراجعة الشهر' : 'Recalculate & review month'}
            </button>
          </div>
        </div>

        {showCashReview && <div className={`rounded-2xl border p-4 md:p-5 ${Math.abs(cashReconciliation.difference) < 0.01 && cashReconciliation.issues.length === 0 ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20' : 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20'}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-2.5">
              {Math.abs(cashReconciliation.difference) < 0.01 && cashReconciliation.issues.length === 0
                ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />}
              <div>
                <h4 className="font-black text-slate-900 dark:text-white">{language === 'ar' ? `نتيجة مراجعة ${selectedMonthName}` : `${selectedMonthName} review result`}</h4>
                <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                  {Math.abs(cashReconciliation.difference) < 0.01
                    ? (language === 'ar' ? 'صافي فلوس الأوردرات مطابق للربح المتوقع.' : 'Net order cash matches expected profit.')
                    : (cashReconciliation.difference > 0
                      ? (language === 'ar' ? 'الربح المتوقع أعلى من صافي الفلوس المحصّلة.' : 'Expected profit is higher than net collected cash.')
                      : (language === 'ar' ? 'صافي الفلوس المحصّلة أعلى من الربح المتوقع.' : 'Net collected cash is higher than expected profit.'))}
                </p>
              </div>
            </div>
            <div className="shrink-0 text-start sm:text-end">
              <p className="text-[11px] font-bold text-slate-500">{language === 'ar' ? 'الفرق بين الرقمين' : 'Difference'}</p>
              <MoneyValue amount={Math.abs(cashReconciliation.difference)} className={`mt-1 block text-xl font-black ${Math.abs(cashReconciliation.difference) < 0.01 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`} />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-white/70 px-3 py-2.5 dark:bg-slate-950/30"><p className="text-[10px] font-bold text-slate-500">{language === 'ar' ? 'صافي الفلوس المحسوبة للشهر' : 'Net cash counted this month'}</p><MoneyValue amount={cashReconciliation.netOrderCash} className="mt-1 block text-base font-black text-emerald-700 dark:text-emerald-300" /></div>
            <div className="rounded-xl bg-white/70 px-3 py-2.5 dark:bg-slate-950/30"><p className="text-[10px] font-bold text-slate-500">{language === 'ar' ? 'الربح المتوقع للأوردرات' : 'Expected order profit'}</p><MoneyValue amount={cashReconciliation.expectedProfit} className="mt-1 block text-base font-black text-slate-800 dark:text-slate-100" /></div>
            <div className="rounded-xl bg-white/70 px-3 py-2.5 dark:bg-slate-950/30"><p className="text-[10px] font-bold text-slate-500">{language === 'ar' ? 'المبلغ غير المتطابق' : 'Amount not matching'}</p><MoneyValue amount={Math.abs(cashReconciliation.difference)} className="mt-1 block text-base font-black text-amber-700 dark:text-amber-300" /></div>
          </div>

          {Math.abs(cashReconciliation.difference) > 0.01 && <p className="mt-3 rounded-xl bg-amber-100/70 px-3 py-2.5 text-xs leading-5 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            {language === 'ar'
              ? 'المعنى ببساطة: الربح المتوقع يحسب قيمة وربح الأوردر كاملًا لو موعده في هذا الشهر، بينما صافي الفلوس يحسب ما تم تحصيله وصرفه فعليًا. لذلك الفرق غالبًا فلوس متبقية لم تُحصّل بعد، أو تكلفة/دفعة تحتاج مراجعة.'
              : 'Simply: expected profit counts the full planned profit of orders scheduled this month, while net cash counts only money actually collected and spent. The gap is usually an unpaid balance or a payment/cost needing review.'}
          </p>}

          {cashReconciliation.items.length > 0 && <div className="mt-4 border-t border-amber-200/80 pt-4 dark:border-amber-900/60">
            <p className="mb-1 text-xs font-black text-slate-800 dark:text-slate-100">{language === 'ar' ? 'الأوردرات المسببة للفرق — بالتفصيل' : 'Orders causing the difference — details'}</p>
            <p className="mb-2 text-[11px] leading-5 text-slate-500">{language === 'ar' ? 'قارن لكل أوردر بين الربح المتوقع منه والفلوس التي دخلت فعليًا في حساب هذا الشهر.' : 'Compare each order’s expected profit with the cash that actually entered this month’s calculation.'}</p>
            <div className="space-y-2">
              {cashReconciliation.items.slice(0, 6).map(item => <div key={item.orderId} className="rounded-xl bg-white/70 px-3 py-3 text-xs dark:bg-slate-950/30">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4"><span className="font-black text-slate-800 dark:text-slate-100">{item.orderNumber} <span className="font-normal text-slate-500">— {item.customerName}</span></span><span className="font-black text-amber-700 dark:text-amber-300">{language === 'ar' ? 'الفرق:' : 'Difference:'} <MoneyValue amount={Math.abs(item.difference)} className="ms-1 font-black" /></span></div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div><p className="text-[10px] text-slate-500">{language === 'ar' ? 'الربح المتوقع من الأوردر' : 'Expected from order'}</p><MoneyValue amount={item.expectedContribution} className="mt-0.5 block font-black text-slate-800 dark:text-slate-100" /></div>
                  <div><p className="text-[10px] text-slate-500">{language === 'ar' ? 'المحتسب في فلوس الشهر' : 'Counted in monthly cash'}</p><MoneyValue amount={item.cashContribution} className="mt-0.5 block font-black text-emerald-700 dark:text-emerald-300" /></div>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-600 dark:text-slate-300">{item.difference > 0 ? (language === 'ar' ? 'الربح المتوقع من هذا الأوردر أكبر من المبلغ الذي دخل حساب الشهر؛ راجع الدفعة أو الرصيد المتبقي وحالة تنفيذ الأوردر.' : 'This order’s forecast is higher than the cash counted this month; review its payment, remaining balance, and completion status.') : (language === 'ar' ? 'المبلغ الداخل في حساب الشهر أكبر من الربح المتوقع لهذا الأوردر؛ راجع الدفعات المسجلة والتكاليف.' : 'Cash counted this month is higher than this order’s forecast; review its payments and costs.')}</p>
              </div>)}
            </div>
          </div>}

          {cashReconciliation.issues.length > 0 && <div className="mt-4 border-t border-amber-200/80 pt-4 dark:border-amber-900/60">
            <p className="mb-2 text-xs font-black text-slate-800 dark:text-slate-100">{language === 'ar' ? 'بيانات تحتاج مراجعة' : 'Data needing review'}</p>
            <ul className="space-y-1.5 text-xs leading-5 text-rose-700 dark:text-rose-300">
              {cashReconciliation.issues.slice(0, 8).map(issue => <li key={issue.id}>{language === 'ar' ? issue.messageAr : issue.messageEn}</li>)}
            </ul>
          </div>}
        </div>}

        {/* The headline mirrors the operational cash formula shown to the user. */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={showNetCashBreakdown}
          onClick={() => setShowNetCashBreakdown((isOpen) => !isOpen)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setShowNetCashBreakdown((isOpen) => !isOpen);
            }
          }}
          className={`relative cursor-pointer p-6 md:p-7 rounded-2xl border transition-colors hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-amber-400/70 ${cashSummary.netMonthlyCash >= 0 ? 'bg-emerald-500/10 border-emerald-400/30' : 'bg-rose-500/10 border-rose-400/30'} flex flex-col items-center text-center md:flex-row md:items-center md:text-right justify-between gap-4`}
        >
          <div className="w-full md:w-auto">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white"><WalletCards className="w-5 h-5 text-amber-600 dark:text-amber-300" />{language === 'ar' ? `صافي فلوس الأوردرات لشهر ${selectedMonthName}` : `Net order cash for ${selectedMonthName}`}</div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">{language === 'ar' ? 'صافي ربح الأوردرات المكتملة + عربونات الأوردرات غير المكتملة + العربونات المحتفظ بها − المصاريف الأخرى للأوردرات غير المكتملة فقط.' : 'Completed-order net profit + uncompleted-order advances + retained deposits − other expenses for uncompleted orders only.'}</p>
          </div>
          <MoneyValue amount={cashSummary.netMonthlyCash} className={`self-center max-w-full text-[clamp(1.875rem,9vw,3rem)] font-black tracking-tight ${cashSummary.netMonthlyCash >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`} />
          <span className="absolute bottom-3 end-5 inline-flex items-center gap-1 text-[11px] font-black text-slate-600 dark:text-slate-300">
            {showNetCashBreakdown ? (language === 'ar' ? '\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644' : 'Hide breakdown') : (language === 'ar' ? '\u0627\u0636\u063A\u0637 \u0644\u0639\u0631\u0636 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644' : 'View breakdown')}
            {showNetCashBreakdown ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        </div>

        {showNetCashBreakdown && <div className="-mt-3 rounded-b-2xl border border-t-0 border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" dir={language === 'ar' ? 'rtl' : 'ltr'}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-black text-slate-900 dark:text-white">{language === 'ar' ? '\u062A\u0641\u0627\u0635\u064A\u0644 \u062A\u0643\u0648\u064A\u0646 \u0635\u0627\u0641\u064A \u0627\u0644\u0641\u0644\u0648\u0633' : 'Net cash breakdown'}</p>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500">
              {language === 'ar' ? '\u0627\u0636\u063A\u0637 \u0639\u0644\u0649 \u0627\u0644\u0645\u0631\u0628\u0639 \u0644\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644' : 'Click the card to hide details'}
              <ChevronUp className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="space-y-2 text-xs">
            {cashSummary.netMonthlyCashBreakdown.length === 0 ? <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-slate-500 dark:bg-white/[0.05]">{language === 'ar' ? '\u0644\u0627 \u062A\u0648\u062C\u062F \u062D\u0631\u0643\u0629 \u0645\u0627\u0644\u064A\u0629 \u0644\u0644\u0623\u0648\u0631\u062F\u0631\u0627\u062A \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0634\u0647\u0631.' : 'No order cash activity this month.'}</p> : cashSummary.netMonthlyCashBreakdown.map((item) => {
              const isDeduction = item.amount < 0;
              const typeLabel = item.kind === 'completed-order'
                ? (language === 'ar' ? '\u0623\u0648\u0631\u062F\u0631 \u0645\u0643\u062A\u0645\u0644' : 'Completed order')
                : item.kind === 'upcoming-advance'
                  ? (language === 'ar' ? '\u0639\u0631\u0628\u0648\u0646 \u0623\u0648\u0631\u062F\u0631 \u0642\u0627\u062F\u0645' : 'Upcoming-order advance')
                  : item.kind === 'retained-deposit'
                    ? (language === 'ar' ? '\u0639\u0631\u0628\u0648\u0646 \u0645\u062D\u062A\u0641\u0638 \u0628\u0647' : 'Retained deposit')
                    : (language === 'ar' ? '\u0645\u0635\u0631\u0648\u0641 \u0623\u0648\u0631\u062F\u0631 \u0642\u0627\u062F\u0645' : 'Upcoming-order expense');

              return <div key={item.id} className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-3 py-3 dark:bg-white/[0.05]">
                <div className="min-w-0">
                  <p className="font-black text-slate-900 dark:text-white">{item.orderNumber} <span className="font-normal text-slate-500">— {item.customerName}</span></p>
                  <p className="mt-1 text-[11px] font-bold text-slate-500">{typeLabel}</p>
                  {item.kind === 'completed-order' && <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                    {language === 'ar' ? '\u062A\u062D\u0635\u064A\u0644 \u0647\u0630\u0627 \u0627\u0644\u0634\u0647\u0631: ' : 'Collected this month: '}<MoneyValue amount={item.collectedThisMonth || 0} className="font-black" fit={false} />
                    <span className="mx-1.5">−</span>{language === 'ar' ? '\u062A\u0643\u0627\u0644\u064A\u0641 \u0627\u0644\u062A\u0646\u0641\u064A\u0630: ' : 'Execution costs: '}<MoneyValue amount={item.completedOrderCosts || 0} className="font-black" fit={false} />
                  </p>}
                </div>
                <MoneyValue amount={Math.abs(item.amount)} prefix={isDeduction ? '-' : '+'} className={`shrink-0 font-black ${isDeduction ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-300'}`} />
              </div>;
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 border-t border-slate-200 pt-3 text-sm dark:border-slate-700">
            <span className="font-black text-slate-900 dark:text-white">{language === 'ar' ? '\u0627\u0644\u0646\u0627\u062A\u062C \u0627\u0644\u0646\u0647\u0627\u0626\u064A' : 'Final total'}</span>
            <MoneyValue amount={cashSummary.netMonthlyCash} className={`font-black ${cashSummary.netMonthlyCash >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`} />
          </div>
        </div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {cashCards.map((card) => (
            <button type="button" key={card.key} onClick={() => setSelectedCashCard(card.key)} className="flex min-h-36 min-w-0 flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-400/70 dark:border-white/[0.09] dark:bg-white/[0.03] dark:hover:bg-white/[0.06] sm:min-h-44 sm:p-5">
              <span className="block w-full text-sm font-black leading-6 text-slate-800 dark:text-slate-200">{card.label}</span>
              <MoneyValue amount={card.value} className={`block max-w-full text-center text-[clamp(1.5rem,2.5vw,2.25rem)] font-black tracking-tight ${card.color}`} />
              <span className="block text-[10px] font-bold text-slate-400">{language === 'ar' ? 'اضغط لعرض التفاصيل' : 'Click for details'}</span>
            </button>
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
        <p className="px-5 py-3 bg-amber-50/70 dark:bg-amber-950/20 text-[11px] leading-5 text-amber-800 dark:text-amber-200">{language === 'ar' ? 'ملاحظة: مصاريف «أخرى» للأوردر تُخصم في شهر التنفيذ، أما تكلفة العامل والانتقالات فتُخصم عند اكتمال الأوردر. سجّل المصروفات العامة من صفحة المصروفات حتى يظهر رصيد الخزنة بدقة.' : 'Note: order other expenses are deducted in the execution month, while worker and transportation costs are deducted when the order is completed. Record operating expenses in the expense ledger for an accurate safe balance.'}</p>
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

      {activeCashCard && <CashCardDetailsModal
        title={activeCashCard.label}
        total={activeCashCard.value}
        items={cashCardDetails[activeCashCard.key]}
        language={language}
        onClose={() => setSelectedCashCard(null)}
      />}
    </div>
  );
};
