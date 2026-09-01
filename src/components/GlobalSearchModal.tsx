import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  ClipboardList,
  HardHat,
  Receipt,
  Search,
  Tags,
  Users,
  ContactRound,
  X,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useData } from '../context/DataContext';
import { normalizeSearchText, searchGlobalData } from '../utils/globalSearch';
import { ActiveTab } from './Sidebar';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: ActiveTab, refId?: string) => void;
}

const text = (value: unknown): string => String(value ?? '').trim();
const firstText = (...values: unknown[]): string => values.map(text).find(Boolean) ?? '—';
const recordId = (value: unknown): string | undefined => text(value) || undefined;
const finiteNumber = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};
const formatNumber = (value: unknown): string => finiteNumber(value)?.toLocaleString() ?? '—';

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const { t, language } = useLanguage();
  const { orders, customers, suppliers, workers, inventory, expenses, categories } = useData();
  const [query, setQuery] = useState('');

  const normalizedQuery = normalizeSearchText(query);
  const results = useMemo(
    () => searchGlobalData({ orders, customers, suppliers, workers, inventory, expenses, categories }, normalizedQuery),
    [orders, customers, suppliers, workers, inventory, expenses, categories, normalizedQuery],
  );

  if (!isOpen) return null;

  const totalResults =
    results.orders.length +
    results.customers.length +
    results.suppliers.length +
    results.workers.length +
    results.inventory.length +
    results.expenses.length +
    results.categories.length;
  const navigate = (tab: ActiveTab, id: unknown) => {
    onNavigate(tab, recordId(id));
    onClose();
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-start justify-center pt-16 px-4">
      <div onClick={(event) => event.stopPropagation()} className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in zoom-in-95">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <Search className="w-5 h-5 text-amber-500" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="flex-1 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 outline-none text-base"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close search" className="p-1.5 text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-6 flex-1">
          {!normalizedQuery && (
            <div className="text-center py-12 text-slate-400 dark:text-slate-500">
              <Search className="w-10 h-10 mx-auto mb-2 opacity-50 text-amber-500" />
              <p className="text-sm">{t('searchPlaceholder')}</p>
            </div>
          )}

          {normalizedQuery && totalResults === 0 && (
            <div className="text-center py-12 text-slate-400"><p className="text-sm">{t('noData')}</p></div>
          )}

          {results.orders.length > 0 && (
            <section>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                <ClipboardList className="w-4 h-4 text-amber-500" />
                <span>{t('orders')} ({results.orders.length})</span>
              </div>
              <div className="space-y-1.5">
                {results.orders.slice(0, 5).map((order, index) => (
                  <button type="button" key={recordId(order.id) ?? `order-${index}`} onClick={() => navigate('orders', order.id)} className="w-full text-start p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-amber-500/10 dark:hover:bg-amber-500/20 rounded-xl cursor-pointer flex items-center justify-between border border-slate-100 dark:border-slate-800 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">{firstText(order.orderNumber, order.customerName, order.eventLocation)}</span>
                        {text(order.customerName) && text(order.orderNumber) && <span className="text-xs text-slate-500">• {text(order.customerName)}</span>}
                      </div>
                      <p className="text-xs text-slate-400 truncate max-w-md">{firstText(order.eventLocation, order.customerPhone)} {text(order.weddingDate) && `(${text(order.weddingDate)})`}</p>
                    </div>
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">${formatNumber(order.totalPrice)}<ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" /></span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {results.customers.length > 0 && (
            <section>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2"><Users className="w-4 h-4 text-blue-500" /><span>{t('customers')} ({results.customers.length})</span></div>
              <div className="space-y-1.5">
                {results.customers.slice(0, 5).map((customer, index) => (
                  <button type="button" key={recordId(customer.id) ?? `customer-${index}`} onClick={() => navigate('customers', customer.id)} className="w-full text-start p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-blue-500/10 dark:hover:bg-blue-500/20 rounded-xl cursor-pointer flex items-center justify-between border border-slate-100 dark:border-slate-800 transition-colors">
                    <div><span className="font-bold text-sm text-slate-900 dark:text-white">{firstText(customer.name, customer.phone, customer.email)}</span><p className="text-xs text-slate-400">{firstText(customer.phone, customer.email, customer.address)}</p></div>
                    <ArrowRight className="w-4 h-4 text-slate-400 rtl:rotate-180" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {results.suppliers.length > 0 && (
            <section>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2"><ContactRound className="w-4 h-4 text-amber-500" /><span>جهات الاتصال والموردين ({results.suppliers.length})</span></div>
              <div className="space-y-1.5">
                {results.suppliers.slice(0, 5).map((supplier, index) => (
                  <button type="button" key={recordId(supplier.id) ?? `supplier-${index}`} onClick={() => navigate('suppliers', supplier.id)} className="w-full text-start p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-amber-500/10 dark:hover:bg-amber-500/20 rounded-xl cursor-pointer flex items-center justify-between border border-slate-100 dark:border-slate-800 transition-colors">
                    <div><span className="font-bold text-sm text-slate-900 dark:text-white">{firstText(supplier.name, supplier.contactPerson, supplier.phone)}</span><p className="text-xs text-slate-400">{firstText(supplier.service, supplier.area, supplier.phone)}</p></div>
                    <ArrowRight className="w-4 h-4 text-slate-400 rtl:rotate-180" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {results.workers.length > 0 && (
            <section>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2"><HardHat className="w-4 h-4 text-violet-500" /><span>{t('workers')} ({results.workers.length})</span></div>
              <div className="space-y-1.5">
                {results.workers.slice(0, 5).map((worker, index) => (
                  <button type="button" key={recordId(worker.id) ?? `worker-${index}`} onClick={() => navigate('workers', worker.id)} className="w-full text-start p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-violet-500/10 rounded-xl cursor-pointer flex items-center justify-between border border-slate-100 dark:border-slate-800 transition-colors">
                    <div><span className="font-bold text-sm text-slate-900 dark:text-white">{firstText(worker.fullName, worker.username, worker.phone)}</span><p className="text-xs text-slate-400">{firstText(worker.jobTitle, worker.phone, worker.username)}</p></div>
                    <ArrowRight className="w-4 h-4 text-slate-400 rtl:rotate-180" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {results.inventory.length > 0 && (
            <section>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2"><Boxes className="w-4 h-4 text-emerald-500" /><span>{t('inventory')} ({results.inventory.length})</span></div>
              <div className="space-y-1.5">
                {results.inventory.slice(0, 5).map((item, index) => (
                  <button type="button" key={recordId(item.id) ?? `inventory-${index}`} onClick={() => navigate('inventory', item.id)} className="w-full text-start p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-emerald-500/10 rounded-xl cursor-pointer flex items-center justify-between border border-slate-100 dark:border-slate-800 transition-colors">
                    <div className="flex items-center gap-3">
                      {text(item.imageUrl) && <img src={text(item.imageUrl)} alt={firstText(item.nameEn, item.nameAr)} className="w-9 h-9 object-cover rounded-lg" />}
                      <div><span className="font-bold text-sm text-slate-900 dark:text-white">{language === 'ar' ? firstText(item.nameAr, item.nameEn, item.itemCode) : firstText(item.nameEn, item.nameAr, item.itemCode)}</span><p className="text-xs text-slate-400">{t('availableQuantity')}: {formatNumber(item.availableQuantity)} / {formatNumber(item.quantity)}</p></div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 rtl:rotate-180" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {results.expenses.length > 0 && (
            <section>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2"><Receipt className="w-4 h-4 text-rose-500" /><span>{t('expenses')} ({results.expenses.length})</span></div>
              <div className="space-y-1.5">
                {results.expenses.slice(0, 5).map((expense, index) => (
                  <button type="button" key={recordId(expense.id) ?? `expense-${index}`} onClick={() => navigate('expenses', expense.id)} className="w-full text-start p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-rose-500/10 rounded-xl cursor-pointer flex items-center justify-between border border-slate-100 dark:border-slate-800 transition-colors">
                    <div><span className="font-bold text-sm text-slate-900 dark:text-white">{firstText(expense.description, expense.notes, expense.category)}</span><p className="text-xs text-slate-400">{firstText(expense.category, expense.date)} {text(expense.date) && text(expense.category) && `(${text(expense.date)})`}</p></div>
                    <span className="font-bold text-rose-600 dark:text-rose-400 text-sm">${formatNumber(expense.amount)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {results.categories.length > 0 && (
            <section>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2"><Tags className="w-4 h-4 text-cyan-500" /><span>{language === 'ar' ? 'الفئات' : 'Categories'} ({results.categories.length})</span></div>
              <div className="space-y-1.5">
                {results.categories.slice(0, 5).map((category, index) => (
                  <button type="button" key={recordId(category.id) ?? `category-${index}`} onClick={() => navigate('inventory', category.id)} className="w-full text-start p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-cyan-500/10 rounded-xl cursor-pointer flex items-center justify-between border border-slate-100 dark:border-slate-800 transition-colors">
                    <div><span className="font-bold text-sm text-slate-900 dark:text-white">{language === 'ar' ? firstText(category.nameAr, category.nameEn, category.key) : firstText(category.nameEn, category.nameAr, category.key)}</span><p className="text-xs text-slate-400">{firstText(category.key, category.nameEn, category.nameAr)}</p></div>
                    <ArrowRight className="w-4 h-4 text-slate-400 rtl:rotate-180" />
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
