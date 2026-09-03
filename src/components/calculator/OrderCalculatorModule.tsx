import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, ExternalLink, LoaderCircle, MapPin, Pencil, Plus, Route, Settings2, Trash2, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { transportationService } from '../../multiTenant/transportationService';
import type { OrderPriceCatalogItem, TransportationSavedLocation } from '../../types';

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800';
const km = (meters: number) => meters / 1_000;
const currency = (value: number) => `${value.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;

export const OrderCalculatorModule: React.FC<{ onOpenCalculator: () => void }> = ({ onOpenCalculator }) => {
  const { settings, updateSettings } = useData();
  const [tab, setTab] = useState<'orders' | 'transportation'>('orders');
  const [catalog, setCatalog] = useState<OrderPriceCatalogItem[]>(settings.orderPriceCatalog || []);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedLocations, setSavedLocations] = useState<TransportationSavedLocation[]>(settings.transportationSavedLocations || []);
  const [locationName, setLocationName] = useState('');
  const [locationUrl, setLocationUrl] = useState('');
  const [originUrl, setOriginUrl] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [pricePerKm, setPricePerKm] = useState('');
  const [route, setRoute] = useState<{ distanceMeters: number; durationSeconds: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [transportError, setTransportError] = useState('');

  useEffect(() => setCatalog(settings.orderPriceCatalog || []), [settings.orderPriceCatalog]);
  useEffect(() => setSavedLocations(settings.transportationSavedLocations || []), [settings.transportationSavedLocations]);

  const saveCatalog = async (next: OrderPriceCatalogItem[]) => {
    setCatalog(next); setIsSaving(true);
    try { await updateSettings({ orderPriceCatalog: next }); } finally { setIsSaving(false); }
  };
  const resetCatalogForm = () => { setName(''); setPrice(''); setEditingId(null); };
  const saveCatalogItem = async () => {
    const cleanName = name.trim(); const unitPrice = Number(price);
    if (!cleanName || !Number.isFinite(unitPrice) || unitPrice < 0) return;
    const next = editingId ? catalog.map((item) => item.id === editingId ? { ...item, name: cleanName, unitPrice } : item) : [...catalog, { id: newId('price'), name: cleanName, unitPrice }];
    await saveCatalog(next); resetCatalogForm();
  };
  const saveLocations = async (next: TransportationSavedLocation[]) => {
    setSavedLocations(next); setIsSaving(true);
    try { await updateSettings({ transportationSavedLocations: next }); } finally { setIsSaving(false); }
  };
  const saveLocation = async () => {
    const cleanName = locationName.trim(); const cleanUrl = locationUrl.trim();
    if (!cleanName || !cleanUrl) return;
    try {
      const url = new URL(cleanUrl);
      if (url.protocol !== 'https:' || !(url.hostname === 'maps.app.goo.gl' || url.hostname === 'google.com' || url.hostname.endsWith('.google.com'))) throw new Error();
    } catch {
      setTransportError('ضع رابط مشاركة صحيحًا من Google Maps لحفظ الموقع.');
      return;
    }
    await saveLocations([...savedLocations, { id: newId('location'), name: cleanName, mapUrl: cleanUrl }]);
    setLocationName(''); setLocationUrl(''); setTransportError('');
  };
  const calculate = async () => {
    setTransportError(''); setRoute(null);
    if (!originUrl.trim() || !destinationUrl.trim()) { setTransportError('ضع رابط Google Maps لنقطة الانطلاق والوجهة أولًا.'); return; }
    setIsCalculating(true);
    try { setRoute(await transportationService.calculate(originUrl.trim(), destinationUrl.trim())); }
    catch (error) { setTransportError(error instanceof Error ? error.message : 'تعذر حساب مسافة الانتقال.'); }
    finally { setIsCalculating(false); }
  };
  const costPerDirection = useMemo(() => route ? km(route.distanceMeters) * Math.max(0, Number(pricePerKm) || 0) : 0, [pricePerKm, route]);
  const setSavedUrl = (side: 'origin' | 'destination', value: string) => {
    if (side === 'origin') setOriginUrl(value); else setDestinationUrl(value);
    setRoute(null); setTransportError('');
  };

  return <div dir="rtl" className="mx-auto max-w-5xl space-y-6 animate-in fade-in duration-300">
    <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><Calculator className="h-6 w-6" /></div><div><h1 className="text-xl font-black text-slate-900 dark:text-white">حاسبة الأوردرات</h1><p className="mt-0.5 text-xs text-slate-500">احسب عرض العميل أو تكلفة الانتقالات دون إنشاء أوردر.</p></div></div>{tab === 'orders' && <button type="button" onClick={onOpenCalculator} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-xs font-black text-white shadow-sm hover:bg-emerald-700"><Calculator className="h-4 w-4" />فتح حاسبة الأوردرات</button>}</div>
      <div className="mt-6 grid grid-cols-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800"><button type="button" onClick={() => setTab('orders')} className={`rounded-xl px-4 py-2.5 text-xs font-black transition-colors ${tab === 'orders' ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-700 dark:text-emerald-300' : 'text-slate-500'}`}>حاسبة الأوردرات</button><button type="button" onClick={() => setTab('transportation')} className={`rounded-xl px-4 py-2.5 text-xs font-black transition-colors ${tab === 'transportation' ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-700 dark:text-emerald-300' : 'text-slate-500'}`}>حاسبة الانتقالات</button></div>
    </header>

    {tab === 'orders' ? <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="mb-4 flex items-center gap-2"><Settings2 className="h-5 w-5 text-amber-500" /><div><h2 className="font-black text-slate-900 dark:text-white">إعدادات حاسبة الأوردرات</h2><p className="text-xs text-slate-500">أضف الخدمات أو المكوّنات والسعر للوحدة.</p></div></div><div className="flex flex-col gap-2 sm:flex-row"><input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveCatalogItem(); } }} placeholder="اسم المكوّن أو الخدمة" className={`${inputClass} min-w-0 flex-1`} /><input type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveCatalogItem(); } }} placeholder="سعر الوحدة" className={`${inputClass} sm:w-40`} /><button type="button" onClick={() => void saveCatalogItem()} disabled={isSaving} className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-60">{editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingId ? 'حفظ التعديل' : 'إضافة'}</button>{editingId && <button type="button" onClick={resetCatalogForm} disabled={isSaving} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"><X className="h-4 w-4" />إلغاء</button>}</div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{catalog.length ? catalog.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"><span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800 dark:text-slate-100">{item.name}</span><strong className="font-mono text-sm text-emerald-700 dark:text-emerald-300">{item.unitPrice.toLocaleString()}</strong><button type="button" onClick={() => { setEditingId(item.id); setName(item.name); setPrice(String(item.unitPrice)); }} disabled={isSaving} className="rounded-lg p-1 text-amber-600 hover:bg-amber-50 disabled:opacity-60"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => void saveCatalog(catalog.filter((entry) => entry.id !== item.id))} disabled={isSaving} className="rounded-lg p-1 text-rose-500 hover:bg-rose-50 disabled:opacity-60"><Trash2 className="h-4 w-4" /></button></div>) : <p className="col-span-full rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-400 dark:bg-slate-800/60">أضف أول مكوّن لتبدأ الحاسبة.</p>}</div></section> : <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-2"><Route className="h-5 w-5 text-emerald-600" /><div><h2 className="font-black text-slate-900 dark:text-white">حاسبة الانتقالات</h2><p className="text-xs text-slate-500">اختر موقعًا محفوظًا أو الصق رابط Google Maps مباشرة لكل اتجاه.</p></div></div><div className="grid gap-4 md:grid-cols-2"><LocationInput title="نقطة الانطلاق" value={originUrl} locations={savedLocations} onChange={(value) => setSavedUrl('origin', value)} /><LocationInput title="الوجهة" value={destinationUrl} locations={savedLocations} onChange={(value) => setSavedUrl('destination', value)} /></div><div className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/70 sm:flex-row sm:items-end"><label className="block flex-1 text-xs font-bold text-slate-700 dark:text-slate-200">سعر الكيلو (ج.م)<input type="number" min="0" step="0.01" value={pricePerKm} onChange={(event) => setPricePerKm(event.target.value)} placeholder="مثال: 12" className={`${inputClass} mt-1.5`} /></label><button type="button" onClick={() => void calculate()} disabled={isCalculating} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60">{isCalculating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}{isCalculating ? 'جارٍ حساب المسافة...' : 'احسب الانتقالات'}</button></div>{transportError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">{transportError}</p>}{route && <div className="grid gap-3 sm:grid-cols-4"><Result label="مسافة الذهاب" value={`${km(route.distanceMeters).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} كم`} /><Result label="رايح / جاي" value={`${(km(route.distanceMeters) * 2).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} كم`} /><Result label="تكلفة الذهاب" value={currency(costPerDirection)} /><Result label="إجمالي الانتقالات" value={currency(costPerDirection * 2)} emphasis /></div>}<div className="border-t border-slate-100 pt-6 dark:border-slate-800"><div className="mb-3 flex items-center gap-2"><MapPin className="h-4 w-4 text-amber-500" /><h3 className="text-sm font-black text-slate-900 dark:text-white">المواقع المحفوظة</h3></div><div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"><input value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="اسم الموقع، مثل: مخزن التجمع" className={inputClass} /><input dir="ltr" type="url" value={locationUrl} onChange={(event) => setLocationUrl(event.target.value)} placeholder="https://maps.app.goo.gl/..." className={inputClass} /><button type="button" onClick={() => void saveLocation()} disabled={isSaving} className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-60"><Plus className="h-4 w-4" />حفظ الموقع</button></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{savedLocations.length ? savedLocations.map((location) => <div key={location.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"><MapPin className="h-4 w-4 shrink-0 text-emerald-600" /><span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800 dark:text-slate-100">{location.name}</span><a href={location.mapUrl} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-emerald-600 dark:hover:bg-slate-700"><ExternalLink className="h-4 w-4" /></a><button type="button" onClick={() => void saveLocations(savedLocations.filter((item) => item.id !== location.id))} disabled={isSaving} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-60"><Trash2 className="h-4 w-4" /></button></div>) : <p className="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-400 dark:bg-slate-800">لا توجد مواقع محفوظة بعد.</p>}</div></div></section>}
  </div>;
};

const LocationInput: React.FC<{ title: string; value: string; locations: TransportationSavedLocation[]; onChange: (value: string) => void }> = ({ title, value, locations, onChange }) => <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><label className="block text-xs font-black text-slate-800 dark:text-slate-100">{title}</label><select value="" onChange={(event) => { if (event.target.value) onChange(event.target.value); }} className={`${inputClass} mt-2 text-xs`}><option value="">اختر من المواقع المحفوظة (اختياري)</option>{locations.map((location) => <option key={location.id} value={location.mapUrl}>{location.name}</option>)}</select><input dir="ltr" type="url" value={value} onChange={(event) => onChange(event.target.value)} placeholder="أو الصق رابط Google Maps هنا" className={`${inputClass} mt-2`} /></div>;
const Result: React.FC<{ label: string; value: string; emphasis?: boolean }> = ({ label, value, emphasis }) => <div className={`rounded-2xl p-4 ${emphasis ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'}`}><p className={`text-[11px] font-bold ${emphasis ? 'text-emerald-100' : 'text-emerald-700 dark:text-emerald-300'}`}>{label}</p><strong className="mt-1 block font-mono text-lg">{value}</strong></div>;
