import React, { useMemo, useState } from 'react';
import {
  Wallet,
  Plus,
  Search,
  Calendar,
  Building2,
  TrendingDown,
  TrendingUp,
  Edit,
  Trash2,
  User,
  ArrowUpRight,
  ArrowDownLeft,
  X,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { Expense, FinanceType } from '../../types';
import { ExpenseModal } from './ExpenseModal';
import { MoneyValue } from '../ui/MoneyValue';
import { calculateMonthlyCash, calculateSafeBalanceToDate } from '../../utils/monthlyCash';

interface CashBalanceDetailItem {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
}

const CashBalanceDetailsModal: React.FC<{
  total: number;
  items: CashBalanceDetailItem[];
  language: 'ar' | 'en';
  onClose: () => void;
}> = ({ total, items, language, onClose }) => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
    <section role="dialog" aria-modal="true" aria-label={language === 'ar' ? 'تفاصيل رصيد الخزنة المُرحّل' : 'Carried safe balance details'} dir={language === 'ar' ? 'rtl' : 'ltr'} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl dark:bg-slate-900" onMouseDown={(event) => event.stopPropagation()}>
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div><h2 className="text-lg font-black text-slate-900 dark:text-white">{language === 'ar' ? 'تفاصيل رصيد الخزنة المُرحّل' : 'Carried safe balance details'}</h2><p className="mt-1 text-xs text-slate-500">{language === 'ar' ? 'يبدأ برصيد الشهر السابق ثم يُضاف ويُخصم منه حساب الشهر المختار.' : 'It starts with the previous month balance, then applies the selected month movements.'}</p></div>
        <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={language === 'ar' ? 'إغلاق' : 'Close'}><X className="h-5 w-5" /></button>
      </header>
      <div className="space-y-3 p-5">
        {items.length === 0 ? <p className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-500 dark:bg-white/[0.05]">{language === 'ar' ? 'لا توجد حركات مالية مسجلة.' : 'No financial movements recorded.'}</p> : items.map((item) => <div key={item.id} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><div className="min-w-0"><p className="font-black text-slate-900 dark:text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.subtitle}</p></div><MoneyValue amount={Math.abs(item.amount)} prefix={item.amount < 0 ? '-' : '+'} className={`shrink-0 text-lg font-black ${item.amount < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-300'}`} /></div>)}
      </div>
      <footer className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><span className="font-black text-slate-900 dark:text-white">{language === 'ar' ? 'رصيد نهاية الشهر' : 'Month-end balance'}</span><MoneyValue amount={total} className={`text-xl font-black ${total >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`} /></footer>
    </section>
  </div>
);

export const ExpensesModule: React.FC = () => {
  const { t, language } = useLanguage();
  const { orders, expenses, deleteExpense } = useData();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'capital' | 'expense'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [defaultModalType, setDefaultModalType] = useState<FinanceType>('expense');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [showCashBalanceDetails, setShowCashBalanceDetails] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [periodMode, setPeriodMode] = useState<'month' | 'range' | 'year' | 'all'>('month');
  const [periodStart, setPeriodStart] = useState(selectedMonth);
  const [periodEnd, setPeriodEnd] = useState(selectedMonth);
  const [periodYear, setPeriodYear] = useState(selectedMonth.slice(0, 4));
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const periodBounds = useMemo(() => {
    if (periodMode === 'all') return { start: '', end: '9999-12' };
    if (periodMode === 'year') return { start: `${periodYear}-01`, end: `${periodYear}-12` };
    if (periodMode === 'range') return { start: periodStart <= periodEnd ? periodStart : periodEnd, end: periodStart <= periodEnd ? periodEnd : periodStart };
    return { start: selectedMonth, end: selectedMonth };
  }, [periodEnd, periodMode, periodStart, periodYear, selectedMonth]);
  const periodLabel = periodMode === 'all' ? (language === 'ar' ? 'كل المعاملات' : 'All periods')
    : periodMode === 'year' ? periodYear
      : periodBounds.start === periodBounds.end ? new Date(`${periodBounds.start}-01T00:00:00`).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' })
        : `${periodBounds.start} — ${periodBounds.end}`;
  const [selectedYear, selectedMonthIndex] = periodBounds.end.split('-').map(Number);
  const monthExpenses = useMemo(() => expenses.filter((entry) => {
    const key = entry.date?.slice(0, 7) || '';
    return key >= periodBounds.start && key <= periodBounds.end;
  }), [expenses, periodBounds]);
  const monthlyCapital = useMemo(() => monthExpenses
    .filter((entry) => entry.type === 'capital' || entry.category === 'رأس مال')
    .reduce((sum, entry) => sum + (entry.amount || 0), 0), [monthExpenses]);
  const monthlyGeneralExpenses = useMemo(() => monthExpenses
    .filter((entry) => entry.type !== 'capital' && entry.category !== 'رأس مال')
    .reduce((sum, entry) => sum + (entry.amount || 0), 0), [monthExpenses]);
  const monthlyCashSummary = useMemo(
    () => calculateMonthlyCash(orders, expenses, selectedYear, selectedMonthIndex - 1),
    [expenses, orders, selectedMonthIndex, selectedYear],
  );
  const openingSafeBalance = useMemo(() => {
    const previousMonthEnd = new Date(selectedYear, selectedMonthIndex - 1, 0);
    return calculateSafeBalanceToDate(orders, expenses, previousMonthEnd);
  }, [expenses, orders, selectedMonthIndex, selectedYear]);
  const carriedBalanceEntry = useMemo(() => periodMode === 'month' && openingSafeBalance > 0 ? {
    id: `carried-balance-${selectedMonth}`,
    type: 'capital' as const,
    category: language === 'ar' ? 'رصيد مُرحّل' : 'Carried balance',
    amount: openingSafeBalance,
    date: `${selectedMonth}-01`,
    notes: language === 'ar' ? 'رصيد مُرحّل من نهاية الشهر السابق' : 'Balance carried from the end of the previous month',
    description: language === 'ar' ? 'رصيد مُرحّل من نهاية الشهر السابق' : 'Balance carried from the end of the previous month',
    addedBy: language === 'ar' ? 'النظام' : 'System',
    createdAt: '',
    isCarriedBalance: true as const,
  } : null, [language, openingSafeBalance, periodMode, selectedMonth]);

  const cashBalanceDetails = useMemo<CashBalanceDetailItem[]>(() => {
    return [
      { id: 'opening-balance', title: language === 'ar' ? 'رصيد مُرحّل من الشهر السابق' : 'Balance carried from previous month', subtitle: language === 'ar' ? 'الرصيد المتبقي في نهاية الشهر السابق' : 'The balance remaining at the end of the previous month', amount: openingSafeBalance },
      { id: 'collections', title: language === 'ar' ? 'إجمالي تحصيلات الأوردرات' : 'Total order collections', subtitle: language === 'ar' ? 'العربونات ودفعات السداد المسجلة في الشهر المختار' : 'Deposits and settlement payments recorded in the selected month', amount: monthlyCashSummary.grossMonthlyIncome },
      { id: 'capital', title: language === 'ar' ? 'رأس المال المضاف' : 'Capital added', subtitle: language === 'ar' ? 'إضافات رأس المال في الشهر المختار' : 'Capital additions in the selected month', amount: monthlyCashSummary.capitalAdded },
      { id: 'operating-expenses', title: language === 'ar' ? 'المصروفات العامة' : 'Operating expenses', subtitle: language === 'ar' ? 'المصروفات التشغيلية في الشهر المختار' : 'Operating expenses in the selected month', amount: -monthlyCashSummary.operatingExpenses },
      { id: 'completed-order-costs', title: language === 'ar' ? 'تكاليف الأوردرات المكتملة' : 'Completed-order costs', subtitle: language === 'ar' ? 'تكاليف التنفيذ للأوردرات المكتملة في الشهر المختار' : 'Execution costs for orders completed in the selected month', amount: -monthlyCashSummary.completedOrderCosts },
      { id: 'upcoming-order-expenses', title: language === 'ar' ? 'مصاريف أخرى في شهر التنفيذ' : 'Other expenses in execution month', subtitle: language === 'ar' ? 'مصاريف أوردرات غير مكتملة موعدها في الشهر المختار' : 'Uncompleted-order expenses scheduled in the selected month', amount: -monthlyCashSummary.upcomingOrderOtherExpenses },
    ].filter((item) => item.amount !== 0);
  }, [language, monthlyCashSummary, openingSafeBalance]);

  const filteredExpenses = [...expenses, ...(carriedBalanceEntry ? [carriedBalanceEntry] : [])].filter((e) => {
    const isCap = e.type === 'capital' || e.category === 'رأس مال';
    if (filterType === 'capital' && !isCap) return false;
    if (filterType === 'expense' && isCap) return false;
    const dateKey = e.date?.slice(0, 7) || '';
    if (dateKey < periodBounds.start || dateKey > periodBounds.end) return false;

    const query = searchTerm.toLowerCase();
    const notesStr = (e.notes || e.description || '').toLowerCase();
    const catStr = (e.category || '').toLowerCase();
    const addedByStr = (e.addedBy || '').toLowerCase();
    const amountStr = (e.amount || 0).toString();
    const dateStr = e.date || '';

    return (
      notesStr.includes(query) ||
      catStr.includes(query) ||
      addedByStr.includes(query) ||
      amountStr.includes(query) ||
      dateStr.includes(query)
    );
  });

  const handleDelete = async (id: string) => {
    if (window.confirm(t('confirmDelete'))) {
      await deleteExpense(id);
    }
  };

  const handleOpenAddCapital = () => {
    setEditingExpense(null);
    setDefaultModalType('capital');
    setIsModalOpen(true);
  };

  const handleOpenAddExpense = () => {
    setEditingExpense(null);
    setDefaultModalType('expense');
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Wallet className="w-7 h-7 text-amber-500" />
            <span>{t('capitalAndExpenses')}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {language === 'ar'
              ? 'إدارة حسابات رأس المال والمصروفات العامة الخاصة بالشركة'
              : 'Management of company capital & general operating expenses'}
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={handleOpenAddCapital}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-emerald-600/20 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>{t('addCapital')}</span>
          </button>

          <button
            onClick={handleOpenAddExpense}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-rose-600/20 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>{t('addGeneralExpense')}</span>
          </button>
        </div>
      </div>

      {/* Financial Overview Banner (KPIs) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Capital */}
        <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between gap-3 overflow-hidden">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl">
              <Building2 className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                {language === 'ar' ? 'رأس المال المضاف للشهر' : 'Capital added this month'}
              </span>
              <MoneyValue amount={monthlyCapital + (periodMode === 'month' ? openingSafeBalance : 0)} className="mt-0.5 text-[clamp(1rem,3vw,1.5rem)] font-black text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <span className="p-1.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-lg">
            <ArrowUpRight className="w-4 h-4" />
          </span>
        </div>

        {/* Total General Expenses */}
        <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between gap-3 overflow-hidden">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="p-3 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-2xl">
              <TrendingDown className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                {language === 'ar' ? 'المصروفات العامة للشهر' : 'General expenses this month'}
              </span>
              <MoneyValue amount={monthlyGeneralExpenses} className="mt-0.5 text-[clamp(1rem,3vw,1.5rem)] font-black text-rose-600 dark:text-rose-400" />
            </div>
          </div>
          <span className="p-1.5 bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 rounded-lg">
            <ArrowDownLeft className="w-4 h-4" />
          </span>
        </div>

        {/* Current Cash Balance */}
        <div
          role="button"
          tabIndex={0}
          aria-label={language === 'ar' ? 'عرض تفاصيل الرصيد الحالي' : 'View current balance details'}
          onClick={() => setShowCashBalanceDetails(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setShowCashBalanceDetails(true);
            }
          }}
          className="cursor-pointer p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between gap-3 overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-400/70"
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <div
              className={`p-3 rounded-2xl ${
                monthlyCashSummary.expectedSafeBalance >= 0
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
              }`}
            >
              <TrendingUp className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                {language === 'ar' ? 'رصيد الخزنة المُرحّل' : 'Carried safe balance'}
              </span>
              <MoneyValue
                amount={monthlyCashSummary.expectedSafeBalance}
                className={`mt-0.5 text-[clamp(1rem,3vw,1.5rem)] font-black ${
                  monthlyCashSummary.expectedSafeBalance >= 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              />
            </div>
          </div>
          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
            {language === 'ar' ? 'رصيد مرحّل + تحصيلات + رأس مال − مصروفات وتنفيذ' : 'Carried balance + collections + capital − costs'}
          </span>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="relative">
          <button type="button" onClick={() => setShowPeriodPicker((open) => !open)} className="flex min-w-56 items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-black text-slate-900 shadow-sm transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-white dark:hover:bg-amber-950/50">
            <span>{language === 'ar' ? 'الفترة' : 'Period'}</span><span>{periodLabel}</span><Calendar className="h-4 w-4 text-amber-700 dark:text-amber-300" />
          </button>
          {showPeriodPicker && <div className="absolute end-0 top-full z-30 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900" dir={language === 'ar' ? 'rtl' : 'ltr'}>
            <div className="mb-3 grid grid-cols-2 gap-2">{([
              ['month', language === 'ar' ? 'شهر واحد' : 'One month'], ['range', language === 'ar' ? 'نطاق شهور' : 'Month range'],
              ['year', language === 'ar' ? 'سنة كاملة' : 'Full year'], ['all', language === 'ar' ? 'كل المعاملات' : 'All periods'],
            ] as const).map(([mode, label]) => <button type="button" key={mode} onClick={() => setPeriodMode(mode)} className={`rounded-xl px-2 py-2 text-xs font-black ${periodMode === mode ? 'bg-amber-500 text-slate-950' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{label}</button>)}</div>
            {periodMode === 'month' && <input type="month" value={selectedMonth} onChange={(event) => { setSelectedMonth(event.target.value); setShowCashBalanceDetails(false); }} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold dark:border-slate-700 dark:bg-slate-800" />}
            {periodMode === 'range' && <div className="grid grid-cols-2 gap-2"><input type="month" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-800" /><input type="month" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-800" /></div>}
            {periodMode === 'year' && <input type="number" min="2000" max="2100" value={periodYear} onChange={(event) => setPeriodYear(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold dark:border-slate-700 dark:bg-slate-800" />}
            <button type="button" onClick={() => { setShowPeriodPicker(false); setShowCashBalanceDetails(false); }} className="mt-3 w-full rounded-xl bg-slate-900 py-2 text-xs font-black text-white dark:bg-amber-400 dark:text-slate-950">{language === 'ar' ? 'تطبيق الاختيار' : 'Apply selection'}</button>
          </div>}
        </div>
        {/* Filter Type Toggles */}
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              filterType === 'all'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {language === 'ar' ? 'جميع المعاملات' : 'All Transactions'}
          </button>

          <button
            onClick={() => setFilterType('capital')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              filterType === 'capital'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>{t('capital')}</span>
          </button>

          <button
            onClick={() => setFilterType('expense')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              filterType === 'expense'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <TrendingDown className="w-3.5 h-3.5" />
            <span>{t('generalExpense')}</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute ltr:left-3.5 rtl:right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={
              language === 'ar'
                ? 'بحث بالبيان، التصنيف، المبلغ، أضيف بواسطة...'
                : 'Search by notes, category, amount, added by...'
            }
            className="w-full ltr:pl-10 rtl:pr-10 ltr:pr-4 rtl:pl-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
      </div>

      {/* Transactions Table */}
      {filteredExpenses.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <Wallet className="w-12 h-12 mx-auto text-amber-500 opacity-40 mb-3" />
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{t('noData')}</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 uppercase font-semibold">
                <tr>
                  <th className="p-3.5 text-start">{t('transactionType')}</th>
                  <th className="p-3.5 text-start">{t('expenseDate')}</th>
                  <th className="p-3.5 text-start">{t('expenseCategory')}</th>
                  <th className="p-3.5 text-start">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                  <th className="p-3.5 text-start">{t('addedBy')}</th>
                  <th className="p-3.5 text-start">{language === 'ar' ? 'الملاحظات / البيان' : 'Notes / Description'}</th>
                  <th className="p-3.5 text-start">{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredExpenses.map((exp) => {
                  const isCapital = exp.type === 'capital' || exp.category === 'رأس مال';
                  const notesText = exp.notes || exp.description || '-';
                  const isCarriedBalance = 'isCarriedBalance' in exp && exp.isCarriedBalance;

                  return (
                    <tr
                      key={exp.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Type Badge */}
                      <td className="p-3.5 whitespace-nowrap">
                        {isCapital ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/40">
                            <Building2 className="w-3 h-3 text-emerald-600" />
                            <span>{t('capital')}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-900/40">
                            <TrendingDown className="w-3 h-3 text-rose-600" />
                            <span>{t('generalExpense')}</span>
                          </span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="p-3.5 font-semibold text-slate-500 flex items-center gap-1.5 whitespace-nowrap">
                        <Calendar className="w-3.5 h-3.5 text-amber-500" />
                        <span>{exp.date}</span>
                      </td>

                      {/* Category */}
                      <td className="p-3.5 font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {isCapital ? 'رأس مال' : exp.category || 'عام'}
                      </td>

                      {/* Amount */}
                      <td className="p-3.5 text-end font-black text-sm whitespace-nowrap">
                        {isCapital ? (
                          <MoneyValue amount={exp.amount} prefix="+" className="text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <MoneyValue amount={exp.amount} prefix="-" className="text-rose-600 dark:text-rose-400" />
                        )}
                      </td>

                      {/* Added By */}
                      <td className="p-3.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {exp.addedBy ? (
                          <span className="flex items-center gap-1 text-[11px] font-medium">
                            <User className="w-3 h-3 text-slate-400" />
                            {exp.addedBy}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      {/* Notes / Description */}
                      <td className="p-3.5 font-medium text-slate-900 dark:text-white max-w-xs truncate">
                        {notesText}
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 whitespace-nowrap">
                        {isCarriedBalance ? <span className="text-[11px] font-bold text-slate-400">{language === 'ar' ? 'رصيد مُرحّل' : 'Carried balance'}</span> : <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditingExpense(exp);
                              setDefaultModalType(isCapital ? 'capital' : 'expense');
                              setIsModalOpen(true);
                            }}
                            className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg transition-colors cursor-pointer"
                            title={t('edit')}
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(exp.id)}
                            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                            title={t('delete')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <ExpenseModal
          isOpen={isModalOpen}
          initialExpense={editingExpense}
          defaultType={defaultModalType}
          onClose={() => {
            setIsModalOpen(false);
            setEditingExpense(null);
          }}
        />
      )}

      {showCashBalanceDetails && <CashBalanceDetailsModal
        total={monthlyCashSummary.expectedSafeBalance}
        items={cashBalanceDetails}
        language={language}
        onClose={() => setShowCashBalanceDetails(false)}
      />}
    </div>
  );
};

