import React from 'react';
import { Printer, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { Order } from '../../types';
import { OrderSourceBadge } from './OrderSourceBadge';

interface OrderInvoicePrintProps {
  order: Order | null;
  onClose: () => void;
}

export const OrderInvoicePrint: React.FC<OrderInvoicePrintProps> = ({ order, onClose }) => {
  const { language, t } = useLanguage();
  const { settings } = useData();

  if (!order) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div onClick={(e) => e.stopPropagation()} className="bg-white text-slate-900 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[95vh] print:max-h-none print:shadow-none print:border-none">
        {/* Screen Controls Header - Hidden on print */}
        <div className="p-4 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between print:hidden">
          <span className="font-bold text-sm text-slate-800 dark:text-white">
            Contract & Invoice Preview - {order.orderNumber}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl shadow-sm flex items-center gap-2 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>{t('print')}</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Invoice Container */}
        <div className="p-8 space-y-6 overflow-y-auto flex-1 bg-white print:p-0 print:overflow-visible">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-slate-300 pb-6">
            <div>
              <h1 className="text-xl font-bold text-amber-600">
                {language === 'ar' ? settings.companyNameAr : settings.companyNameEn}
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                {language === 'ar' ? settings.addressAr : settings.addressEn}
              </p>
              <p className="text-xs text-slate-500">
                {t('phoneNumber')}: {settings.phone} | {settings.companyEmail}
              </p>
              {settings.taxNumber && (
                <p className="text-xs text-slate-500">{t('taxNumber')}: {settings.taxNumber}</p>
              )}
            </div>

            <div className="text-end">
              <span className="px-3 py-1 bg-amber-100 text-amber-800 text-xs font-extrabold rounded-lg uppercase">
                {t('orderDetails')}
              </span>
              <p className="text-lg font-extrabold text-slate-900 mt-2">{order.orderNumber}</p>
              <div className="mt-1.5 flex justify-end"><OrderSourceBadge source={order.orderSource} language={language} /></div>
              <p className="text-xs text-slate-500">
                {t('date')}: {new Date().toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Customer & Event Details */}
          <div className="grid grid-cols-2 gap-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase">{t('customerProfile')}</h3>
              <p className="text-sm font-bold text-slate-900 mt-1">{order.customerName}</p>
              <p className="text-xs text-slate-600 mt-0.5">{order.customerPhone}</p>
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase">{t('eventLocation')}</h3>
              <p className="text-sm font-bold text-slate-900 mt-1">{order.eventLocation}</p>
              {order.locationLink?.trim() && (
                <p className="text-xs text-amber-700 font-semibold mt-0.5 break-all">
                  {t('installationLocation')}: {order.locationLink}
                </p>
              )}
              <p className="text-xs text-slate-600 mt-0.5">
                {t('weddingDate')}: {order.weddingDate} | {t('deliveryDate')}: {order.deliveryDate}
              </p>
            </div>
          </div>

          {/* Reserved Equipment Table */}
          <div>
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">
              {t('reservedInventory')}
            </h3>
            <table className="w-full text-start text-xs border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-100 text-slate-700 font-bold">
                <tr>
                  <th className="p-2.5 text-start">#</th>
                  <th className="p-2.5 text-start">{t('itemName')}</th>
                  <th className="p-2.5 text-center">{t('quantity')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {order.reservedItems && order.reservedItems.length > 0 ? (
                  order.reservedItems.map((item, idx) => (
                    <tr key={idx}>
                      <td className="p-2.5 font-semibold text-slate-400">{idx + 1}</td>
                      <td className="p-2.5 font-bold text-slate-900">{item.inventoryItemName}</td>
                      <td className="p-2.5 text-center font-bold text-amber-700">{item.quantity}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-slate-400">
                      Standard Wedding Decoration Setup
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pricing Summary */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1.5 text-xs bg-amber-50 p-4 rounded-xl border border-amber-200">
              <div className="flex justify-between font-medium">
                <span>{t('totalPrice')}:</span>
                <span className="font-bold text-slate-900">${order.totalPrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>{t('deposit')}:</span>
                <span className="font-bold text-emerald-700">${order.deposit.toLocaleString()}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>{t('securityDeposit')}:</span>
                <span className="font-bold text-indigo-700">${(order.securityDeposit || 0).toLocaleString()}</span>
              </div>
              <div className="border-t border-amber-200 pt-1.5 flex justify-between font-extrabold text-sm text-slate-900">
                <span>{t('remainingBalance')}:</span>
                <span className="text-rose-600">${order.remainingBalance.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Terms & Conditions */}
          <div className="border-t border-slate-200 pt-4 text-[11px] text-slate-500 space-y-1">
            <h4 className="font-bold text-slate-700">{t('terms')}</h4>
            <p className="whitespace-pre-line leading-relaxed">
              {language === 'ar' ? settings.termsAr : settings.termsEn}
            </p>
          </div>

          {/* Signature Block */}
          <div className="pt-12 grid grid-cols-2 gap-12 text-center text-xs font-bold text-slate-700">
            <div>
              <p>Manager Signature / توقيع الشركة</p>
              <div className="mt-8 border-b border-slate-400 w-40 mx-auto" />
            </div>
            <div>
              <p>Customer Signature / توقيع العميل</p>
              <div className="mt-8 border-b border-slate-400 w-40 mx-auto" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
