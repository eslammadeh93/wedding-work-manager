import { useState } from 'react';
import { Headphones, Send } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';

type Result = { success: boolean; message: string };

export function CompanySupportModule() {
  const [issue, setIssue] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    const value = issue.trim();
    if (value.length < 5) {
      setError('اكتب وصفًا واضحًا للمشكلة قبل الإرسال.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const call = httpsCallable<{ issue: string }, Result>(functions, 'createCompanySupportTicket');
      const result = await call({ issue: value });
      if (!result.data.success) throw new Error(result.data.message);
      setIssue('');
      setMessage(result.data.message);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'تعذر إرسال طلب الدعم الآن. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  return <section dir="rtl" className="mx-auto max-w-3xl"><div className="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7"><div className="flex items-start gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"><Headphones size={22} /></span><div><h1 className="text-xl font-black">الدعم الفني</h1><p className="mt-1 text-sm text-slate-500">اكتب المشكلة التي تواجهك وسيصل الطلب إلى فريق دعم المنصة باسم شركتك وحسابك.</p></div></div><label className="mt-6 block text-sm font-bold">تفاصيل المشكلة</label><textarea value={issue} onChange={event => setIssue(event.target.value)} maxLength={2000} className="mt-2 min-h-44 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-right outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-100 dark:border-slate-700 dark:bg-slate-950" placeholder="مثال: لا أستطيع حفظ تعديل في صفحة الطلبات…" /><div className="mt-2 text-left text-xs text-slate-400">{issue.length}/2000</div>{error && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}{message && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{message}</p>}<button type="button" onClick={() => void submit()} disabled={saving || issue.trim().length < 5} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-700 px-5 py-2.5 font-black text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"><Send size={17} />{saving ? 'جارٍ الإرسال…' : 'إرسال طلب الدعم'}</button></div></section>;
}
