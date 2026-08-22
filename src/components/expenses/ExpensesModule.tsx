import React, { useState } from 'react';
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
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { Expense, FinanceType } from '../../types';
import { ExpenseModal } from './ExpenseModal';
import { MoneyValue } from '../ui/MoneyValue';

export const ExpensesModule: React.FC = () => {
  const { t, language } = useLanguage();
  const { expenses, deleteExpense, totalCapital, totalGeneralExpenses, currentCashBalance } = useData();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'capital' | 'expense'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [defaultModalType, setDefaultModalType] = useState<FinanceType>('expense');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const filteredExpenses = expenses.filter((e) => {
    const isCap = e.type === 'capital' || e.category === 'رأس مال';
    if (filterType === 'capital' && !isCap) return false;
    if (filterType === 'expense' && isCap) return false;

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
                {t('totalCapital')}
              </span>
              <MoneyValue amount={totalCapital} className="mt-0.5 text-[clamp(1rem,3vw,1.5rem)] font-black text-emerald-600 dark:text-emerald-400" />
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
                {t('totalGeneralExpenses')}
              </span>
              <MoneyValue amount={totalGeneralExpenses} className="mt-0.5 text-[clamp(1rem,3vw,1.5rem)] font-black text-rose-600 dark:text-rose-400" />
            </div>
          </div>
          <span className="p-1.5 bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 rounded-lg">
            <ArrowDownLeft className="w-4 h-4" />
          </span>
        </div>

        {/* Current Cash Balance */}
        <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between gap-3 overflow-hidden">
          <div className="flex min-w-0 items-center gap-3.5">
            <div
              className={`p-3 rounded-2xl ${
                currentCashBalance >= 0
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
              }`}
            >
              <TrendingUp className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                {t('currentCashBalance')}
              </span>
              <MoneyValue
                amount={currentCashBalance}
                className={`mt-0.5 text-[clamp(1rem,3vw,1.5rem)] font-black ${
                  currentCashBalance >= 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              />
            </div>
          </div>
          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
            {language === 'ar' ? 'تحصيلات + رأس مال − مصروفات وتنفيذ' : 'Collections + capital − operating and order costs'}
          </span>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
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
                        <div className="flex items-center gap-1">
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
                        </div>
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
    </div>
  );
};

