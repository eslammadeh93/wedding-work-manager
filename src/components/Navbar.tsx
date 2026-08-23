import React from 'react';
import {
  Search,
  Bell,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import wwmLogo from '../assets/wwm-logo.png';

interface NavbarProps {
  onOpenSearch: () => void;
  onToggleNotificationDrawer: () => void;
  onNavigateDashboard: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenSearch,
  onToggleNotificationDrawer,
  onNavigateDashboard,
}) => {
  const { language, setLanguage, t } = useLanguage();
  const { darkMode, toggleDarkMode } = useTheme();
  const { logout } = useAuth();
  const { settings, notifications } = useData();

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <header className="sticky top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 transition-colors shadow-xs">
      <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-1.5 sm:gap-4 overflow-x-hidden">
        {/* Brand Logo & Name */}
        <button onClick={onNavigateDashboard} className="flex items-center gap-2 sm:gap-3 shrink-0 cursor-pointer" title={t('dashboard')}>
          <div className="w-8 h-8 sm:w-9 sm:h-9 overflow-hidden rounded-xl shadow-xs shadow-amber-500/20 shrink-0">
            {settings.logoUrl ? (
              <img
                src={settings.logoUrl}
                alt="Wedding Work Manager"
                className="w-full h-full object-cover"
              />
            ) : (
              <img src={wwmLogo} alt="Wedding Work Manager" className="w-full h-full object-cover" />
            )}
          </div>
          <span className="text-xs sm:text-base md:text-lg font-black tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
            {language === 'ar' ? 'مدير أعمال الويدينج' : 'Wedding Work Manager'}
          </span>
        </button>

        {/* Global Search trigger */}
        <div className="flex-1 max-w-xs md:max-w-md hidden md:block">
          <button
            onClick={onOpenSearch}
            className="w-full flex items-center gap-2.5 px-3.5 py-1.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 rounded-full border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
          >
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="flex-1 text-start truncate">{t('searchPlaceholder')}</span>
            <kbd className="hidden lg:inline-block text-[10px] font-mono bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 text-slate-500 uppercase">
              Ctrl K
            </kbd>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Mobile Search Icon */}
          <button
            onClick={onOpenSearch}
            className="md:hidden p-2 w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
            title={t('search')}
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Language Toggle Pill */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-[10px] font-bold uppercase border border-slate-200/80 dark:border-slate-700/80 shrink-0">
            <button
              onClick={() => setLanguage('ar')}
              className={`px-1.5 sm:px-2 py-1 rounded transition-all cursor-pointer ${
                language === 'ar'
                  ? 'bg-amber-400 text-slate-900 shadow-xs font-extrabold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              عربي
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={`px-1.5 sm:px-2 py-1 rounded transition-all cursor-pointer ${
                language === 'en'
                  ? 'bg-amber-400 text-slate-900 shadow-xs font-extrabold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              EN
            </button>
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

          {/* Dark Mode Toggle */}
          <button
            onClick={toggleDarkMode}
            className="p-2 w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
            title={t('darkMode')}
          >
            {darkMode ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600" />
            )}
          </button>

          {/* Notifications Trigger */}
          <button
            onClick={onToggleNotificationDrawer}
            className="relative p-2 w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
            title={t('notifications')}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {/* Square Logout Icon Button */}
          <button
            onClick={() => logout()}
            className="p-2 w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 rounded-lg border border-rose-200/60 dark:border-rose-800/60 transition-colors cursor-pointer shrink-0"
            title="تسجيل الخروج"
            aria-label="تسجيل الخروج"
          >
            <LogOut className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          </button>
        </div>
      </div>
    </header>
  );
};
