import React, { useState } from 'react';
import {
  Users,
  Plus,
  Search,
  Phone,
  Mail,
  MapPin,
  ClipboardList,
  Edit,
  Trash2,
  MessageSquare,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { Customer } from '../../types';
import { CustomerModal } from './CustomerModal';

export const CustomersModule: React.FC = () => {
  const { t } = useLanguage();
  const { customers, orders, deleteCustomer } = useData();

  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm) ||
      (c.email && c.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleDelete = async (id: string) => {
    if (window.confirm(t('confirmDelete'))) {
      await deleteCustomer(id);
    }
  };

  const getCleanPhone = (phoneStr: string) => {
    return phoneStr.replace(/[^0-9]/g, '');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-amber-500" />
            <span>{t('customers')}</span>
          </h2>
        </div>

        <button
          onClick={() => {
            setEditingCustomer(null);
            setIsModalOpen(true);
          }}
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-amber-500/20 transition-all cursor-pointer flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>{t('newCustomer')}</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute ltr:left-3.5 rtl:right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name, phone, email..."
            className="w-full ltr:pl-10 rtl:pr-10 ltr:pr-4 rtl:pl-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
      </div>

      {/* Customer List */}
      {filteredCustomers.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <Users className="w-12 h-12 mx-auto text-amber-500 opacity-40 mb-3" />
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{t('noData')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCustomers.map((cust) => {
            // Find customer orders
            const custOrders = orders.filter(
              (o) => o.customerId === cust.id || o.customerPhone === cust.phone
            );

            const totalPaid = custOrders.reduce((sum, o) => {
              const historySum = o.paymentHistory ? o.paymentHistory.reduce((pSum, p) => pSum + p.amount, 0) : 0;
              return sum + o.deposit + historySum;
            }, 0);
            const totalRemaining = custOrders.reduce((sum, o) => sum + o.remainingBalance, 0);

            const isExpanded = expandedCustomerId === cust.id;

            return (
              <div
                key={cust.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-all"
              >
                <div className="p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  {/* Info */}
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-extrabold flex items-center justify-center text-sm shadow-xs">
                        {cust.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 dark:text-white text-base">
                          {cust.name}
                        </h3>
                        <p className="text-xs text-slate-400 flex items-center gap-3 mt-0.5">
                          <span className="flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5 text-amber-500" />
                            {cust.phone}
                          </span>
                          {cust.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="w-3.5 h-3.5 text-blue-500" />
                              {cust.email}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Financial Stats */}
                  <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                        {t('previousOrders')}
                      </span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white">
                        {custOrders.length}
                      </span>
                    </div>

                    <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                        {t('paidAmount')}
                      </span>
                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        ${totalPaid.toLocaleString()}
                      </span>
                    </div>

                    <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                        {t('remainingBalance')}
                      </span>
                      <span className="text-sm font-bold text-rose-600 dark:text-rose-400">
                        ${totalRemaining.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Actions & WhatsApp/Call */}
                  <div className="flex items-center gap-2 self-end md:self-center">
                    <a
                      href={`https://wa.me/${getCleanPhone(cust.phone)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>{t('whatsappCustomer')}</span>
                    </a>

                    <a
                      href={`tel:${cust.phone}`}
                      className="p-2 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-xl transition-colors"
                      title={t('callCustomer')}
                    >
                      <Phone className="w-4 h-4" />
                    </a>

                    <button
                      onClick={() => {
                        setEditingCustomer(cust);
                        setIsModalOpen(true);
                      }}
                      className="p-2 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-xl transition-colors cursor-pointer"
                      title={t('edit')}
                    >
                      <Edit className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleDelete(cust.id)}
                      className="p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition-colors cursor-pointer"
                      title={t('delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => setExpandedCustomerId(isExpanded ? null : cust.id)}
                      className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl transition-colors"
                    >
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Order History Drawer */}
                {isExpanded && (
                  <div className="p-5 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 space-y-3 animate-in slide-in-from-top-2">
                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-amber-500" />
                      <span>{t('previousOrders')} ({custOrders.length})</span>
                    </h4>

                    {custOrders.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">No previous orders recorded for this customer.</p>
                    ) : (
                      <div className="space-y-2">
                        {custOrders.map((ord) => (
                          <div
                            key={ord.id}
                            className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between"
                          >
                            <div>
                              <span className="font-bold text-xs text-amber-600 dark:text-amber-400">
                                {ord.orderNumber}
                              </span>
                              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium mt-0.5">
                                {ord.eventLocation} ({ord.weddingDate})
                              </p>
                            </div>
                            <div className="text-end">
                              <span className="text-xs font-bold text-slate-900 dark:text-white block">
                                ${ord.totalPrice.toLocaleString()}
                              </span>
                              <span className="text-[10px] font-semibold text-emerald-600">
                                Paid: ${ord.deposit.toLocaleString()}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <CustomerModal
          isOpen={isModalOpen}
          initialCustomer={editingCustomer}
          onClose={() => {
            setIsModalOpen(false);
            setEditingCustomer(null);
          }}
        />
      )}
    </div>
  );
};
