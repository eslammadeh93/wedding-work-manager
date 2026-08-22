import React from 'react';
import { Car, Check, Clock, DollarSign, FileText, Image as ImageIcon, MessageCircle, Package, Phone, Receipt, UserCheck, Wrench } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import type { Order, WorkerMovement } from '../../types';
import { toTelHref, toWhatsAppHref } from '../../utils/phone';
import { OrderSourceBadge } from './OrderSourceBadge';

export const OrderWorkerSummary: React.FC<{ order: Order }> = ({ order }) => {
  const { t } = useLanguage();
  if (!order.executorName) return null;
  return (
    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1 font-semibold">
      <Wrench className="w-3.5 h-3.5" />
      <span>{t('executor')}: {order.executorName}</span>
    </p>
  );
};

export const OrderCustomerSection: React.FC<{ order: Order; isWorker: boolean; canViewCustomerContact: boolean }> = ({ order, isWorker, canViewCustomerContact }) => {
  const { t, language } = useLanguage();
  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
      <span className="text-xs text-slate-400 font-semibold flex items-center gap-1"><Phone className="w-4 h-4 text-amber-500" /><span>{t('contactInfo')}</span></span>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-base font-extrabold text-slate-900 dark:text-white">{order.customerName}</p>
          {canViewCustomerContact && <p className="text-sm font-mono text-slate-600 dark:text-slate-300 font-bold dir-ltr text-left sm:text-right mt-0.5">{order.customerPhone}</p>}
          {order.salesEmployee && !isWorker && <p className="text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-1 mt-1 font-semibold"><UserCheck className="w-3.5 h-3.5" /><span>{t('salesEmployee')}: {order.salesEmployee}</span></p>}
          {!isWorker && <div className="mt-2"><OrderSourceBadge source={order.orderSource} language={language} /></div>}
          <OrderWorkerSummary order={order} />
        </div>
        {canViewCustomerContact && !isWorker && <div className="flex items-center gap-2 shrink-0">
          <a href={toTelHref(order.customerPhone)} className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5"><Phone className="w-4 h-4" /><span>{t('call')}</span></a>
          <a href={toWhatsAppHref(order.customerPhone)} target="_blank" rel="noreferrer" className="px-3.5 py-2 bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5"><MessageCircle className="w-4 h-4" /><span>{t('whatsapp')}</span></a>
        </div>}
      </div>
    </div>
  );
};

export const OrderFinancialSummary: React.FC<{ order: Order }> = ({ order }) => {
  const { t } = useLanguage();
  const expenses = (order.workerCost || 0) + (order.transportationCost || 0) + (order.otherExpenses || 0);
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 text-center">
        <div><span className="text-xs text-slate-400 font-semibold">{t('totalPrice')}</span><p className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">${order.totalPrice.toLocaleString()}</p></div>
        <div><span className="text-xs text-slate-400 font-semibold">{t('totalPaid')}</span><p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">${(order.totalPaid ?? order.deposit).toLocaleString()}</p></div>
        <div><span className="text-xs text-slate-400 font-semibold">{t('securityDeposit')}</span><p className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">${(order.securityDeposit || 0).toLocaleString()}</p></div>
        <div><span className="text-xs text-slate-400 font-semibold">{t('remainingBalance')}</span><p className="text-lg font-bold text-rose-600 dark:text-rose-400 mt-0.5">${order.remainingBalance.toLocaleString()}</p></div>
      </div>
      <div className="p-4 bg-rose-50/30 dark:bg-rose-950/20 rounded-2xl border border-rose-200/60 dark:border-rose-900/40 space-y-3">
        <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2"><Receipt className="w-4 h-4 text-rose-500" /><span>{t('orderExpensesSection')}</span></h4>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
          <Metric label={t('workerCost')} value={order.workerCost || 0} />
          <Metric label={t('transportationCost')} value={order.transportationCost || 0} />
          <Metric label={t('otherExpenses')} value={order.otherExpenses || 0} />
          <Metric label={t('totalOrderExpenses')} value={expenses} className="bg-rose-100/60 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800" />
          <Metric label={t('expectedNetProfit')} value={order.totalPrice - expenses} className="bg-amber-100/60 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 col-span-2 sm:col-span-1" premium />
        </div>
      </div>
    </>
  );
};

const Metric: React.FC<{ label: string; value: number; className?: string; premium?: boolean }> = ({ label, value, className = '', premium = false }) => (
  <div className={`p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700 ${className}`}>
    <span className={`text-[11px] font-semibold ${premium ? 'premium-gold' : 'text-slate-500'}`}>{label}</span>
    <p className={`text-sm font-bold mt-0.5 ${premium ? 'premium-gold' : 'text-slate-900 dark:text-white'}`}>${value.toLocaleString()}</p>
  </div>
);

export const OrderPaymentHistory: React.FC<{ order: Order; isWorker: boolean }> = ({ order, isWorker }) => {
  const { t, language } = useLanguage();
  if (isWorker || !order.paymentHistory?.length) return null;
  return <div><h4 className="font-bold text-slate-900 dark:text-white text-sm mb-2 flex items-center gap-2"><DollarSign className="w-4 h-4 text-emerald-500" /><span>{t('paymentHistory')}</span></h4><div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden text-xs">{order.paymentHistory.map((pay) => <div key={pay.id} className="p-2.5 bg-white dark:bg-slate-800/50 flex items-center justify-between"><div><span className="font-bold text-slate-900 dark:text-white">${pay.amount.toLocaleString()}</span><span className="mx-2 text-slate-400">({pay.method})</span>{pay.type && <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pay.type === 'settlement' ? 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' : 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300'}`}>{pay.type === 'settlement' ? (language === 'ar' ? 'سداد' : 'Settlement') : (language === 'ar' ? 'عربون' : 'Deposit')}</span>}{pay.notes && <span className="text-slate-500 italic">- {pay.notes}</span>}</div><span className="text-slate-400 font-mono">{pay.date}</span></div>)}</div></div>;
};

export const OrderInventorySection: React.FC<{ order: Order; isWorker: boolean }> = ({ order, isWorker }) => {
  const { t } = useLanguage();
  return <><div><h4 className="font-bold text-slate-900 dark:text-white text-sm mb-3 flex items-center gap-2"><Package className="w-4 h-4 text-amber-500" /><span>{t('reservedInventory')}</span></h4>{order.reservedItems?.length ? <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">{order.reservedItems.map((item, index) => <div key={index} className="p-3 bg-white dark:bg-slate-800/50 flex items-center justify-between"><span className="font-medium text-slate-900 dark:text-white">{item.inventoryItemName}</span><span className="px-2.5 py-1 bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 rounded-lg font-bold text-xs">Qty: {item.quantity}</span></div>)}</div> : <p className="text-xs text-slate-400 italic">No inventory items specified.</p>}</div>
    {!isWorker && order.supplierRentals?.length ? <div><h4 className="font-bold text-slate-900 dark:text-white text-sm mb-3 flex items-center gap-2"><Wrench className="w-4 h-4 text-violet-500" /><span>الموردين والتأجير الخارجي</span></h4><div className="divide-y divide-violet-100 overflow-hidden rounded-xl border border-violet-200 dark:divide-violet-900/50 dark:border-violet-900/60">{order.supplierRentals.map((rental) => <div key={rental.id} className="bg-violet-50/40 p-3 dark:bg-violet-950/15"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900 dark:text-white">{rental.itemDescription}</p><p className="mt-1 text-xs font-semibold text-violet-700 dark:text-violet-300">{rental.supplierName} · {rental.serviceType}</p>{rental.notes && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{rental.notes}</p>}</div><span className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-xs font-black text-violet-700 shadow-xs dark:bg-slate-800 dark:text-violet-300">الكمية: {rental.quantity || 1}</span></div></div>)}</div></div> : null}
  </>;
};

export const OrderAttachmentsSection: React.FC<{ order: Order }> = ({ order }) => {
  const { t } = useLanguage();
  if (!order.attachments?.length) return null;
  return <div><h4 className="font-bold text-slate-900 dark:text-white text-sm mb-2 flex items-center gap-2"><ImageIcon className="w-4 h-4 text-purple-500" /><span>{t('attachments')}</span></h4><div className="flex flex-wrap gap-3">{order.attachments.map((attachment) => <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-semibold hover:bg-slate-100">{attachment.type === 'contract' ? <FileText className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}<span>{attachment.type === 'contract' ? 'Contract' : 'Photo'}</span></a>)}</div></div>;
};

export const OrderExecutionLog: React.FC<{ movements: WorkerMovement[]; isWorker: boolean; isLogging: boolean; hasArrived: boolean; hasCompleted: boolean; onLog: (action: WorkerMovement['action']) => void; formatTime: (value: WorkerMovement['createdAt']) => string }> = ({ movements, isWorker, isLogging, hasArrived, hasCompleted, onLog, formatTime }) => {
  const { t } = useLanguage();
  return <div className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3"><h4 className="font-bold text-xs text-slate-700 dark:text-slate-300 flex items-center justify-between"><span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-amber-500" /><span>{t('activityLogs')}</span></span><span className="text-[10px] text-slate-400 font-normal">تسجيل التحركات الميدانية</span></h4>{isWorker && <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => onLog('arrived')} disabled={isLogging || hasArrived} className="p-3 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"><Car className="w-4 h-4" /><span>{t('markArrived')}</span></button><button type="button" onClick={() => onLog('completed')} disabled={isLogging || !hasArrived || hasCompleted} className="p-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"><Check className="w-4 h-4" /><span>{t('markFinished')}</span></button></div>}{movements.length ? <div className="space-y-1.5 max-h-40 overflow-y-auto pt-1">{movements.map((log) => <div key={log.id} className="p-2.5 bg-white dark:bg-slate-900 rounded-xl text-xs border border-slate-200 dark:border-slate-700 flex items-center justify-between"><div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">{log.action === 'arrived' ? <Car className="w-4 h-4 text-amber-500" /> : <Check className="w-4 h-4 text-emerald-500" />}<span>{log.action === 'arrived' ? t('markArrived') : t('markFinished')}</span></div><span className="text-[10px] text-slate-400 font-mono">{formatTime(log.createdAt)}</span></div>)}</div> : <p className="text-xs text-slate-400 italic">لا توجد تسجيلات تحركات مسجلة لهذا الطلب حتى الآن</p>}</div>;
};
