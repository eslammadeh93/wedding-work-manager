import React, { useRef, useState } from 'react';
import { AlertCircle, Crown, Globe, KeyRound, Lock, LogIn, Mail, Moon, Sun, User } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { USE_MULTI_TENANT_DATA } from '../../multiTenant';

export const LoginPage: React.FC = () => {
  const { language, setLanguage, t } = useLanguage();
  const { darkMode, toggleDarkMode } = useTheme();
  const { loginEmail, loginWorker, loginMultiTenantEmail, loginMultiTenantWorker, createFirstSuperAdmin, allUsers, authError, clearError } = useAuth();
  const [view, setView] = useState<'worker' | 'manager' | 'setup'>('worker');
  const [companyCode, setCompanyCode] = useState('');
  const [workerUsername, setWorkerUsername] = useState('');
  const [workerCode, setWorkerCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const logoTaps = useRef(0);
  const resetTapTimer = useRef<number | undefined>(undefined);

  const resetError = () => { setLocalError(null); clearError(); };
  const handleLogoTap = () => {
    if (USE_MULTI_TENANT_DATA) return;
    logoTaps.current += 1;
    window.clearTimeout(resetTapTimer.current);
    resetTapTimer.current = window.setTimeout(() => { logoTaps.current = 0; }, 1200);
    if (logoTaps.current === 4) {
      logoTaps.current = 0;
      window.clearTimeout(resetTapTimer.current);
      setView((current) => current === 'worker' ? 'manager' : 'worker');
      resetError();
    }
  };

  const handleWorkerLogin = async (event: React.FormEvent) => {
    event.preventDefault(); resetError(); setSubmitting(true);
    if (USE_MULTI_TENANT_DATA && !/^\d{6}$/.test(companyCode)) {
      setLocalError('كود الشركة يجب أن يتكون من 6 أرقام.');
      setSubmitting(false);
      return;
    }
    try {
      if (USE_MULTI_TENANT_DATA) await loginMultiTenantWorker(companyCode, workerUsername, workerCode);
      else await loginWorker(workerUsername, workerCode);
    } finally {
      setSubmitting(false);
    }
  };
  const handleManagerLogin = async (event: React.FormEvent) => {
    event.preventDefault(); resetError(); setSubmitting(true);
    try {
      if (view === 'setup') await createFirstSuperAdmin({ displayName: name.trim(), email, password });
      else if (USE_MULTI_TENANT_DATA) await loginMultiTenantEmail(email, password, rememberMe);
      else await loginEmail(email, password, rememberMe);
    } catch (error: any) {
      const messages: Record<string, string> = {
        'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
        'auth/email-already-in-use': 'هذا البريد مسجل بالفعل. استخدم تسجيل الدخول.',
        'auth/weak-password': 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.',
      };
      setLocalError(messages[error.code] || error.message || 'تعذر تسجيل الدخول.');
    } finally { setSubmitting(false); }
  };
  const displayError = localError || authError;
  const isManager = view === 'manager' || view === 'setup';

  return <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden font-sans transition-colors" dir="rtl">
    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
    <div className="absolute top-4 ltr:right-4 rtl:left-4 flex items-center gap-2 z-20">
      <button onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')} className="px-3 py-1.5 bg-white/90 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" /><span>{language === 'ar' ? 'English' : 'العربية'}</span></button>
      <button onClick={toggleDarkMode} className="p-2 bg-white/90 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-700 dark:text-slate-200">{darkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-slate-500" />}</button>
    </div>
    <div className="w-full max-w-md bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 rounded-3xl shadow-2xl backdrop-blur-md overflow-hidden z-10">
      <div className="p-6 text-center bg-gradient-to-b from-amber-500/15 to-transparent border-b border-slate-200 dark:border-slate-700/50">
        <button type="button" onClick={handleLogoTap} className="w-14 h-14 mx-auto mb-3 premium-gold-bg rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/20"><Crown className="w-7 h-7" /></button>
        <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">{t('appName')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{view === 'worker' ? 'دخول الموظف' : view === 'setup' ? 'إنشاء حساب المدير الأول' : 'دخول المدير'}</p>
      </div>
      <div className="p-7 space-y-4">
        {USE_MULTI_TENANT_DATA && <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
          <button type="button" onClick={() => { setView('manager'); resetError(); }} className={`rounded-lg px-3 py-2 text-xs font-black ${view === 'manager' ? 'bg-white dark:bg-slate-700 text-amber-600 shadow-sm' : 'text-slate-500'}`}>دخول إداري</button>
          <button type="button" onClick={() => { setView('worker'); resetError(); }} className={`rounded-lg px-3 py-2 text-xs font-black ${view === 'worker' ? 'bg-white dark:bg-slate-700 text-amber-600 shadow-sm' : 'text-slate-500'}`}>دخول الموظف</button>
        </div>}
        {displayError && <div className="p-3.5 bg-rose-950/80 border border-rose-700/80 text-rose-300 rounded-2xl text-xs font-black flex items-center justify-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /><span>{displayError}</span></div>}
        {!isManager ? <form onSubmit={handleWorkerLogin} className="space-y-4">
          {USE_MULTI_TENANT_DATA && <Field label="كود الشركة" icon={<KeyRound className="w-4 h-4" />} value={companyCode} onChange={(value) => setCompanyCode(value.replace(/\D/g, '').slice(0, 6))} placeholder="100001" inputMode="numeric" maxLength={6} />}
          <Field label="اسم المستخدم" icon={<User className="w-4 h-4" />} value={workerUsername} onChange={setWorkerUsername} placeholder="اسم المستخدم" />
          <Field label="كود الدخول" icon={<KeyRound className="w-4 h-4" />} value={workerCode} onChange={setWorkerCode} placeholder="كود الدخول" password />
          <Submit submitting={submitting}>دخول الموظف</Submit>
        </form> : <form onSubmit={handleManagerLogin} className="space-y-4">
          {view === 'setup' && <Field label="الاسم" icon={<User className="w-4 h-4" />} value={name} onChange={setName} placeholder="اسم المدير" />}
          <Field label="البريد الإلكتروني" icon={<Mail className="w-4 h-4" />} value={email} onChange={setEmail} placeholder="name@example.com" email />
          <Field label="كلمة المرور" icon={<Lock className="w-4 h-4" />} value={password} onChange={setPassword} placeholder="كلمة المرور" password minLength={6} />
          {view === 'manager' && <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer w-fit"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} className="w-4 h-4 accent-amber-500" /><span>تذكرني لمدة 7 أيام</span></label>}
          <Submit submitting={submitting}>{view === 'setup' ? 'إنشاء الحساب' : 'دخول المدير'}</Submit>
          {!USE_MULTI_TENANT_DATA && allUsers.length === 0 && <button type="button" onClick={() => { setView(view === 'setup' ? 'manager' : 'setup'); resetError(); }} className="w-full text-xs font-bold text-amber-400">{view === 'setup' ? 'لدي حساب بالفعل' : 'إنشاء حساب المدير الأول'}</button>}
        </form>}
      </div>
    </div>
  </div>;
};

const Field: React.FC<{ label: string; icon: React.ReactNode; value: string; onChange: (value: string) => void; placeholder: string; password?: boolean; email?: boolean; minLength?: number; maxLength?: number; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'] }> = ({ label, icon, value, onChange, placeholder, password, email, minLength, maxLength, inputMode }) => <div><label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">{label}</label><div className="relative text-slate-400"><span className="absolute right-3.5 top-1/2 -translate-y-1/2">{icon}</span><input type={password ? 'password' : email ? 'email' : 'text'} required minLength={minLength} maxLength={maxLength} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full pr-10 pl-4 py-3 bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500" /></div></div>;
const Submit: React.FC<{ submitting: boolean; children: React.ReactNode }> = ({ submitting, children }) => <button type="submit" disabled={submitting} className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-sm rounded-xl shadow-lg flex items-center justify-center gap-2 disabled:opacity-60"><LogIn className="w-4 h-4" /><span>{submitting ? 'جاري التنفيذ...' : children}</span></button>;
