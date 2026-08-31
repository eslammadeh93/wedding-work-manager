import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RotateCcw, Trash2, UserCheck, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import type { OrderResponsible } from '../../types';
import { sanitizePhoneInput, toInternationalPhoneDigits } from '../../utils/phone';

const sevenDaysFromNow = () => {
  const value = new Date();
  value.setDate(value.getDate() + 7);
  return value.toISOString();
};

export const OrderResponsiblesManager: React.FC = () => {
  const { settings, updateSettings } = useData();
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedDeletedId, setSelectedDeletedId] = useState<string | null>(null);
  const responsibles = settings.orderResponsibles || [];
  const now = Date.now();
  const active = useMemo(() => responsibles.filter((person) => !person.deletedAt), [responsibles]);
  const deleted = useMemo(() => responsibles.filter((person) => person.deletedAt && (!person.purgeAt || new Date(person.purgeAt).getTime() > now)), [responsibles, now]);

  const save = async (next: OrderResponsible[]) => {
    setBusy(true); setError('');
    try { await updateSettings({ orderResponsibles: next }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر حفظ قائمة المسؤولين.'); }
    finally { setBusy(false); }
  };

  // Expired soft-deletions are permanently removed the next time this list is opened.
  useEffect(() => {
    const next = responsibles.filter((person) => !person.purgeAt || new Date(person.purgeAt).getTime() > Date.now());
    if (next.length !== responsibles.length) void save(next);
    // This intentionally runs when the synced company setting changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.orderResponsibles]);

  const saveResponsible = () => {
    const name = newName.trim();
    const phone = sanitizePhoneInput(newPhone).trim();
    const normalizedPhone = toInternationalPhoneDigits(phone);
    if (!name || responsibles.some((person) => !person.deletedAt && person.id !== editingId && person.name.trim().toLowerCase() === name.toLowerCase())) return;
    if (normalizedPhone && responsibles.some((person) => person.id !== editingId && toInternationalPhoneDigits(person.phone || '') === normalizedPhone)) {
      setError('هذا الرقم مستخدم بالفعل.');
      return;
    }
    const next = editingId
      ? responsibles.map((person) => person.id === editingId ? { ...person, name, phone } : person)
      : [...responsibles, { id: `responsible_${crypto.randomUUID?.() || Date.now()}`, name, phone }];
    void save(next);
    setNewName(''); setNewPhone(''); setEditingId(null);
  };

  const edit = (person: OrderResponsible) => { setEditingId(person.id); setNewName(person.name); setNewPhone(person.phone || ''); };
  const cancelEdit = () => { setEditingId(null); setNewName(''); setNewPhone(''); };

  const softDelete = (person: OrderResponsible) => {
    if (!window.confirm(`سيتم نقل المسؤول «${person.name}» إلى الحذف المؤقت لمدة 7 أيام. يمكنك استرجاعه أو حذفه نهائيًا خلال هذه المدة. هل تريد المتابعة؟`)) return;
    const deletedAt = new Date().toISOString();
    void save(responsibles.map((entry) => entry.id === person.id ? { ...entry, deletedAt, purgeAt: sevenDaysFromNow() } : entry));
  };

  const restore = (person: OrderResponsible) => {
    void save(responsibles.map((entry) => entry.id === person.id ? { ...entry, deletedAt: null, purgeAt: null } : entry));
    setSelectedDeletedId(null);
  };

  const permanentlyDelete = (person: OrderResponsible) => {
    if (!window.confirm(`سيُحذف المسؤول «${person.name}» نهائيًا الآن ولا يمكن استرجاعه. هل تريد المتابعة؟`)) return;
    void save(responsibles.filter((entry) => entry.id !== person.id));
    setSelectedDeletedId(null);
  };

  return <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/20">
    <div><h2 className="flex items-center gap-2 font-black"><UserCheck size={18} className="text-indigo-500" />المسؤولون عن الأوردرات</h2><p className="mt-1 text-xs text-slate-500">أضف مسؤول المتابعة أو العمولة. الحذف مؤقت لمدة 7 أيام.</p></div>
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_12rem_auto_auto]"><input value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveResponsible(); } }} placeholder="اسم المسؤول" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900" /><input type="tel" value={newPhone} onChange={(event) => setNewPhone(sanitizePhoneInput(event.target.value))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveResponsible(); } }} placeholder="رقم الموبايل" dir="ltr" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900" /><button type="button" onClick={saveResponsible} disabled={busy} className="flex items-center justify-center gap-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-60" aria-label={editingId ? 'حفظ التعديل' : 'إضافة مسؤول'}>{editingId ? <Pencil size={16} /> : <Plus size={16} />}<span>{editingId ? 'حفظ' : 'إضافة'}</span></button>{editingId && <button type="button" onClick={cancelEdit} className="flex items-center justify-center rounded-xl border border-slate-300 px-3 py-2.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" aria-label="إلغاء التعديل"><X size={16} /></button>}</div>
    {error && <p className="mt-2 text-xs font-bold text-rose-600">{error}</p>}
    <div className="mt-3 flex flex-wrap gap-2">{active.length ? active.map((person) => <span key={person.id} className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-bold dark:border-indigo-800 dark:bg-slate-900"><span>{person.name}</span>{person.phone && <span dir="ltr" className="font-mono text-[11px] text-slate-500">{person.phone}</span>}<button type="button" onClick={() => edit(person)} disabled={busy} className="text-indigo-500 hover:text-indigo-700 disabled:opacity-50" aria-label={`تعديل ${person.name}`}><Pencil size={15} /></button><button type="button" onClick={() => softDelete(person)} disabled={busy} className="text-rose-500 hover:text-rose-700 disabled:opacity-50" aria-label={`حذف ${person.name}`}><Trash2 size={15} /></button></span>) : <p className="text-xs text-slate-400">لم تضف مسؤولين بعد.</p>}</div>
    {deleted.length > 0 && <div className="mt-4 border-t border-indigo-200/70 pt-3 dark:border-indigo-900/60"><p className="mb-2 text-xs font-bold text-slate-500">محذوف مؤقتًا — اضغط على الاسم لإدارته</p><div className="flex flex-wrap gap-2">{deleted.map((person) => <button key={person.id} type="button" onClick={() => setSelectedDeletedId((current) => current === person.id ? null : person.id)} className={`rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${selectedDeletedId === person.id ? 'border-slate-500 bg-slate-300 text-slate-800 dark:border-slate-500 dark:bg-slate-600 dark:text-white' : 'border-slate-300 bg-slate-200 text-slate-600 hover:bg-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{person.name}</button>)}</div>{selectedDeletedId && (() => { const person = deleted.find((entry) => entry.id === selectedDeletedId); return person ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-200 p-3 text-xs dark:bg-slate-800"><span className="font-bold text-slate-700 dark:text-slate-200">{person.name}</span><span className="text-slate-500">متاح للاسترجاع حتى {person.purgeAt ? new Date(person.purgeAt).toLocaleDateString('ar-EG') : '—'}</span><button type="button" onClick={() => restore(person)} disabled={busy} className="ms-auto flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 font-bold text-white disabled:opacity-60"><RotateCcw size={14} />استرجاع</button><button type="button" onClick={() => permanentlyDelete(person)} disabled={busy} className="flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-2 font-bold text-white disabled:opacity-60"><Trash2 size={14} />حذف نهائي</button></div> : null; })()}</div>}
  </section>;
};
