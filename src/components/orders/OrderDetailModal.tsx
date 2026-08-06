import React, { useState } from 'react';
import {
  X,
  Printer,
  Calendar,
  MapPin,
  Phone,
  DollarSign,
  Package,
  Edit,
  Trash2,
  FileText,
  UserCheck,
  Wrench,
  Plus,
  CreditCard,
  Image as ImageIcon,
  Upload,
  ExternalLink,
  Receipt,
  Copy,
  Check,
  MessageCircle,
  Clock,
  Car,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { Order, OrderStatus } from '../../types';
import { toSafeExternalUrl } from '../../utils/security';
import { localDateString } from '../../utils/localDate';
import { toTelHref, toWhatsAppHref } from '../../utils/phone';
import { canViewCustomerContact as contactIsVisible } from '../../utils/workerContact';

interface OrderDetailModalProps {
  order: Order | null;
  onClose: () => void;
  onEdit: (order: Order) => void;
  onPrint: (order: Order) => void;
}

export const OrderDetailModal: React.FC<OrderDetailModalProps> = ({
  order,
  onClose,
  onEdit,
  onPrint,
}) => {
  const { t, language } = useLanguage();
  const { updateOrder, deleteOrder, settings, addPaymentToOrder, addActivityLog } = useData();
  const { profile } = useAuth();

  const isWorker = profile?.role === 'worker';
  const canViewCustomerContact = order ? contactIsVisible(isWorker, order) : false;

  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState('InstaPay');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [copiedLocation, setCopiedLocation] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isLogging, setIsLogging] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [logToast, setLogToast] = useState<string | null>(null);

  const hasLoggedOpenRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (isWorker && order && hasLoggedOpenRef.current !== order.id) {
      hasLoggedOpenRef.current = order.id;
      const workerName = profile?.workerName || profile?.displayName || 'المنفذ';
      const workerId = profile?.workerId || profile?.uid || 'worker';
      addActivityLog({
        orderId: order.id,
        orderNumber: order.orderNumber,
        workerId,
        workerName,
        action: 'opened',
        customerName: order.customerName,
        eventDate: order.eventDate || order.weddingDate || order.bookingDate || '',
      }).catch(console.error);
    }
  }, [isWorker, order, profile, addActivityLog]);

  const imagesList = React.useMemo(() => {
    if (order?.designImages && order.designImages.length > 0) {
      return order.designImages.filter((img) => img.url && img.url.trim().length > 0);
    }
    if (order?.designImageUrl && order.designImageUrl.trim().length > 0) {
      return [{ url: order.designImageUrl.trim() }];
    }
    return [];
  }, [order]);

  if (!order) return null;

  const handleCopyLink = (url: string, index: number) => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedIndex(index);
    setTimeout(() => {
      setCopiedIndex(null);
    }, 2000);
  };

  const handleStatusChange = async (newStatus: OrderStatus) => {
    if (isUpdatingStatus) return;
    try {
      setIsUpdatingStatus(true);
      await updateOrder(order.id, { orderStatus: newStatus });
    } catch (error) {
      setLogToast(error instanceof Error ? error.message : 'تعذر تحديث الطلب.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleAddPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (paymentAmount <= 0 || isSavingPayment) return;

    try {
      setIsSavingPayment(true);
      await addPaymentToOrder(order.id, {
        amount: Number(paymentAmount),
        date: localDateString(),
        method: paymentMethod,
        notes: paymentNotes || 'Partial Payment',
      });

      setPaymentAmount(0);
      setPaymentNotes('');
      setShowAddPayment(false);
    } finally {
      setIsSavingPayment(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('confirmDelete')) || isDeleting) return;
    try {
      setIsDeleting(true);
      await deleteOrder(order.id);
      onClose();
    } catch (error) {
      setLogToast(error instanceof Error ? error.message : 'تعذر حذف الطلب.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLogActivity = async (action: 'arrived' | 'finished', label: string) => {
    try {
      setIsLogging(true);
      const workerName = profile?.workerName || profile?.displayName || 'المنفذ';
      const workerId = profile?.workerId || profile?.uid || 'worker';
      // Keep activity auditing in its dedicated Firestore collection. This
      // avoids adding or changing fields on the existing order document.
      await addActivityLog({
        orderId: order.id,
        orderNumber: order.orderNumber,
        workerId,
        workerName,
        action,
        customerName: order.customerName,
        eventDate: order.eventDate || order.weddingDate || order.bookingDate || '',
      });

      setLogToast(language === 'ar' ? `تم تسجيل (${label}) بنجاح` : `Logged (${label}) successfully`);
      setTimeout(() => setLogToast(null), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLogging(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col my-auto animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-amber-600 to-amber-700 text-white flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl font-mono">{order.orderNumber}</span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-white/20 uppercase">
                {order.orderStatus.replace('_', ' ')}
              </span>
            </div>
            <p className="text-xs text-amber-100 mt-0.5">
              {language === 'ar' ? settings.companyNameAr : settings.companyNameEn}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isWorker && (
              <>
                <button
                  onClick={() => onPrint(order)}
                  className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors cursor-pointer"
                  title={t('print')}
                >
                  <Printer className="w-5 h-5" />
                </button>
                <button
                  onClick={() => {
                    onClose();
                    onEdit(order);
                  }}
                  className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors cursor-pointer"
                  title={t('edit')}
                >
                  <Edit className="w-5 h-5" />
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="p-2 bg-rose-500/30 hover:bg-rose-500/50 text-white rounded-xl transition-colors cursor-pointer"
                  title={t('delete')}
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toast Alert */}
        {logToast && (
          <div className="bg-emerald-600 text-white text-xs font-bold px-4 py-2 text-center animate-in fade-in duration-150 shrink-0">
            {logToast}
          </div>
        )}

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1 text-sm text-slate-800 dark:text-slate-200">
          
          {/* WORKER QUICK ACTIONS SECTION */}
          {isWorker ? (
            <div className="p-4 bg-amber-500/10 dark:bg-amber-500/5 rounded-2xl border border-amber-500/20 space-y-3">
              <h4 className="font-extrabold text-sm text-amber-900 dark:text-amber-300 flex items-center gap-2">
                <Wrench className="w-4 h-4" />
                <span>{t('quickActions')}</span>
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {canViewCustomerContact && <>
                  {/* 1. Call */}
                  <a
                    href={toTelHref(order.customerPhone)}
                    className="p-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 shadow-sm transition-transform active:scale-95"
                  >
                    <Phone className="w-5 h-5" />
                    <span>{t('call')}</span>
                  </a>

                  {/* 2. WhatsApp */}
                  <a
                    href={toWhatsAppHref(order.customerPhone)}
                    target="_blank"
                    rel="noreferrer"
                    className="p-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 shadow-sm transition-transform active:scale-95"
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span>{t('whatsapp')}</span>
                  </a>
                </>}

                {/* 3. Location */}
                <button
                  type="button"
                  onClick={() => {
                    const url = toSafeExternalUrl(order.locationLink || '');
                    if (url) {
                      window.open(url, '_blank');
                    } else {
                      alert(t('noLocationAdded'));
                    }
                  }}
                  className="p-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 shadow-sm transition-transform active:scale-95 cursor-pointer"
                >
                  <MapPin className="w-5 h-5" />
                  <span>{t('openLocation')}</span>
                </button>

                {/* 4. Design Images */}
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById('design-images-section');
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth' });
                    }
                  }}
                  className="p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 shadow-sm transition-transform active:scale-95 cursor-pointer"
                >
                  <ImageIcon className="w-5 h-5" />
                  <span>{t('designImageSection')}</span>
                </button>
              </div>
            </div>
          ) : (
            /* ADMIN QUICK ACTIONS BAR */
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">{t('orderStatus')}:</span>
                <select
                  value={order.orderStatus}
                  onChange={(e) => handleStatusChange(e.target.value as OrderStatus)}
                  disabled={isUpdatingStatus}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-60"
                >
                  <option value="new">{t('statusNew')}</option>
                  <option value="confirmed">{t('statusConfirmed')}</option>
                  <option value="preparing">{t('statusPreparing')}</option>
                  <option value="out_for_delivery">{t('statusOutForDelivery')}</option>
                  <option value="completed">{t('statusCompleted')}</option>
                  <option value="returned">{t('statusReturned')}</option>
                  <option value="cancelled">{t('statusCancelled')}</option>
                </select>
              </div>

              {order.remainingBalance > 0 && (
                <button
                  onClick={() => {
                    setPaymentAmount(order.remainingBalance);
                    setShowAddPayment(true);
                  }}
                  disabled={isSavingPayment || isUpdatingStatus}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('addPayment')}</span>
                </button>
              )}
            </div>
          )}

          {/* Add Payment Form Drawer (Admin only) */}
          {!isWorker && showAddPayment && (
            <form onSubmit={handleAddPaymentSubmit} className="p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl border border-emerald-200 dark:border-emerald-800 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4" />
                  <span>{t('addPayment')}</span>
                </h4>
                <button type="button" onClick={() => setShowAddPayment(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t('paymentAmount')} ($)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={order.remainingBalance}
                    required
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t('paymentMethod')}
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                  >
                    <option value="InstaPay">InstaPay (انستا باي)</option>
                    <option value="Cash">Cash (كاش / نقدي)</option>
                    <option value="E-Wallet">E-Wallet (محفظة إلكترونية)</option>
                    <option value="PayPal">PayPal (بايبال)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t('notes')}
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Second installment"
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddPayment(false)}
                  disabled={isSavingPayment}
                  className="px-3 py-1 text-xs font-semibold rounded-lg border border-slate-300"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSavingPayment}
                  className="px-4 py-1 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {isSavingPayment ? 'جارٍ الحفظ...' : t('save')}
                </button>
              </div>
            </form>
          )}

          {/* DEDICATED CUSTOMER CONTACT CARD (بيانات التواصل) */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
            <span className="text-xs text-slate-400 font-semibold flex items-center gap-1">
              <Phone className="w-4 h-4 text-amber-500" />
              <span>{t('contactInfo')}</span>
            </span>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-base font-extrabold text-slate-900 dark:text-white">
                  {order.customerName}
                </p>
                {canViewCustomerContact && <p className="text-sm font-mono text-slate-600 dark:text-slate-300 font-bold dir-ltr text-left sm:text-right mt-0.5">
                  {order.customerPhone}
                </p>}
                {order.salesEmployee && !isWorker && (
                  <p className="text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-1 mt-1 font-semibold">
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>{t('salesEmployee')}: {order.salesEmployee}</span>
                  </p>
                )}
                {order.executorName && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1 font-semibold">
                    <Wrench className="w-3.5 h-3.5" />
                    <span>{t('executor')}: {order.executorName}</span>
                  </p>
                )}
              </div>

              {canViewCustomerContact && !isWorker && <div className="flex items-center gap-2 shrink-0">
                <a
                  href={toTelHref(order.customerPhone)}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <Phone className="w-4 h-4" />
                  <span>{t('call')}</span>
                </a>
                <a
                  href={toWhatsAppHref(order.customerPhone)}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>{t('whatsapp')}</span>
                </a>
              </div>}
            </div>
          </div>

          {/* Event Venue & Dates Info */}
          <div className="p-4 bg-amber-50/30 dark:bg-amber-950/20 rounded-2xl border border-amber-200/50 dark:border-amber-900/30 space-y-2">
            <p className="text-xs text-slate-400 font-semibold">{t('eventLocation')}</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{order.eventLocation}</span>
            </p>

            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-2">
              {!isWorker && (
                <>
                  <span className="flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                    <Calendar className="w-3.5 h-3.5 text-emerald-500" />
                    {t('bookingDate')}: <strong>{order.bookingDate || order.createdAt.split('T')[0]}</strong>
                  </span>
                  <span>•</span>
                </>
              )}
              <span className="flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
                <Calendar className="w-3.5 h-3.5 text-amber-500" />
                {t('eventDate')}: <strong>{order.eventDate || order.weddingDate}</strong>
              </span>
              <span>•</span>
              <span>
                {t('deliveryDate')}: <strong>{order.deliveryDate}</strong>
              </span>
              {order.returnDate && (
                <>
                  <span>•</span>
                  <span>
                    {t('returnDate')}: <strong>{order.returnDate}</strong>
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Installation Location Card */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs text-slate-400 font-semibold flex items-center gap-1">
                <MapPin className="w-4 h-4 text-amber-500" />
                <span>{t('installationLocation')}</span>
              </span>
              {order.locationLink?.trim() ? (
                <p className="text-xs font-mono text-slate-600 dark:text-slate-300 mt-1 truncate max-w-md ltr:text-left rtl:text-right">
                  {order.locationLink}
                </p>
              ) : (
                <p className="text-xs text-slate-400 italic mt-1">
                  {t('noLocationAdded')}
                </p>
              )}
            </div>

            {order.locationLink?.trim() && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const url = toSafeExternalUrl(order.locationLink || '');
                    if (url) window.open(url, '_blank');
                  }}
                  className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <MapPin className="w-4 h-4" />
                  <span>{t('openLocation')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const url = order.locationLink!.trim().startsWith('http')
                      ? order.locationLink!.trim()
                      : `https://${order.locationLink!.trim()}`;
                    navigator.clipboard.writeText(url);
                    setCopiedLocation(true);
                    setTimeout(() => setCopiedLocation(false), 2000);
                  }}
                  className="px-3.5 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                  <span>{copiedLocation ? t('copied') : t('copyLink')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Financials Breakdown (Admin Only) */}
          {!isWorker && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 text-center">
                <div>
                  <span className="text-xs text-slate-400 font-semibold">{t('totalPrice')}</span>
                  <p className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                    ${order.totalPrice.toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-400 font-semibold">{t('totalPaid')}</span>
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    ${(order.totalPaid ?? order.deposit).toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-400 font-semibold">{t('securityDeposit')}</span>
                  <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">
                    ${(order.securityDeposit || 0).toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-400 font-semibold">{t('remainingBalance')}</span>
                  <p className="text-lg font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                    ${order.remainingBalance.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Order Expenses & Net Profit Breakdown */}
              <div className="p-4 bg-rose-50/30 dark:bg-rose-950/20 rounded-2xl border border-rose-200/60 dark:border-rose-900/40 space-y-3">
                <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-rose-500" />
                  <span>{t('orderExpensesSection')}</span>
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700">
                    <span className="text-[11px] text-slate-500 font-semibold">{t('workerCost')}</span>
                    <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      ${(order.workerCost || 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700">
                    <span className="text-[11px] text-slate-500 font-semibold">{t('transportationCost')}</span>
                    <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      ${(order.transportationCost || 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700">
                    <span className="text-[11px] text-slate-500 font-semibold">{t('otherExpenses')}</span>
                    <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      ${(order.otherExpenses || 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-2 bg-rose-100/60 dark:bg-rose-950/50 rounded-xl border border-rose-200 dark:border-rose-800">
                    <span className="text-[11px] text-rose-700 dark:text-rose-300 font-semibold">{t('totalOrderExpenses')}</span>
                    <p className="text-sm font-extrabold text-rose-800 dark:text-rose-200 mt-0.5">
                      ${((order.workerCost || 0) + (order.transportationCost || 0) + (order.otherExpenses || 0)).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-2 bg-amber-100/60 dark:bg-amber-950/50 rounded-xl border border-amber-200 dark:border-amber-800 col-span-2 sm:col-span-1">
                    <span className="text-[11px] premium-gold font-semibold">{t('expectedNetProfit')}</span>
                    <p className="text-sm font-extrabold premium-gold mt-0.5">
                      ${(order.totalPrice - ((order.workerCost || 0) + (order.transportationCost || 0) + (order.otherExpenses || 0))).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Design Image / صورة التصميم */}
          <div id="design-images-section" className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-indigo-500" />
                <span>{t('designImageSection')}</span>
              </h4>

              {!isWorker && (
                <button
                  type="button"
                  onClick={() => {
                    window.open('https://drive.google.com/drive/u/1/folders/1mkwZJhpDPTZHiC-RZE8E31xXAF6Rsjh8', '_blank');
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{t('uploadDesignImage')}</span>
                </button>
              )}
            </div>

            {imagesList.length === 0 ? (
              <div className="p-3 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
                <span className="text-xs text-slate-400 italic">{t('noDesignImage')}</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {imagesList.map((img, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 p-2.5 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="flex-1 min-w-0">
                      <span className="block text-[11px] text-slate-400 font-semibold mb-0.5">
                        {t('designImageUrl')} {imagesList.length > 1 ? `#${idx + 1}` : ''}
                      </span>
                      <p className="text-xs font-mono text-slate-700 dark:text-slate-300 truncate dir-ltr text-left">
                        {img.url}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => {
                          if (img.url && img.url.trim().length > 0) {
                            const url = toSafeExternalUrl(img.url);
                            if (url) window.open(url, '_blank');
                          } else {
                            alert(t('noLink'));
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>{t('openLink')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopyLink(img.url, idx)}
                        className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-800 text-slate-800 dark:text-white text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                      >
                        {copiedIndex === idx ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{t('copiedLink')}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>{t('copyLink')}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payment History List (Admin only) */}
          {!isWorker && order.paymentHistory && order.paymentHistory.length > 0 && (
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-2 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-500" />
                <span>{t('paymentHistory')}</span>
              </h4>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden text-xs">
                {order.paymentHistory.map((pay) => (
                  <div key={pay.id} className="p-2.5 bg-white dark:bg-slate-800/50 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white">${pay.amount.toLocaleString()}</span>
                      <span className="mx-2 text-slate-400">({pay.method})</span>
                      {pay.notes && <span className="text-slate-500 italic">- {pay.notes}</span>}
                    </div>
                    <span className="text-slate-400 font-mono">{pay.date}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reserved Inventory Equipment */}
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-3 flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-500" />
              <span>{t('reservedInventory')}</span>
            </h4>

            {order.reservedItems && order.reservedItems.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                {order.reservedItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-white dark:bg-slate-800/50 flex items-center justify-between"
                  >
                    <span className="font-medium text-slate-900 dark:text-white">
                      {item.inventoryItemName}
                    </span>
                    <span className="px-2.5 py-1 bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 rounded-lg font-bold text-xs">
                      Qty: {item.quantity}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">No inventory items specified.</p>
            )}
          </div>

          {/* Notes */}
          {order.notes && (
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-1 flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-500" />
                <span>{t('notes')}</span>
              </h4>
              <p className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                {order.notes}
              </p>
            </div>
          )}

          {/* Attachments */}
          {order.attachments && order.attachments.length > 0 && (
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-2 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-purple-500" />
                <span>{t('attachments')}</span>
              </h4>
              <div className="flex flex-wrap gap-3">
                {order.attachments.map((att) => (
                  <a
                    key={att.id}
                    href={att.url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-semibold hover:bg-slate-100"
                  >
                    {att.type === 'contract' ? <FileText className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                    <span>{att.type === 'contract' ? 'Contract' : 'Photo'}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* FUTURE FEATURE: WORKER EXECUTION ACTIVITY LOG BUTTONS */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
            <h4 className="font-bold text-xs text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-500" />
                <span>{t('activityLogs')}</span>
              </span>
              <span className="text-[10px] text-slate-400 font-normal">تسجيل التحركات الميدانية</span>
            </h4>

            {/* Action Buttons */}
            {isWorker && (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleLogActivity('arrived', language === 'ar' ? 'تم الوصول' : 'Arrived')}
                  disabled={isLogging}
                  className="p-3 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"
                >
                  <Car className="w-4 h-4" />
                  <span>{t('markArrived')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleLogActivity('finished', language === 'ar' ? 'تم الانتهاء' : 'Finished')}
                  disabled={isLogging}
                  className="p-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>{t('markFinished')}</span>
                </button>
              </div>
            )}

            {/* Recorded Activity Logs List */}
            {order.activityLogs && order.activityLogs.length > 0 ? (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pt-1">
                {order.activityLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 bg-white dark:bg-slate-900 rounded-xl text-xs border border-slate-200 dark:border-slate-700 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
                      {log.action === 'arrived' ? <Car className="w-4 h-4 text-amber-500" /> : <Check className="w-4 h-4 text-emerald-500" />}
                      <span>{log.actionText}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(log.timestamp).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">لا توجد تسجيلات تحركات مسجلة لهذا الطلب حتى الآن</p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};
