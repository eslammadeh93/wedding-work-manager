import React, { useEffect, useState } from 'react';
import { Download, Share } from 'lucide-react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const PwaInstallPrompt: React.FC = () => {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!standalone && isIos) setShowIosHint(true);
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };

  if (!installEvent && !showIosHint) return null;
  return (
    <div className="fixed bottom-4 left-4 right-4 z-[70] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95" dir="rtl">
      <div className="min-w-0 text-right">
        <p className="text-xs font-black text-slate-900 dark:text-white">ثبّت مدير أعمال الويدينج</p>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{showIosHint ? 'من مشاركة Safari اختر «إضافة إلى الشاشة الرئيسية».' : 'افتحه من شاشة جهازك كتطبيق مستقل.'}</p>
      </div>
      {installEvent ? <button type="button" onClick={() => void install()} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700"><Download className="h-4 w-4" />تثبيت</button> : <button type="button" onClick={() => setShowIosHint(false)} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"><Share className="h-4 w-4" />فهمت</button>}
    </div>
  );
};
