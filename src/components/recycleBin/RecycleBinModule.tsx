import React, { useState } from 'react';
import { ArchiveRestore, RotateCcw, Trash2 } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { recycleBinService } from '../../multiTenant/recycleBinService';
import type { RecycleBinItem } from '../../types';

const labelFor = (item: RecycleBinItem) => ({ order: 'أوردر', customer: 'عميل', inventory: 'عنصر مخزون' }[item.type]);

export const RecycleBinModule: React.FC = () => {
  const { recycleBinItems, restoreDeletedItem } = useData();
  const { authSession } = useAuth();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canPermanentlyDelete = authSession?.userType === 'company' && authSession.role === 'company_super_admin';
  const itemKey = (item: RecycleBinItem) => `${item.type}:${item.id}`;
  const restore = async (item: RecycleBinItem) => {
    if (!window.confirm(`استرجاع ${labelFor(item)} «${item.title}»؟`)) return;
    setError(null); setBusyKey(itemKey(item));
    try { await restoreDeletedItem(item); } finally { setBusyKey(null); }
  };
  const permanentlyDelete = async (item: RecycleBinItem) => {
    if (!window.confirm(`حذف ${labelFor(item)} «${item.title}» نهائيًا؟\nلن يمكن استرجاعه بعد هذه الخطوة.`)) return;
    setError(null); setBusyKey(itemKey(item));
    try {
      const result = await recycleBinService.permanentlyDelete(item);
      if (!result.success) setError(result.message);
    } finally { setBusyKey(null); }
  };

  return <section dir="rtl" className="mx-auto max-w-4xl space-y-5 animate-in fade-in duration-300">
    <header><h2 className="flex items-center gap-2 text-2xl font-black text-slate-900 dark:text-white"><ArchiveRestore className="text-amber-500" />سلة المحذوفات</h2><p className="mt-1 text-sm text-slate-500">يمكن استرجاع الأوردرات والعملاء والمخزون خلال 30 يومًا. بعدها تُحذف تلقائيًا نهائيًا.</p></header>
    {error && <p role="alert" className="rounded-2xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
    {recycleBinItems.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-14 text-center dark:border-slate-700 dark:bg-slate-900"><Trash2 className="mx-auto mb-3 text-slate-300" size={36}/><p className="font-bold text-slate-500">سلة المحذوفات فارغة.</p></div> : <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="divide-y divide-slate-100 dark:divide-slate-800">{recycleBinItems.map(item => <div key={itemKey(item)} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-black text-slate-900 dark:text-white">{item.title}</p><p className="mt-1 text-xs text-slate-500">{labelFor(item)} · يُحذف نهائيًا في {new Date(item.purgeAt).toLocaleDateString('ar-EG')}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busyKey === itemKey(item)} onClick={() => void restore(item)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-black text-white disabled:opacity-60"><RotateCcw size={15}/>{busyKey === itemKey(item) ? 'جارٍ التنفيذ…' : 'استرجاع'}</button>{canPermanentlyDelete && <button type="button" disabled={busyKey === itemKey(item)} onClick={() => void permanentlyDelete(item)} className="inline-flex items-center gap-2 rounded-xl bg-rose-700 px-3.5 py-2 text-xs font-black text-white disabled:opacity-60"><Trash2 size={15}/>{busyKey === itemKey(item) ? 'جارٍ التنفيذ…' : 'حذف نهائي'}</button>}</div></div>)}</div></div>}
  </section>;
};
