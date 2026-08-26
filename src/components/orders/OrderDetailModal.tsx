import React, { useState } from 'react';
import {
  X,
  Printer,
  Calendar,
  MapPin,
  Phone,
  Edit,
  Trash2,
  FileText,
  Wrench,
  Plus,
  CreditCard,
  Image as ImageIcon,
  Upload,
  ExternalLink,
  Copy,
  Check,
  MessageCircle,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { Order, OrderStatus, WorkerMovement } from '../../types';
import { toSafeExternalUrl } from '../../utils/security';
import { localDateString } from '../../utils/localDate';
import { getOrderStatusLabel } from '../../utils/orderStatus';
import { toTelHref, toWhatsAppHref } from '../../utils/phone';
import { canViewCustomerContact as contactIsVisible } from '../../utils/workerContact';
import { companyDataService } from '../../multiTenant/data/companyDataService';
import { trustedCompanyIdFromSession } from '../../multiTenant/data/useTrustedCompanyId';
import { OrderSourceBadge } from './OrderSourceBadge';
import { OrderAttachmentsSection, OrderCustomerSection, OrderExecutionLog, OrderFinancialSummary, OrderInventorySection, OrderPaymentHistory } from './OrderDetailSections';

interface OrderDetailModalProps {
  order: Order | null;
  onClose: () => void;
  onEdit: (order: Order) => void;
  onPrint: (order: Order) => void;
  onDelete: (order: Order) => Promise<void>;
}

export const OrderDetailModal: React.FC<OrderDetailModalProps> = ({
  order,
  onClose,
  onEdit,
  onPrint,
  onDelete,
}) => {
  const { t, language } = useLanguage();
  const { updateOrder, settings, addPaymentToOrder, addActivityLog, recordWorkerMovement } = useData();
  const { profile, authSession, isDemo } = useAuth();

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
  const [logToastIsError, setLogToastIsError] = useState(false);
  const [workerMovements, setWorkerMovements] = useState<WorkerMovement[]>([]);

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

  React.useEffect(() => {
    if (isDemo || !order || !authSession) { setWorkerMovements([]); return; }
    let companyId: string;
    try { companyId = trustedCompanyIdFromSession(authSession); }
    catch { setWorkerMovements([]); return; }
    return companyDataService.subscribeOrderWorkerMovements<WorkerMovement>(companyId, order.id, isWorker ? profile?.workerId : undefined, setWorkerMovements, () => setWorkerMovements([]));
  }, [authSession, isDemo, isWorker, order?.id, profile?.workerId]);

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
        // Settlement payments belong to the execution month, not the day the
        // record happens to be edited.
        date: order.eventDate || order.weddingDate || localDateString(),
        method: paymentMethod,
        type: 'settlement',
        notes: paymentNotes || 'Settlement Payment',
      });

      setPaymentAmount(0);
      setPaymentNotes('');
      setShowAddPayment(false);
    } finally {
      setIsSavingPayment(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('سيُنقل الأوردر إلى سلة المحذوفات لمدة 30 يومًا وسيتم تحرير مخزونه المحجوز. هل تريد المتابعة؟') || isDeleting) return;
    try {
      setIsDeleting(true);
      await onDelete(order);
      onClose();
    } catch (error) {
      setLogToast(error instanceof Error ? error.message : 'تعذر حذف الطلب.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLogActivity = async (action: WorkerMovement['action']) => {
    try {
      setIsLogging(true);
      await recordWorkerMovement(order.id, action);
      setLogToastIsError(false);
      setLogToast(language === 'ar' ? 'تم إرسال بلاغك للمديرين بنجاح. لم تتغير حالة الطلب تلقائياً.' : 'Your report was sent to managers. The order was not changed automatically.');
      setTimeout(() => setLogToast(null), 3000);
    } catch (err) {
      setLogToastIsError(true);
      setLogToast(err instanceof Error ? err.message : 'تعذر تسجيل بلاغ المنفذ. حاول مرة أخرى.');
    } finally {
      setIsLogging(false);
    }
  };

  const hasArrived = workerMovements.some(movement => movement.action === 'arrived');
  const hasCompleted = workerMovements.some(movement => movement.action === 'completed');
  const movementTime = (value: unknown) => {
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate() as Date;
    return new Date(typeof value === 'string' || typeof value === 'number' ? value : Date.now());
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col my-auto animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-amber-600 to-amber-700 text-white flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl font-mono">{order.orderNumber}</span>
              {!isWorker && <OrderSourceBadge source={order.orderSource} language={language} />}
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-white/20 uppercase">
                {getOrderStatusLabel(order.orderStatus, t)}
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
          <div className={`${logToastIsError ? 'bg-red-600' : 'bg-emerald-600'} text-white text-xs font-bold px-4 py-2 text-center animate-in fade-in duration-150 shrink-0`}>
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
                  <option value="cancelled_deposit_retained">{t('statusCancelledDepositRetained')}</option>
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
                  <span>{language === 'ar' ? 'إضافة دفعة سداد' : 'Add Settlement Payment'}</span>
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
                  <span>{language === 'ar' ? 'إضافة دفعة سداد' : 'Add Settlement Payment'}</span>
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
                    className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-300 bg-white text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
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

              <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                {language === 'ar'
                  ? `سيُسجَّل السداد بتاريخ التنفيذ: ${order.eventDate || order.weddingDate || localDateString()}`
                  : `This settlement will be recorded on the execution date: ${order.eventDate || order.weddingDate || localDateString()}`}
              </p>

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

          <OrderCustomerSection order={order} isWorker={isWorker} canViewCustomerContact={canViewCustomerContact} />

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

          {!isWorker && <OrderFinancialSummary order={order} />}

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

          <OrderPaymentHistory order={order} isWorker={isWorker} />
          <OrderInventorySection order={order} isWorker={isWorker} />

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

          <OrderAttachmentsSection order={order} />
          <OrderExecutionLog
            movements={workerMovements}
            isWorker={isWorker}
            isLogging={isLogging}
            hasArrived={hasArrived}
            hasCompleted={hasCompleted}
            onLog={handleLogActivity}
            formatTime={(value) => movementTime(value).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
          />

        </div>
      </div>
    </div>
  );
};
