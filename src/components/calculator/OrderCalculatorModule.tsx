import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Calculator, LoaderCircle, Route } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { transportationService } from '../../multiTenant/transportationService';
import type { TransportationSavedLocation } from '../../types';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800';
const km = (meters: number) => meters / 1_000;
const currency = (value: number) => `${value.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;

/** The use-only workspace: it deliberately contains no calculator configuration controls. */
export const OrderCalculatorModule: React.FC<{ onOpenCalculator: () => void }> = ({ onOpenCalculator }) => {
  const { settings } = useData();
  const [view, setView] = useState<'chooser' | 'transportation'>('chooser');
  const [savedLocations, setSavedLocations] = useState<TransportationSavedLocation[]>(settings.transportationSavedLocations || []);
  const [originUrl, setOriginUrl] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [pricePerKm, setPricePerKm] = useState('');
  const [route, setRoute] = useState<{ distanceMeters: number; durationSeconds: number } | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [transportError, setTransportError] = useState('');

  useEffect(() => setSavedLocations(settings.transportationSavedLocations || []), [settings.transportationSavedLocations]);

  const calculate = async () => {
    setTransportError(''); setRoute(null);
    if (!originUrl.trim() || !destinationUrl.trim()) { setTransportError('ضع رابط Google Maps لنقطة الانطلاق والوجهة أولًا.'); return; }
    setIsCalculating(true);
    try { setRoute(await transportationService.calculate(originUrl.trim(), destinationUrl.trim())); }
    catch (error) { setTransportError(error instanceof Error ? error.message : 'تعذر حساب مسافة الانتقال.'); }
    finally { setIsCalculating(false); }
  };
  const costPerDirection = useMemo(() => route ? km(route.distanceMeters) * Math.max(0, Number(pricePerKm) || 0) : 0, [pricePerKm, route]);
  const setLocation = (side: 'origin' | 'destination', value: string) => {
    if (side === 'origin') setOriginUrl(value); else setDestinationUrl(value);
    setRoute(null); setTransportError('');
  };

  return <div dir="rtl" className="mx-auto max-w-5xl space-y-6 animate-in fade-in duration-300">
    <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3">
        {view === 'transportation' && <button type="button" onClick={() => setView('chooser')} className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"><ArrowRight className="h-4 w-4" />كل الحاسبات</button>}
        <div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><Calculator className="h-6 w-6" /></div><div><h1 className="text-xl font-black text-slate-900 dark:text-white">{view === 'transportation' ? 'حاسبة الانتقالات' : 'الحاسبات'}</h1><p className="mt-0.5 text-xs text-slate-500">{view === 'transportation' ? 'احسب الذهاب والعودة من روابط Google Maps.' : 'اختر الحاسبة التي تريد استخدامها.'}</p></div></div>
      </div>
    </header>

    {view === 'chooser' && <section className="grid gap-4 sm:grid-cols-2">
      <button type="button" onClick={onOpenCalculator} className="group rounded-3xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-6 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md dark:border-emerald-900/70 dark:from-emerald-950/30 dark:to-slate-900"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white"><Calculator className="h-6 w-6" /></span><h2 className="mt-5 text-lg font-black text-slate-900 dark:text-white">حاسبة الأوردرات</h2><p className="mt-1 text-sm font-medium text-slate-500">احسب عرض العميل من الخدمات والمكوّنات المحفوظة.</p><span className="mt-5 inline-flex rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white group-hover:bg-emerald-700">فتح الحاسبة</span></button>
      <button type="button" onClick={() => setView('transportation')} className="group rounded-3xl border border-sky-200 bg-gradient-to-b from-sky-50 to-white p-6 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-sky-400 hover:shadow-md dark:border-sky-900/70 dark:from-sky-950/30 dark:to-slate-900"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-600 text-white"><Route className="h-6 w-6" /></span><h2 className="mt-5 text-lg font-black text-slate-900 dark:text-white">حاسبة الانتقالات</h2><p className="mt-1 text-sm font-medium text-slate-500">احسب المسافة وتكلفة رايح / جاي بين موقعين.</p><span className="mt-5 inline-flex rounded-xl bg-sky-600 px-4 py-2 text-xs font-black text-white group-hover:bg-sky-700">فتح الحاسبة</span></button>
    </section>}

    {view === 'transportation' && <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="grid gap-4 md:grid-cols-2"><LocationInput title="نقطة الانطلاق" value={originUrl} locations={savedLocations} onChange={(value) => setLocation('origin', value)} /><LocationInput title="الوجهة" value={destinationUrl} locations={savedLocations} onChange={(value) => setLocation('destination', value)} /></div><div className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/70 sm:flex-row sm:items-end"><label className="block flex-1 text-xs font-bold text-slate-700 dark:text-slate-200">سعر الكيلو (ج.م)<input type="number" min="0" step="0.01" value={pricePerKm} onChange={(event) => setPricePerKm(event.target.value)} placeholder="مثال: 12" className={`${inputClass} mt-1.5`} /></label><button type="button" onClick={() => void calculate()} disabled={isCalculating} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60">{isCalculating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}{isCalculating ? 'جارٍ حساب المسافة...' : 'احسب الانتقالات'}</button></div>{transportError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">{transportError}</p>}{route && <div className="grid gap-3 sm:grid-cols-4"><Result label="مسافة الذهاب" value={`${km(route.distanceMeters).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} كم`} /><Result label="رايح / جاي" value={`${(km(route.distanceMeters) * 2).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} كم`} /><Result label="تكلفة الذهاب" value={currency(costPerDirection)} /><Result label="إجمالي الانتقالات" value={currency(costPerDirection * 2)} emphasis /></div>}</section>}
  </div>;
};

const LocationInput: React.FC<{ title: string; value: string; locations: TransportationSavedLocation[]; onChange: (value: string) => void }> = ({ title, value, locations, onChange }) => <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700"><label className="block text-xs font-black text-slate-800 dark:text-slate-100">{title}</label><select value="" onChange={(event) => { if (event.target.value) onChange(event.target.value); }} className={`${inputClass} mt-2 text-xs`}><option value="">اختر من المواقع المحفوظة (اختياري)</option>{locations.map((location) => <option key={location.id} value={location.mapUrl}>{location.name}</option>)}</select><input dir="ltr" type="url" value={value} onChange={(event) => onChange(event.target.value)} placeholder="أو الصق رابط Google Maps هنا" className={`${inputClass} mt-2`} /></div>;
const Result: React.FC<{ label: string; value: string; emphasis?: boolean }> = ({ label, value, emphasis }) => <div className={`rounded-2xl p-4 ${emphasis ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'}`}><p className={`text-[11px] font-bold ${emphasis ? 'text-emerald-100' : 'text-emerald-700 dark:text-emerald-300'}`}>{label}</p><strong className="mt-1 block font-mono text-lg">{value}</strong></div>;
