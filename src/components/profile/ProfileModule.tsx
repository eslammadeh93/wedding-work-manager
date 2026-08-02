import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { LockKeyhole, Save, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../firebase/config';
import { companyMembersService } from '../../multiTenant/companyMembersService';
import { validPhone } from '../../multiTenant/companyMemberUi';

const fieldClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950 disabled:opacity-60';

export function ProfileModule() {
  const { user, authSession } = useAuth();
  const [form, setForm] = useState({ name: authSession?.displayName || '', phone: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!user || authSession?.userType !== 'company' || !authSession.companyId) return setLoading(false);
      const snapshot = await getDoc(doc(db, 'companies', authSession.companyId, 'members', user.uid));
      const member = snapshot.data();
      setForm(current => ({ ...current, name: typeof member?.name === 'string' ? member.name : authSession.displayName, phone: typeof member?.phone === 'string' ? member.phone : '' }));
      setLoading(false);
    };
    void load().catch(failure => { setError(failure instanceof Error ? failure.message : 'تعذر تحميل الملف الشخصي.'); setLoading(false); });
  }, [user?.uid, authSession?.companyId]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(''); setMessage('');
    if (!form.name.trim() || !validPhone(form.phone)) return setError('تحقق من الاسم ورقم الهاتف.');
    if (form.password && form.password.length < 12) return setError('كلمة المرور الجديدة يجب ألا تقل عن 12 حرفًا.');
    if (form.password !== form.confirmPassword) return setError('تأكيد كلمة المرور غير مطابق.');
    setSaving(true);
    try {
      const result = await companyMembersService.updateOwnProfile({ name: form.name.trim(), phone: form.phone.trim() || undefined, newPassword: form.password || undefined });
      if (!result.success) return setError(result.message || 'تعذر حفظ الملف الشخصي.');
      await user?.reload();
      setForm(current => ({ ...current, password: '', confirmPassword: '' }));
      setMessage('تم تحديث الملف الشخصي بنجاح.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذر حفظ الملف الشخصي.');
    } finally { setSaving(false); }
  };

  if (!authSession || authSession.userType !== 'company' || !['company_super_admin', 'manager'].includes(authSession.role)) return <div className="p-10 text-center">الملف الشخصي الإداري غير متاح لهذا الحساب.</div>;
  if (loading) return <div className="p-10 text-center">جارٍ التحميل…</div>;

  return <section dir="rtl" className="mx-auto max-w-2xl space-y-5"><header><h1 className="flex items-center gap-2 text-2xl font-black"><UserRound className="text-amber-500"/>الملف الشخصي</h1><p className="mt-1 text-sm text-slate-500">يمكنك تعديل بياناتك الشخصية فقط.</p></header><form onSubmit={save} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><label className="block text-sm font-bold">الاسم<input className={`${fieldClass} mt-1.5`} value={form.name} onChange={event => setForm({...form,name:event.target.value})}/></label><label className="block text-sm font-bold">البريد الإلكتروني<input className={`${fieldClass} mt-1.5`} dir="ltr" value={authSession.email} readOnly disabled/></label><label className="block text-sm font-bold">رقم الهاتف<input className={`${fieldClass} mt-1.5`} value={form.phone} onChange={event => setForm({...form,phone:event.target.value})}/></label><div className="border-t border-slate-200 pt-4 dark:border-slate-700"><h2 className="mb-3 flex items-center gap-2 font-black"><LockKeyhole size={18}/>تغيير كلمة المرور</h2><div className="grid gap-3 sm:grid-cols-2"><input type="password" className={fieldClass} placeholder="كلمة المرور الجديدة" value={form.password} onChange={event => setForm({...form,password:event.target.value})}/><input type="password" className={fieldClass} placeholder="تأكيد كلمة المرور" value={form.confirmPassword} onChange={event => setForm({...form,confirmPassword:event.target.value})}/></div></div>{error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}{message && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}<button disabled={saving} className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 font-black text-slate-950 disabled:opacity-60"><Save size={17}/>{saving ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}</button></form></section>;
}
