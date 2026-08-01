import React, { useState } from 'react';
import { X, Building2, Receipt } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { Expense, FinanceType } from '../../types';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialExpense?: Expense | null;
  defaultType?: FinanceType;
}

const EXPENSE_CATEGORIES = [
  'شراء خامات',
  'شراء معدات',
  'شراء بضاعة',
  'دعاية وإعلانات',
  'إيجار',
  'كهرباء',
  'مياه',
  'إنترنت',
  'مرتبات',
  'صيانة',
  'مواصلات',
  'Other',
];

export const ExpenseModal: React.FC<ExpenseModalProps> = ({
  isOpen,
  onClose,
  initialExpense,
  defaultType = 'expense',
}) => {
  const { t, language } = useLanguage();
  const { addExpense, updateExpense } = useData();

  const isEdit = !!initialExpense;

  const [type, setType] = useState<FinanceType>(
    initialExpense?.type || defaultType
  );
  const [date, setDate] = useState(
    initialExpense?.date || new Date().toISOString().split('T')[0]
  );
  const [category, setCategory] = useState(
    initialExpense?.category && initialExpense.category !== 'رأس مال'
      ? initialExpense.category
      : 'إيجار'
  );
  const [amount, setAmount] = useState<number>(initialExpense?.amount || 0);
  const [addedBy, setAddedBy] = useState(initialExpense?.addedBy || '');
  const [notes, setNotes] = useState(
    initialExpense?.notes || initialExpense?.description || ''
  );
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);

    const finalCategory = type === 'capital' ? 'رأس مال' : category;

    const payload: Omit<Expense, 'id' | 'createdAt'> = {
      type,
      category: finalCategory,
      amount: Number(amount),
      date,
    };

    // Firestore rejects `undefined` field values. Only add optional fields
    // when the user actually entered them.
    if (addedBy.trim()) payload.addedBy = addedBy.trim();
    if (notes.trim()) {
      payload.notes = notes.trim();
      payload.description = notes.trim();
    }

    try {
      if (isEdit && initialExpense) {
        await updateExpense(initialExpense.id, payload);
      } else {
        await addExpense(payload);
      }
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col my-auto animate-in zoom-in-95 duration-200">
        <div className="p-5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {type === 'capital' ? (
              <Building2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Receipt className="w-5 h-5 text-rose-500" />
            )}
            <h3 className="font-bold text-slate-900 dark:text-white text-lg">
              {isEdit
                ? t('editExpense')
                : type === 'capital'
                ? t('addCapital')
                : t('addGeneralExpense')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Type Switcher */}
          {!isEdit && (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                {t('transactionType')}
              </label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => setType('capital')}
                  className={`py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
                    type === 'capital'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Building2 className="w-4 h-4" />
                  <span>{t('capital')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setType('expense')}
                  className={`py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
                    type === 'expense'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Receipt className="w-4 h-4" />
                  <span>{t('generalExpense')}</span>
                </button>
              </div>
            </div>
          )}

          {/* Amount and Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {language === 'ar' ? 'المبلغ ($)' : 'Amount ($)'}
              </label>
              <input
                type="number"
                min="0.01"
                step="any"
                required
                value={amount || ''}
                onChange={(e) => setAmount(Number(e.target.value))}
                placeholder="0.00"
                className={`w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 font-bold ${
                  type === 'capital'
                    ? 'focus:ring-emerald-500 text-emerald-600 dark:text-emerald-400'
                    : 'focus:ring-rose-500 text-rose-600 dark:text-rose-400'
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('expenseDate')}
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Category for General Expense */}
          {type === 'expense' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('expenseCategory')}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer font-medium"
              >
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Added By for Capital */}
          {type === 'capital' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {language === 'ar' ? 'أضيف بواسطة' : 'Added By'}
              </label>
              <input
                type="text"
                value={addedBy}
                onChange={(e) => setAddedBy(e.target.value)}
                placeholder={language === 'ar' ? 'اسم الشخص المضيف لرأس المال' : 'Name of person adding capital'}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {language === 'ar' ? 'ملاحظات' : 'Notes'}
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                language === 'ar'
                  ? 'أي تفاصيل أو ملاحظات إضافية...'
                  : 'Additional details or notes...'
              }
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className={`px-6 py-2.5 rounded-xl text-white text-xs font-bold shadow-md transition-all cursor-pointer ${
                type === 'capital'
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                  : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20'
              }`}
            >
              {isSaving ? 'جارٍ الحفظ...' : t('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
