import React from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Boxes,
  Receipt,
  CalendarDays,
  BarChart3,
  Settings as SettingsIcon,
  ShieldCheck,
  X,
  Crown,
  HardHat,
  History,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';

export type ActiveTab =
  | 'dashboard'
  | 'orders'
  | 'workers'
  | 'customers'
  | 'inventory'
  | 'expenses'
  | 'calendar'
  | 'reports'
  | 'activityLog'
  | 'users'
  | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  isOpen,
  onClose,
}) => {
  const { t } = useLanguage();
  const { orders, inventory } = useData();
  const { profile } = useAuth();

  const pendingOrdersCount = orders.filter((o) => o.orderStatus === 'pending' || o.orderStatus === 'in_progress').length;
  const lowInventoryCount = inventory.filter((i) => i.availableQuantity <= i.minStockLevel).length;

  const userRole = profile?.role || 'employee';

  const allNavItems: { id: ActiveTab; labelKey: keyof typeof import('../i18n/translations').translations['en']; icon: React.FC<{ className?: string }>; badge?: number; roles: ('super_admin' | 'admin' | 'manager' | 'employee' | 'worker')[] }[] = [
    { id: 'dashboard', labelKey: 'dashboard', icon: LayoutDashboard, roles: ['super_admin', 'admin', 'manager'] },
    { id: 'orders', labelKey: userRole === 'worker' ? 'myOrders' : 'orders', icon: ClipboardList, badge: pendingOrdersCount, roles: ['super_admin', 'admin', 'manager', 'employee', 'worker'] },
    { id: 'workers', labelKey: 'workers', icon: HardHat, roles: ['super_admin', 'admin', 'manager'] },
    { id: 'customers', labelKey: 'customers', icon: Users, roles: ['super_admin', 'admin', 'manager', 'employee'] },
    { id: 'inventory', labelKey: 'inventory', icon: Boxes, badge: lowInventoryCount, roles: ['super_admin', 'admin', 'manager'] },
    { id: 'expenses', labelKey: 'expenses', icon: Receipt, roles: ['super_admin', 'admin'] },
    { id: 'calendar', labelKey: 'calendar', icon: CalendarDays, roles: ['super_admin', 'admin', 'manager', 'employee'] },
    { id: 'reports', labelKey: 'reports', icon: BarChart3, roles: ['super_admin', 'admin'] },
    { id: 'activityLog', labelKey: 'activityLog', icon: History, roles: ['super_admin', 'admin'] },
    { id: 'users', labelKey: 'users', icon: ShieldCheck, roles: ['super_admin', 'admin'] },
    { id: 'settings', labelKey: 'settings', icon: SettingsIcon, roles: ['super_admin', 'admin'] },
  ];

  const navItems = allNavItems.filter((item) => item.roles.includes(userRole));

  const handleTabClick = (id: ActiveTab) => {
    setActiveTab(id);
    onClose();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed lg:sticky top-0 lg:top-14 sm:lg:top-16 ltr:left-0 rtl:right-0 z-50 lg:z-10 h-screen lg:h-[calc(100vh-3.5rem)] sm:lg:h-[calc(100vh-4rem)] w-64 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between transition-transform duration-300 ease-in-out ${
          isOpen
            ? 'translate-x-0'
            : 'ltr:-translate-x-full rtl:translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Mobile / Sidebar Top Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800">
          <button onClick={() => handleTabClick('dashboard')} className="flex items-center gap-3 text-start cursor-pointer">
            <div className="w-8 h-8 sm:w-9 sm:h-9 premium-gold-bg rounded-xl flex items-center justify-center font-extrabold text-base shadow-xs shadow-amber-500/20">
              <Crown className="w-4 h-4 text-slate-950 fill-slate-950" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-black tracking-tight text-slate-900 dark:text-white leading-tight">
                {t('appName')}
              </span>
            </div>
          </button>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl lg:hidden transition-colors cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="p-3 space-y-1 overflow-y-auto flex-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-3 sm:py-2.5 rounded-xl font-medium text-xs transition-all cursor-pointer min-h-[44px] ${
                  isActive
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-extrabold border-l-2 border-amber-500 rtl:border-l-0 rtl:border-r-2 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`} />
                  <span>{t(item.labelKey)}</span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${
                      isActive
                        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer info */}
        <div className="p-3.5 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5 p-2.5 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-700/50">
            <div className="w-7 h-7 rounded-lg premium-gold-bg font-black text-xs flex items-center justify-center">
              W
            </div>
            <div className="text-[11px] min-w-0">
              <p className="font-bold text-slate-800 dark:text-slate-200 truncate">{t('appName')}</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">v2.5 PRO</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
