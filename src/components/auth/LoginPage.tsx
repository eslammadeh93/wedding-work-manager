import React, { useRef, useState } from 'react';
import { Lock, LogIn, AlertCircle, Globe, Sun, Moon, Crown, User, Key } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';

export const LoginPage: React.FC = () => {
  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { loginLocalSession, loginWorker, authError, clearError } = useAuth();

  const [activeTab, setActiveTab] = useState<'manager' | 'worker'>('worker');

  // Manager state
  const [managerUsername, setManagerUsername] = useState('');
  const [managerPassword, setManagerPassword] = useState('');

  // Worker state
  const [workerUsername, setWorkerUsername] = useState('');
  const [workerLoginCode, setWorkerLoginCode] = useState('');

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastLogoTapAt = useRef(0);

  const displayError = errorMessage || authError;

  const handleManagerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    clearError();

    const val1 = managerUsername.trim().toLowerCase();
    const val2 = managerPassword.trim().toLowerCase();

    if (val1 === 'saif' && val2 === 'saif') {
      loginLocalSession();
    } else {
      setErrorMessage('حاول تاني');
    }
  };

  const handleWorkerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    clearError();

    if (!workerUsername.trim() || !workerLoginCode.trim()) {
      setErrorMessage('يرجى كتابة اسم المستخدم وكود الدخول');
      return;
    }

    try {
      const success = await loginWorker(workerUsername, workerLoginCode);
      if (!success) {
        if (!authError) {
          setErrorMessage('اسم المستخدم أو كود الدخول غير صحيح');
        }
      }
    } catch (err: any) {
      // Handled by authContext or authError
    }
  };

  const handleLogoTap = () => {
    const now = Date.now();
    const isDoubleTap = now - lastLogoTapAt.current < 350;
    lastLogoTapAt.current = now;

    if (isDoubleTap) {
      setActiveTab((tab) => (tab === 'worker' ? 'manager' : 'worker'));
      setErrorMessage(null);
      clearError();
      lastLogoTapAt.current = 0;
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden font-sans" dir="rtl">
      {/* Background Decorative Accents */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-amber-600/5 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header Control Bar (Language & Theme toggle) */}
      <div className="absolute top-4 ltr:right-4 rtl:left-4 flex items-center gap-2 z-20">
        <button
          onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
          className="px-3 py-1.5 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-xl text-xs font-bold text-slate-200 flex items-center gap-1.5 backdrop-blur-xs transition-colors cursor-pointer"
        >
          <Globe className="w-3.5 h-3.5 text-amber-400" />
          <span>{language === 'ar' ? 'English' : 'العربية'}</span>
        </button>

        <button
          onClick={toggleTheme}
          className="p-2 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-xl text-slate-200 backdrop-blur-xs transition-colors cursor-pointer"
          title="Toggle Theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-400" />}
        </button>
      </div>

      {/* Login Card Container */}
      <div className="w-full max-w-md bg-slate-800/90 border border-slate-700/80 rounded-3xl shadow-2xl backdrop-blur-md overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-300">
        
        {/* Card Header Branding */}
        <div className="p-6 text-center bg-gradient-to-b from-amber-500/15 to-transparent border-b border-slate-700/50">
          <button
            type="button"
            onClick={handleLogoTap}
            className="w-14 h-14 mx-auto mb-3 bg-gradient-to-tr from-amber-500 to-amber-400 rounded-2xl flex items-center justify-center text-slate-950 shadow-lg shadow-amber-500/20 cursor-pointer"
            aria-label="تغيير نوع تسجيل الدخول"
          >
            <Crown className="w-7 h-7" />
          </button>
          <h1 className="text-xl font-black text-white tracking-tight">
            {t('appName')}
          </h1>
        </div>

        {/* Card Body */}
        <div className="p-7 space-y-5">
          {/* Error Message */}
          {displayError && (
            <div className="p-3.5 bg-rose-950/80 border border-rose-700/80 text-rose-300 rounded-2xl text-xs font-black flex items-center justify-center gap-2 animate-in slide-in-from-top-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{displayError}</span>
            </div>
          )}

          {/* Manager Login Form */}
          {activeTab === 'manager' && (
            <form onSubmit={handleManagerSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 text-right">
                  ما اسم المستخدم؟
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={managerUsername}
                    onChange={(e) => {
                      if (authError) clearError();
                      if (errorMessage) setErrorMessage(null);
                      setManagerUsername(e.target.value);
                    }}
                    placeholder="اكتب الإجابة"
                    className="w-full pr-10 pl-4 py-3 bg-slate-900/90 border border-slate-700 rounded-xl text-xs font-semibold text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-amber-500 transition-all text-right"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 text-right">
                  ما هي كلمة السر؟
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={managerPassword}
                    onChange={(e) => {
                      if (authError) clearError();
                      if (errorMessage) setErrorMessage(null);
                      setManagerPassword(e.target.value);
                    }}
                    placeholder="اكتب الإجابة"
                    className="w-full pr-10 pl-4 py-3 bg-slate-900/90 border border-slate-700 rounded-xl text-xs font-semibold text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-amber-500 transition-all text-right"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-sm rounded-xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 cursor-pointer transition-all mt-2"
              >
                <LogIn className="w-4 h-4" />
                <span>دخول المدير</span>
              </button>
            </form>
          )}

          {/* Worker Login Form */}
          {activeTab === 'worker' && (
            <form onSubmit={handleWorkerSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 text-right">
                  اسم المستخدم
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={workerUsername}
                    onChange={(e) => {
                      if (authError) clearError();
                      if (errorMessage) setErrorMessage(null);
                      setWorkerUsername(e.target.value);
                    }}
                    placeholder="ادخل اسم المستخدم الخاص بك"
                    className="w-full pr-10 pl-4 py-3 bg-slate-900/90 border border-slate-700 rounded-xl text-xs font-semibold text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-amber-500 transition-all text-right"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 text-right">
                  كود الدخول
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={workerLoginCode}
                    onChange={(e) => {
                      if (authError) clearError();
                      if (errorMessage) setErrorMessage(null);
                      setWorkerLoginCode(e.target.value);
                    }}
                    placeholder="ادخل كود الدخول"
                    className="w-full pr-10 pl-4 py-3 bg-slate-900/90 border border-slate-700 rounded-xl text-xs font-semibold text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-amber-500 transition-all text-right"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-sm rounded-xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 cursor-pointer transition-all mt-2"
              >
                <LogIn className="w-4 h-4" />
                <span>دخول العامل</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
