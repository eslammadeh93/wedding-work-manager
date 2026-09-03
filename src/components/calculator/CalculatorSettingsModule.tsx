import React, { useEffect, useState } from 'react';
import { Calculator, ExternalLink, MapPin, Pencil, Plus, Settings2, Trash2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import type { OrderPriceCatalogItem, TransportationSavedLocation } from '../../types';

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-800';

/** The manage-only workspace for both calculators' saved data. */
export const CalculatorSettingsModule: React.FC = () => {
  const { authSession } = useAuth();
  const { settings, updateSettings } = useData();
  const [catalog, setCatalog] = useState<OrderPriceCatalogItem[]>(settings.orderPriceCatalog || []);
  const [savedLocations, setSavedLocations] = useState<TransportationSavedLocation[]>(settings.transportationSavedLocations || []);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [locationName, setLocationName] = useState('');
  const [locationUrl, setLocationUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const canManage = Boolean(authSession?.permissions.includes('company:calculator:manage'));

  useEffect(() => setCatalog(settings.orderPriceCatalog || []), [settings.orderPriceCatalog]);
  useEffect(() => setSavedLocations(settings.transportationSavedLocations || []), [settings.transportationSavedLocations]);

  const saveCatalog = async (next: OrderPriceCatalogItem[]) => {
    if (!canManage) return;
    setCatalog(next); setIsSaving(true); setError('');
    try { await updateSettings({ orderPriceCatalog: next }); }
    catch { setError('تعذر حفظ إعدادات حاسبة الأوردرات.'); }
    finally { setIsSaving(false); }
  };
  const resetCatalog = () => { setName(''); setPrice(''); setEditingId(null); };
  const saveCatalogItem = async () => {
    const cleanName = name.trim(); const unitPrice = Number(price);
    if (!cleanName || !Number.isFinite(unitPrice) || unitPrice < 0) { setError('اكتب اسمًا وسعرًا صحيحين للوحدة.'); return; }
    const next = editingId
      ? catalog.map((item) => item.id === editingId ? { ...item, name: cleanName, unitPrice } : item)
      : [...catalog, { id: newId('price'), name: cleanName, unitPrice }];
    await saveCatalog(next); resetCatalog();
  };
  const saveLocations = async (next: TransportationSavedLocation[]) => {
    if (!canManage) return;
    setSavedLocations(next); setIsSaving(true); setError('');
    try { await updateSettings({ transportationSavedLocations: next }); }
    catch { setError('تعذر حفظ المواقع المحفوظة.'); }
    finally { setIsSaving(false); }
  };
  const saveLocation = async () => {
    const cleanName = locationName.trim(); const cleanUrl = locationUrl.trim();
    if (!cleanName || !cleanUrl) { setError('اكتب اسم الموقع ورابط Google Maps.'); return; }
    try {
      const url = new URL(cleanUrl);
      if (url.protocol !== 'https:' || !(url.hostname === 'maps.app.goo.gl' || url.hostname === 'google.com' || url.hostname.endsWith('.google.com'))) throw new Error();
    } catch { setError('ضع رابط مشاركة صحيحًا من Google Maps.'); return; }
    await saveLocations([...savedLocations, { id: newId('location'), name: cleanName, mapUrl: cleanUrl }]);
    setLocationName(''); setLocationUrl('');
  };

  return <div dir="rtl" className="mx-auto max-w-5xl space-y-6 animate-in fade-in duration-300">
    <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"><Settings2 className="h-6 w-6" /></div><div><h1 className="text-xl font-black text-slate-900 dark:text-white">إعدادات الحاسبات</h1><p className="mt-0.5 text-xs text-slate-500">إدارة أسعار حاسبة الأوردرات والمواقع المحفوظة لحاسبة الانتقالات.</p></div></div></header>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">{error}</p>}
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="mb-4 flex items-center gap-2"><Calculator className="h-5 w-5 text-emerald-600" /><div><h2 className="font-black text-slate-900 dark:text-white">إعدادات حاسبة الأوردرات</h2><p className="text-xs text-slate-500">أضف الخدمات أو المكوّنات وسعر الوحدة.</p></div></div><div className="flex flex-col gap-2 sm:flex-row"><input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveCatalogItem(); } }} placeholder="اسم المكوّن أو الخدمة" className={`${inputClass} min-w-0 flex-1`} /><input type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveCatalogItem(); } }} placeholder="سعر الوحدة" className={`${inputClass} sm:w-40`} /><button type="button" onClick={() => void saveCatalogItem()} disabled={isSaving} className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-60">{editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingId ? 'حفظ التعديل' : 'إضافة'}</button>{editingId && <button type="button" onClick={resetCatalog} disabled={isSaving} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"><X className="h-4 w-4" />إلغاء</button>}</div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{catalog.length ? catalog.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"><span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800 dark:text-slate-100">{item.name}</span><strong className="font-mono text-sm text-emerald-700 dark:text-emerald-300">{item.unitPrice.toLocaleString()}</strong><button type="button" onClick={() => { setEditingId(item.id); setName(item.name); setPrice(String(item.unitPrice)); }} disabled={isSaving} className="rounded-lg p-1 text-amber-600 hover:bg-amber-50 disabled:opacity-60" aria-label={`تعديل ${item.name}`}><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => void saveCatalog(catalog.filter((entry) => entry.id !== item.id))} disabled={isSaving} className="rounded-lg p-1 text-rose-500 hover:bg-rose-50 disabled:opacity-60" aria-label={`حذف ${item.name}`}><Trash2 className="h-4 w-4" /></button></div>) : <p className="col-span-full rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-400 dark:bg-slate-800/60">أضف أول مكوّن لتبدأ الحاسبة.</p>}</div></section>
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="mb-4 flex items-center gap-2"><MapPin className="h-5 w-5 text-sky-600" /><div><h2 className="font-black text-slate-900 dark:text-white">إعدادات حاسبة الانتقالات</h2><p className="text-xs text-slate-500">احفظ المواقع المتكررة لتظهر ضمن اختيارات الانطلاق والوجهة.</p></div></div><div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"><input value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="اسم الموقع، مثل: مخزن التجمع" className={inputClass} /><input dir="ltr" type="url" value={locationUrl} onChange={(event) => setLocationUrl(event.target.value)} placeholder="https://maps.app.goo.gl/..." className={inputClass} /><button type="button" onClick={() => void saveLocation()} disabled={isSaving} className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-60"><Plus className="h-4 w-4" />حفظ الموقع</button></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{savedLocations.length ? savedLocations.map((location) => <div key={location.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"><MapPin className="h-4 w-4 shrink-0 text-emerald-600" /><span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800 dark:text-slate-100">{location.name}</span><a href={location.mapUrl} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-emerald-600 dark:hover:bg-slate-700" aria-label={`فتح ${location.name}`}><ExternalLink className="h-4 w-4" /></a><button type="button" onClick={() => void saveLocations(savedLocations.filter((item) => item.id !== location.id))} disabled={isSaving} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-60" aria-label={`حذف ${location.name}`}><Trash2 className="h-4 w-4" /></button></div>) : <p className="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-400 dark:bg-slate-800">لا توجد مواقع محفوظة بعد.</p>}</div></section>
  </div>;
};
