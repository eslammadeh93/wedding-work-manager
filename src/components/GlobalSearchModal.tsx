import React, { useState } from 'react';
import { Search, X, ClipboardList, Users, Boxes, Receipt, ArrowRight } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useData } from '../context/DataContext';
import { ActiveTab } from './Sidebar';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: ActiveTab, refId?: string) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const { t, language } = useLanguage();
  const { orders, customers, inventory, expenses } = useData();
  const [query, setQuery] = useState('');

  if (!isOpen) return null;

  const q = query.toLowerCase().trim();

  // Filter Orders
  const matchedOrders = q
    ? orders.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.eventLocation.toLowerCase().includes(q) ||
          o.customerPhone.includes(q)
      )
    : [];

  // Filter Customers
  const matchedCustomers = q
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.email && c.email.toLowerCase().includes(q))
      )
    : [];

  // Filter Inventory
  const matchedInventory = q
    ? inventory.filter(
        (i) =>
          i.nameAr.toLowerCase().includes(q) ||
          i.nameEn.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q) ||
          i.storageLocation.toLowerCase().includes(q)
      )
    : [];

  // Filter Expenses
  const matchedExpenses = q
    ? expenses.filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          e.amount.toString().includes(q)
      )
    : [];

  const totalResults =
    matchedOrders.length +
    matchedCustomers.length +
    matchedInventory.length +
    matchedExpenses.length;

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-start justify-center pt-16 px-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in zoom-in-95">
        {/* Search Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <Search className="w-5 h-5 text-amber-500" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="flex-1 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 outline-none text-base"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="px-2.5 py-1 text-xs font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Skip
          </button>
        </div>

        {/* Results List */}
        <div className="p-4 overflow-y-auto space-y-6 flex-1">
          {!query && (
            <div className="text-center py-12 text-slate-400 dark:text-slate-500">
              <Search className="w-10 h-10 mx-auto mb-2 opacity-50 text-amber-500" />
              <p className="text-sm">{t('searchPlaceholder')}</p>
            </div>
          )}

          {query && totalResults === 0 && (
            <div className="text-center py-12 text-slate-400">
              <p className="text-sm">{t('noData')}</p>
            </div>
          )}

          {/* Orders Results */}
          {matchedOrders.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                <ClipboardList className="w-4 h-4 text-amber-500" />
                <span>{t('orders')} ({matchedOrders.length})</span>
              </div>
              <div className="space-y-1.5">
                {matchedOrders.slice(0, 5).map((order) => (
                  <div
                    key={order.id}
                    onClick={() => {
                      onNavigate('orders', order.id);
                      onClose();
                    }}
                    className="p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-amber-500/10 dark:hover:bg-amber-500/20 rounded-xl cursor-pointer flex items-center justify-between border border-slate-100 dark:border-slate-800 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {order.orderNumber}
                        </span>
                        <span className="text-xs text-slate-500">• {order.customerName}</span>
                      </div>
                      <p className="text-xs text-slate-400 truncate max-w-md">
                        {order.eventLocation} ({order.weddingDate})
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      ${order.totalPrice.toLocaleString()}
                      <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Customers Results */}
          {matchedCustomers.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                <Users className="w-4 h-4 text-blue-500" />
                <span>{t('customers')} ({matchedCustomers.length})</span>
              </div>
              <div className="space-y-1.5">
                {matchedCustomers.slice(0, 5).map((cust) => (
                  <div
                    key={cust.id}
                    onClick={() => {
                      onNavigate('customers', cust.id);
                      onClose();
                    }}
                    className="p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-blue-500/10 dark:hover:bg-blue-500/20 rounded-xl cursor-pointer flex items-center justify-between border border-slate-100 dark:border-slate-800 transition-colors"
                  >
                    <div>
                      <span className="font-bold text-sm text-slate-900 dark:text-white">
                        {cust.name}
                      </span>
                      <p className="text-xs text-slate-400">{cust.phone}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 rtl:rotate-180" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inventory Results */}
          {matchedInventory.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                <Boxes className="w-4 h-4 text-emerald-500" />
                <span>{t('inventory')} ({matchedInventory.length})</span>
              </div>
              <div className="space-y-1.5">
                {matchedInventory.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      onNavigate('inventory', item.id);
                      onClose();
                    }}
                    className="p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-emerald-500/10 dark:hover:bg-emerald-500/20 rounded-xl cursor-pointer flex items-center justify-between border border-slate-100 dark:border-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt={item.nameEn}
                          className="w-9 h-9 object-cover rounded-lg"
                        />
                      )}
                      <div>
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {language === 'ar' ? item.nameAr : item.nameEn}
                        </span>
                        <p className="text-xs text-slate-400">
                          {t('availableQuantity')}: {item.availableQuantity} / {item.quantity}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 rtl:rotate-180" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expenses Results */}
          {matchedExpenses.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                <Receipt className="w-4 h-4 text-rose-500" />
                <span>{t('expenses')} ({matchedExpenses.length})</span>
              </div>
              <div className="space-y-1.5">
                {matchedExpenses.slice(0, 5).map((exp) => (
                  <div
                    key={exp.id}
                    onClick={() => {
                      onNavigate('expenses', exp.id);
                      onClose();
                    }}
                    className="p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-rose-500/10 dark:hover:bg-rose-500/20 rounded-xl cursor-pointer flex items-center justify-between border border-slate-100 dark:border-slate-800 transition-colors"
                  >
                    <div>
                      <span className="font-bold text-sm text-slate-900 dark:text-white">
                        {exp.description}
                      </span>
                      <p className="text-xs text-slate-400">{exp.category} ({exp.date})</p>
                    </div>
                    <span className="font-bold text-rose-600 dark:text-rose-400 text-sm">
                      ${exp.amount.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
