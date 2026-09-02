import React, { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  Crown,
  Globe,
  Moon,
  Sun,
  Download,
  Database,
  Save,
  CheckCircle2,
  Link2,
  Unlink,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { sanitizePhoneInput } from '../../utils/phone';
import { useData } from '../../context/DataContext';
import { googleDriveService } from '../../multiTenant/googleDriveService';

export const SettingsModule: React.FC = () => {
  const { t, language, setLanguage } = useLanguage();
  const { darkMode, toggleDarkMode } = useTheme();
  const {
    settings,
    updateSettings,
    exportBackupJson,
    seedSampleData,
  } = useData();

  const [companyNameAr, setCompanyNameAr] = useState(settings.companyNameAr);
  const [companyNameEn, setCompanyNameEn] = useState(settings.companyNameEn);
  const [phone, setPhone] = useState(settings.phone);
  const [email, setEmail] = useState(settings.companyEmail);
  const [addressAr, setAddressAr] = useState(settings.addressAr);
  const [addressEn, setAddressEn] = useState(settings.addressEn);
  const [taxNumber, setTaxNumber] = useState(settings.taxNumber || '');
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || '');
  const [designUploadFolderUrl, setDesignUploadFolderUrl] = useState(settings.designUploadFolderUrl || '');
  const [termsAr, setTermsAr] = useState(settings.termsAr || '');
  const [termsEn, setTermsEn] = useState(settings.termsEn || '');
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveConnected, setDriveConnected] = useState(Boolean(settings.googleDriveConnected));
  const [driveMessage, setDriveMessage] = useState('');

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setDriveConnected(Boolean(settings.googleDriveConnected)), [settings.googleDriveConnected]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'google-drive-connected') return;
      setDriveConnected(true);
      setDriveMessage('تم ربط Google Drive بنجاح.');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const connectGoogleDrive = async () => {
    if (!designUploadFolderUrl.trim()) return setDriveMessage('ضع رابط فولدر Google Drive أولًا.');
    setDriveBusy(true);
    setDriveMessage('');
    try {
      await updateSettings({ designUploadFolderUrl: designUploadFolderUrl.trim() });
      const { authorizationUrl } = await googleDriveService.beginConnection(designUploadFolderUrl.trim());
      const popup = window.open(authorizationUrl, 'google-drive-authorization', 'width=560,height=700,resizable=yes,scrollbars=yes');
      if (!popup) setDriveMessage('اسمح بفتح النافذة المنبثقة لإكمال ربط Google Drive.');
      else setDriveMessage('سجّل الدخول بحساب Google الذي يملك الفولدر، ثم وافق على صلاحية الرفع.');
    } catch (error) {
      setDriveMessage(error instanceof Error ? error.message : 'تعذر بدء ربط Google Drive.');
    } finally {
      setDriveBusy(false);
    }
  };

  const disconnectGoogleDrive = async () => {
    setDriveBusy(true);
    setDriveMessage('');
    try {
      await googleDriveService.disconnect();
      setDriveConnected(false);
      setDriveMessage('تم إلغاء ربط Google Drive.');
    } catch (error) {
      setDriveMessage(error instanceof Error ? error.message : 'تعذر إلغاء ربط Google Drive.');
    } finally {
      setDriveBusy(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      await updateSettings({
        companyNameAr, companyNameEn, phone, email, addressAr, addressEn,
        taxNumber, logoUrl, designUploadFolderUrl: designUploadFolderUrl.trim(), termsAr, termsEn,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-300">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-amber-500" />
          <span>{t('settings')}</span>
        </h2>
      </div>

      {savedSuccess && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>Company settings saved successfully!</span>
        </div>
      )}

      {/* Language & Appearance Card */}
      <div className="p-6 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-900 dark:text-white text-base">
          System Preferences
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {/* Language Picker */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5 text-amber-500" />
              <div>
                <span className="font-bold text-xs text-slate-900 dark:text-white block">
                  {t('language')}
                </span>
                <span className="text-[11px] text-slate-400">Arabic RTL / English LTR</span>
              </div>
            </div>

            <div className="flex items-center gap-1 bg-white dark:bg-slate-700 p-1 rounded-xl border border-slate-200 dark:border-slate-600">
              <button
                type="button"
                onClick={() => setLanguage('ar')}
                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                  language === 'ar' ? 'bg-amber-500 text-white' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                العربية
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                  language === 'en' ? 'bg-amber-500 text-white' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                English
              </button>
            </div>
          </div>

          {/* Dark Mode Toggle */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {darkMode ? (
                <Moon className="w-5 h-5 text-amber-400" />
              ) : (
                <Sun className="w-5 h-5 text-amber-500" />
              )}
              <div>
                <span className="font-bold text-xs text-slate-900 dark:text-white block">
                  {t('darkMode')}
                </span>
                <span className="text-[11px] text-slate-400">High contrast dark theme</span>
              </div>
            </div>

            <button
              type="button"
              onClick={toggleDarkMode}
              aria-label={t('darkMode')}
              className={`w-12 h-6 rounded-full p-1 transition-colors cursor-pointer shrink-0 relative overflow-hidden ${
                darkMode ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white shadow-xs transition-transform duration-200 ease-in-out ${
                  darkMode ? 'ltr:translate-x-6 rtl:-translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Company Info Form */}
      <form
        onSubmit={handleSaveSettings}
        className="p-6 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4"
      >
        <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
          <Crown className="w-5 h-5 text-amber-500" />
          <span>{t('companyInfo')}</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('companyNameAr')}
            </label>
            <input
              type="text"
              required
              value={companyNameAr}
              onChange={(e) => setCompanyNameAr(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('companyNameEn')}
            </label>
            <input
              type="text"
              required
              value={companyNameEn}
              onChange={(e) => setCompanyNameEn(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('companyPhone')}
            </label>
            <input
              type="text"
              required
              value={phone}
              onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
              dir="ltr"
              inputMode="tel"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('companyEmail')}
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('companyAddressAr')}
            </label>
            <input
              type="text"
              value={addressAr}
              onChange={(e) => setAddressAr(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('companyAddressEn')}
            </label>
            <input
              type="text"
              value={addressEn}
              onChange={(e) => setAddressEn(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('taxNumber')}
            </label>
            <input
              type="text"
              value={taxNumber}
              onChange={(e) => setTaxNumber(e.target.value)}
              placeholder="Commercial Registry / Tax ID"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('companyLogo')} URL
            </label>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="sm:col-span-2 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/15">
            <h4 className="mb-1 text-sm font-black text-indigo-950 dark:text-indigo-100">مركز رفع الصور</h4>
            <p className="mb-3 text-xs text-slate-600 dark:text-slate-300">اختر الرفع اليدوي بالرابط، أو اربط حساب Google للرفع التلقائي.</p>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              رابط مركز رفع صور الأوردرات (Google Drive)
            </label>
            <input
              type="url"
              disabled={driveConnected}
              value={designUploadFolderUrl}
              onChange={(e) => setDesignUploadFolderUrl(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
              dir="ltr"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="mt-1 text-[11px] text-slate-500">يمكن استخدام الرابط وحده لفتح الفولدر والرفع يدويًا، أو ربط حساب Google للرفع التلقائي مباشرةً من الأوردر.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void connectGoogleDrive()}
                disabled={driveBusy || driveConnected}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Link2 className="w-4 h-4" />
                {driveConnected ? 'Google Drive متصل' : driveBusy ? 'جارٍ بدء الربط…' : 'ربط Google Drive'}
              </button>
              {driveConnected && <button type="button" onClick={() => void disconnectGoogleDrive()} disabled={driveBusy} className="flex items-center gap-2 rounded-xl border border-rose-200 px-3.5 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"><Unlink className="w-4 h-4" />إلغاء الربط</button>}
              <span className={`text-xs font-bold ${driveConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>{driveConnected ? 'الرفع التلقائي مفعل لهذه الشركة.' : 'يمكنك استخدام الرفع اليدوي بالرابط أو ربط Google للرفع التلقائي.'}</span>
            </div>
            {driveMessage && <p className="mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{driveMessage}</p>}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
            {t('terms')} (Arabic)
          </label>
          <textarea
            rows={3}
            value={termsAr}
            onChange={(e) => setTermsAr(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-md shadow-amber-500/20 flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'جارٍ الحفظ...' : t('save')}</span>
          </button>
        </div>
      </form>

      {/* Backup Card */}
      <div className="p-6 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
          <Database className="w-5 h-5 text-amber-500" />
          <span>{t('backupRestore')}</span>
        </h3>

        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {language === 'ar'
            ? 'يمكنك تصدير نسخة احتياطية من بيانات شركتك الآن. استعادة النسخ الاحتياطية ستتوفر في إصدار قادم بعد إضافة مراجعة آمنة للبيانات قبل الاستيراد.'
            : 'You can export a backup of your company data now. Backup restore will be available in a future release after secure data review before import.'}
        </p>

        <div className="max-w-sm">
          {/* Export JSON */}
          <button
            type="button"
            onClick={exportBackupJson}
            className="w-full p-4 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-start flex flex-col justify-between cursor-pointer transition-colors"
          >
            <Download className="w-5 h-5 text-amber-500 mb-2" />
            <div>
              <span className="font-bold text-xs text-slate-900 dark:text-white block">
                {t('backupData')}
              </span>
              <span className="text-[10px] text-slate-400">Download system data as JSON</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
