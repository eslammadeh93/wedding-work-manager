import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, Share } from 'lucide-react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const PwaInstallPrompt: React.FC = () => {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const deferredKey = 'wwm-install-prompt-deferred-until';

  useEffect(() => {
    setDeferred(Number(localStorage.getItem(deferredKey) || '0') > Date.now());
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!standalone && isIos && Number(localStorage.getItem(deferredKey) || '0') <= Date.now()) setShowIosHint(true);
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    const handleUpdateReady = () => setUpdateReady(true);
    window.addEventListener('wwm-pwa-update-ready', handleUpdateReady);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('wwm-pwa-update-ready', handleUpdateReady);
    };
  }, []);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };

  const deferInstall = () => {
    // Do not keep interrupting work. Ask again after a week, or earlier if the
    // browser emits a fresh install prompt.
    localStorage.setItem(deferredKey, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    setDeferred(true); setInstallEvent(null); setShowIosHint(false);
  };

  const applyUpdate = () => {
    window.dispatchEvent(new Event('wwm-pwa-apply-update'));
  };

  if ((!installEvent && !showIosHint && !updateReady) || (deferred && !updateReady)) return null;
  if (updateReady) {
    return (
      <div className="fixed top-3 left-3 right-3 z-[80] mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-indigo-900/70 dark:bg-slate-900/95" dir="rtl" role="status">
        <div className="min-w-0 text-right">
          <p className="text-xs font-black text-slate-900 dark:text-white">يتوفر تحديث جديد للبرنامج</p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">اضغط «حدّث الآن» لتشغيل أحدث نسخة من التطبيق.</p>
        </div>
        <button type="button" onClick={applyUpdate} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white shadow-sm transition-colors hover:bg-indigo-700">
          <RefreshCw className="h-4 w-4" />
          حدّث الآن
        </button>
      </div>
    );
  }
  return (
    <div className="fixed bottom-4 left-4 right-4 z-[70] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95" dir="rtl">
      <div className="min-w-0 text-right">
        <p className="text-xs font-black text-slate-900 dark:text-white">ثبّت مدير أعمال الويدينج</p>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{showIosHint ? 'من مشاركة Safari اختر «إضافة إلى الشاشة الرئيسية».' : 'افتحه من شاشة جهازك كتطبيق مستقل.'}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{installEvent ? <button type="button" onClick={() => void install()} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700"><Download className="h-4 w-4" />تثبيت</button> : <button type="button" onClick={() => setShowIosHint(false)} className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"><Share className="h-4 w-4" />فهمت</button>}<button type="button" onClick={deferInstall} className="rounded-xl px-2 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">لاحقًا</button></div>
    </div>
  );
};
