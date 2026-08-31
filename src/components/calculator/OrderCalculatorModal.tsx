import React, { useMemo, useState } from 'react';
import { Calculator, Trash2, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import type { OrderPricingLine } from '../../types';

const newId = () => `line_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

export const OrderCalculatorModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { settings } = useData();
  const [lines, setLines] = useState<OrderPricingLine[]>([]);
  const total = useMemo(() => lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0), [lines]);
  const catalog = settings.orderPriceCatalog || [];
  const addLine = (catalogItemId: string) => {
    const selected = catalog.find((item) => item.id === catalogItemId);
    if (!selected) return;
    setLines((current) => {
      const existing = current.find((line) => line.catalogItemId === selected.id);
      return existing ? current.map((line) => line.id === existing.id ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { id: newId(), catalogItemId: selected.id, name: selected.name, unitPrice: selected.unitPrice, quantity: 1 }];
    });
  };
  if (!isOpen) return null;
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={onClose}><section role="dialog" aria-modal="true" aria-label="حاسبة عرض العميل" dir="rtl" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl dark:bg-slate-900" onMouseDown={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800"><div><h2 className="flex items-center gap-2 text-lg font-black text-slate-900 dark:text-white"><Calculator className="h-5 w-5 text-emerald-500" />حاسبة عرض العميل</h2><p className="mt-1 text-xs text-slate-500">الحساب محفوظ عند الإغلاق، ولا يتصفر إلا عند الضغط على «حساب جديد».</p></div><button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="إغلاق الحاسبة"><X className="h-5 w-5" /></button></header><div className="space-y-4 p-5"><select onChange={(event) => { if (event.target.value) { addLine(event.target.value); event.target.value = ''; } }} className="w-full rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-3 text-sm font-bold text-emerald-900 outline-none focus:ring-2 focus:ring-emerald-500 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"><option value="">+ اختر مكوّنًا لإضافته للحساب</option>{catalog.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.unitPrice.toLocaleString()}</option>)}</select>{lines.length ? <div className="space-y-2">{lines.map((line) => <div key={line.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700"><span className="min-w-0 flex-1 truncate font-bold text-slate-900 dark:text-white">{line.name}</span><span className="font-mono text-xs text-slate-500">{line.unitPrice.toLocaleString()} ×</span><input type="number" min="1" value={line.quantity} onChange={(event) => setLines((current) => current.map((entry) => entry.id === line.id ? { ...entry, quantity: Math.max(1, Number(event.target.value) || 1) } : entry))} className="w-16 rounded-lg border border-slate-300 bg-slate-50 px-2 py-1.5 text-center font-bold dark:border-slate-600 dark:bg-slate-800" /><strong className="w-24 font-mono text-left text-emerald-700 dark:text-emerald-300">{(line.unitPrice * line.quantity).toLocaleString()}</strong><button type="button" onClick={() => setLines((current) => current.filter((entry) => entry.id !== line.id))} className="rounded-lg p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30" aria-label={`حذف ${line.name}`}><Trash2 className="h-4 w-4" /></button></div>)}</div> : <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-400 dark:bg-slate-800">لم تضف مكوّنات للحساب بعد.</p>}<div className="flex items-center justify-between rounded-2xl bg-emerald-600 p-4 text-white"><span className="font-bold">إجمالي حساب العميل</span><strong className="font-mono text-2xl">{total.toLocaleString()}</strong></div><button type="button" onClick={() => setLines([])} className="w-full rounded-xl border border-slate-200 py-2.5 text-xs font-black text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">حساب جديد</button></div></section></div>;
};
