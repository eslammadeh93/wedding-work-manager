import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { sanitizePhoneInput } from '../../utils/phone';
import type { Supplier } from '../../types';

interface SupplierModalProps {
  supplier?: Supplier | null;
  onClose: () => void;
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
    <span className="mb-1.5 block">{label}</span>
    {children}
  </label>
);

const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:ring-2 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white';

export const SupplierModal: React.FC<SupplierModalProps> = ({ supplier, onClose }) => {
  const { addSupplier, updateSupplier } = useData();
  const [form, setForm] = useState({
    name: supplier?.name || '', contactPerson: supplier?.contactPerson || '', service: supplier?.service || '', area: supplier?.area || '',
    serviceAreas: supplier?.serviceAreas?.join(', ') || '', phone: supplier?.phone || '', secondaryPhone: supplier?.secondaryPhone || '',
    whatsapp: supplier?.whatsapp || '', address: supplier?.address || '', locationLink: supplier?.locationLink || '',
    priceNotes: supplier?.priceNotes || '', notes: supplier?.notes || '', rating: supplier?.rating?.toString() || '0', status: supplier?.status || 'active',
  });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(), contactPerson: form.contactPerson.trim(), service: form.service.trim(), area: form.area.trim(),
      serviceAreas: form.serviceAreas.split(',').map(item => item.trim()).filter(Boolean), phone: form.phone.trim(),
      secondaryPhone: form.secondaryPhone.trim(), whatsapp: form.whatsapp.trim(), address: form.address.trim(), locationLink: form.locationLink.trim(),
      priceNotes: form.priceNotes.trim(), notes: form.notes.trim(), rating: Math.min(5, Math.max(0, Number(form.rating) || 0)), status: form.status as Supplier['status'],
    };
    try {
      if (supplier) await updateSupplier(supplier.id, payload);
      else await addSupplier(payload);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={onClose} dir="rtl">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-800/70">
          <div><h3 className="text-lg font-black text-slate-900 dark:text-white">{supplier ? 'تعديل جهة الاتصال' : 'إضافة مورد / جهة اتصال'}</h3><p className="mt-0.5 text-xs text-slate-500">سجّل بيانات المورد التي تساعدك في اختياره للتجهيزات القادمة.</p></div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={submit} className="max-h-[calc(92vh-89px)] overflow-y-auto p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="اسم المورد / الشركة *"><input required autoFocus value={form.name} onChange={e => set('name', e.target.value)} className={inputClass} placeholder="مثال: شركة النور للتجهيزات" /></Field>
            <Field label="اسم مسؤول التواصل"><input value={form.contactPerson} onChange={e => set('contactPerson', e.target.value)} className={inputClass} placeholder="اسم الشخص المسؤول" /></Field>
            <Field label="الخدمة أو الشغل *"><input required value={form.service} onChange={e => set('service', e.target.value)} className={inputClass} placeholder="ورد، كراسي، إضاءة، تصوير..." /></Field>
            <Field label="المنطقة الأساسية *"><input required value={form.area} onChange={e => set('area', e.target.value)} className={inputClass} placeholder="مثال: مدينة نصر" /></Field>
            <Field label="مناطق خدمة إضافية"><input value={form.serviceAreas} onChange={e => set('serviceAreas', e.target.value)} className={inputClass} placeholder="المعادي، التجمع، أكتوبر" /></Field>
            <Field label="رقم الهاتف *"><input required value={form.phone} onChange={e => set('phone', sanitizePhoneInput(e.target.value))} className={inputClass} dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" /></Field>
            <Field label="رقم واتساب (إن كان مختلفًا)"><input value={form.whatsapp} onChange={e => set('whatsapp', sanitizePhoneInput(e.target.value))} className={inputClass} dir="ltr" inputMode="tel" placeholder="اتركه فارغًا لاستخدام رقم الهاتف" /></Field>
            <Field label="رقم بديل"><input value={form.secondaryPhone} onChange={e => set('secondaryPhone', sanitizePhoneInput(e.target.value))} className={inputClass} dir="ltr" inputMode="tel" placeholder="رقم إضافي" /></Field>
            <Field label="تقييمك للمورد"><select value={form.rating} onChange={e => set('rating', e.target.value)} className={inputClass}>{[0, 1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value === 0 ? 'بدون تقييم' : `${value} من 5`}</option>)}</select></Field>
            <Field label="الحالة"><select value={form.status} onChange={e => set('status', e.target.value)} className={inputClass}><option value="active">متاح للتعامل</option><option value="inactive">موقوف مؤقتًا</option></select></Field>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="العنوان"><input value={form.address} onChange={e => set('address', e.target.value)} className={inputClass} placeholder="عنوان أو وصف المكان" /></Field>
            <Field label="رابط الموقع على الخريطة"><input type="url" dir="ltr" value={form.locationLink} onChange={e => set('locationLink', e.target.value)} className={inputClass} placeholder="https://maps.google.com/..." /></Field>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="ملاحظات أسعار أو تأجير"><textarea rows={3} value={form.priceNotes} onChange={e => set('priceNotes', e.target.value)} className={inputClass} placeholder="أسعار تقريبية، حد أدنى، خصم..." /></Field>
            <Field label="ملاحظات داخلية"><textarea rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} className={inputClass} placeholder="الجودة، الالتزام، شروط التعامل..." /></Field>
          </div>
          <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-5 dark:border-slate-800"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">إلغاء</button><button disabled={saving} className="rounded-xl bg-amber-500 px-6 py-2.5 text-xs font-extrabold text-white shadow-md shadow-amber-500/20 hover:bg-amber-600 disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : supplier ? 'حفظ التعديلات' : 'إضافة جهة الاتصال'}</button></div>
        </form>
      </div>
    </div>
  );
};
