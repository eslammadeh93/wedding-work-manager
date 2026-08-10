import React, { useState } from 'react';
import { Calendar, ClipboardPenLine, FileText, UserRound, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { WorkTask } from '../../types';
import { localDateString } from '../../utils/localDate';

interface WorkTaskModalProps { isOpen: boolean; onClose: () => void; initialTask?: WorkTask | null; }

export const WorkTaskModal: React.FC<WorkTaskModalProps> = ({ isOpen, onClose, initialTask }) => {
  const { workers, addWorkTask, updateWorkTask } = useData();
  const [title, setTitle] = useState(initialTask?.title || '');
  const [details, setDetails] = useState(initialTask?.details || '');
  const [executionDate, setExecutionDate] = useState(initialTask?.executionDate || localDateString());
  const [workerId, setWorkerId] = useState(initialTask?.workerId || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!isOpen) return null;
  const activeWorkers = workers.filter((worker) => worker.status === 'active' || worker.id === initialTask?.workerId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const worker = workers.find((item) => item.id === workerId);
    if (!title.trim() || !executionDate || !worker) { setError('أدخل اسم العمل، تاريخ التنفيذ، والعامل المكلّف.'); return; }
    setSaving(true); setError('');
    try {
      const data = { title: title.trim(), details: details.trim(), executionDate, workerId: worker.id, workerName: worker.fullName };
      if (initialTask) await updateWorkTask(initialTask.id, data);
      else await addWorkTask(data);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'تعذر حفظ العمل.'); }
    finally { setSaving(false); }
  };

  return <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
    <div onClick={(event) => event.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-800/80">
        <h3 className="flex items-center gap-2 text-lg font-black text-slate-900 dark:text-white"><ClipboardPenLine className="h-5 w-5 text-indigo-500" />{initialTask ? 'تعديل عمل' : 'إضافة عمل'}</h3>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"><X className="h-5 w-5" /></button>
      </div>
      <form onSubmit={submit} className="space-y-4 p-6">
        <div><label className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300">اسم العمل</label><input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="مثال: شراء ورد للقاعة" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></div>
        <div><label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-300"><FileText className="h-3.5 w-3.5 text-indigo-500" />تفاصيل العمل</label><textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={4} placeholder="اكتب المطلوب تنفيذه وأي تعليمات للعامل..." className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-300"><Calendar className="h-3.5 w-3.5 text-emerald-500" />تاريخ التنفيذ</label><input type="date" required value={executionDate} onChange={(event) => setExecutionDate(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></div>
          <div><label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-300"><UserRound className="h-3.5 w-3.5 text-amber-500" />العامل المكلّف</label><select required value={workerId} onChange={(event) => setWorkerId(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"><option value="">اختر العامل</option>{activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.fullName}</option>)}</select></div>
        </div>
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-600 dark:bg-rose-950/30">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">إلغاء</button><button disabled={saving} className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : initialTask ? 'حفظ التعديل' : 'إضافة العمل'}</button></div>
      </form>
    </div>
  </div>;
};
