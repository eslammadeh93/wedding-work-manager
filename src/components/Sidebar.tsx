import React from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Boxes,
  BarChart3,
  Settings as SettingsIcon,
  X,
  HardHat,
  UsersRound,
  UserRound,
  ContactRound,
  Wallet,
  Target,
  CalendarDays,
  ArchiveRestore,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { USE_MULTI_TENANT_DATA } from '../multiTenant/featureFlags';
import type { Permission } from '../multiTenant/permissions';
import wwmLogo from '../assets/wwm-logo.png';

export type ActiveTab =
  | 'dashboard'
  | 'orders'
  | 'workers'
  | 'customers'
  | 'suppliers'
  | 'inventory'
  | 'expenses'
  | 'calendar'
  | 'reports'
  | 'activityLog'
  | 'workerPerformance'
  | 'settings'
  | 'members'
  | 'profile'
  | 'recycleBin';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isOpen: boolean;
  onClose: () => void;
}

type NavigationGroup = 'workspace' | 'sales' | 'operations' | 'finance' | 'administration' | 'account';

const navigationGroupLabels: Record<NavigationGroup, { ar: string; en: string }> = {
  workspace: { ar: 'مساحة العمل', en: 'Workspace' },
  sales: { ar: 'العملاء والطلبات', en: 'Customers & Orders' },
  operations: { ar: 'التشغيل', en: 'Operations' },
  finance: { ar: 'المالية والتقارير', en: 'Finance & Reports' },
  administration: { ar: 'الإدارة', en: 'Administration' },
  account: { ar: 'الحساب', en: 'Account' },
};

const navigationGroupOrder: NavigationGroup[] = ['workspace', 'sales', 'operations', 'finance', 'administration', 'account'];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  isOpen,
  onClose,
}) => {
  const { t, language } = useLanguage();
  const { orders, inventory } = useData();
  const { profile, authSession } = useAuth();

  const pendingOrdersCount = orders.filter((o) => o.orderStatus === 'pending' || o.orderStatus === 'in_progress').length;
  const lowInventoryCount = inventory.filter((i) => i.availableQuantity <= i.minStockLevel).length;

  const userRole = profile?.role || 'employee';

  const allNavItems: { id: ActiveTab; group: NavigationGroup; labelKey?: keyof typeof import('../i18n/translations').translations['en']; label?: string; icon: React.FC<{ className?: string }>; badge?: number; roles: ('super_admin' | 'admin' | 'manager' | 'employee' | 'worker')[]; permission?: Permission }[] = [
    { id: 'dashboard', group: 'workspace', labelKey: 'dashboard', icon: LayoutDashboard, roles: ['super_admin', 'admin', 'manager'], permission: 'company:dashboard:read' },
    { id: 'orders', group: 'sales', labelKey: userRole === 'worker' ? 'myOrders' : 'orders', icon: ClipboardList, badge: pendingOrdersCount, roles: ['super_admin', 'admin', 'manager', 'employee', 'worker'], permission: 'company:orders:read' },
    { id: 'customers', group: 'sales', labelKey: 'customers', icon: Users, roles: ['super_admin', 'admin', 'manager', 'employee'], permission: 'company:customers:read' },
    { id: 'calendar', group: 'sales', label: language === 'ar' ? 'تقويم التركيبات' : 'Installation Calendar', icon: CalendarDays, roles: ['super_admin', 'admin', 'manager', 'employee'], permission: 'company:calendar:read' },
    { id: 'suppliers', group: 'sales', label: language === 'ar' ? 'جهات الاتصال والموردين' : 'Supplier Contacts', icon: ContactRound, roles: ['super_admin', 'admin', 'manager', 'employee'], permission: 'company:suppliers:read' },
    { id: 'workers', group: 'operations', labelKey: 'workers', icon: HardHat, roles: ['super_admin', 'admin', 'manager'], permission: 'company:workers:read' },
    { id: 'workerPerformance', group: 'operations', label: language === 'ar' ? (userRole === 'worker' ? 'متابعة أدائي' : 'متابعة أداء العمال') : (userRole === 'worker' ? 'My Performance' : 'Worker Performance'), icon: Target, roles: ['super_admin', 'admin', 'manager', 'worker'], permission: 'company:worker_performance:read' },
    { id: 'inventory', group: 'operations', labelKey: 'inventory', icon: Boxes, badge: lowInventoryCount, roles: ['super_admin', 'admin', 'manager'], permission: 'company:inventory:read' },
    { id: 'expenses', group: 'finance', label: 'رأس المال والمصروفات', icon: Wallet, roles: ['super_admin'], permission: 'company:expenses:read' },
    { id: 'reports', group: 'finance', labelKey: 'reports', icon: BarChart3, roles: ['super_admin', 'admin', 'manager'], permission: 'company:reports:read' },
    { id: 'members', group: 'administration', label: 'إدارة الموظفين', icon: UsersRound, roles: ['super_admin', 'manager'], permission: 'company:members:read' },
    { id: 'recycleBin', group: 'administration', label: language === 'ar' ? 'سلة المحذوفات' : 'Recycle Bin', icon: ArchiveRestore, roles: ['super_admin', 'admin', 'manager'], permission: 'company:settings:read' },
    { id: 'settings', group: 'administration', labelKey: 'settings', icon: SettingsIcon, roles: ['super_admin', 'admin', 'manager'], permission: 'company:settings:read' },
    { id: 'profile', group: 'account', label: 'الملف الشخصي', icon: UserRound, roles: ['super_admin', 'manager'] },
  ];

  const navItems = allNavItems.filter((item) => USE_MULTI_TENANT_DATA
    ? authSession?.userType === 'company' && (item.id === 'profile' || !item.permission || authSession.permissions.includes(item.permission))
    : item.roles.includes(userRole));
  const groupedNavItems = navigationGroupOrder.map(group => ({ group, items: navItems.filter(item => item.group === group) })).filter(({ items }) => items.length > 0);

  const handleTabClick = (id: ActiveTab) => {
    setActiveTab(id);
    onClose();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 min-[1700px]:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed min-[1700px]:sticky top-0 min-[1700px]:top-14 sm:min-[1700px]:top-16 ltr:left-0 rtl:right-0 z-50 min-[1700px]:z-10 h-screen min-[1700px]:h-[calc(100vh-3.5rem)] sm:min-[1700px]:h-[calc(100vh-4rem)] w-64 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between transition-transform duration-300 ease-in-out ${
          isOpen
            ? 'translate-x-0'
            : 'ltr:-translate-x-full rtl:translate-x-full min-[1700px]:translate-x-0'
        }`}
      >
        {/* Mobile / Sidebar Top Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800">
          <button onClick={() => handleTabClick('dashboard')} className="flex items-center gap-3 text-start cursor-pointer">
            <div className="w-8 h-8 sm:w-9 sm:h-9 overflow-hidden rounded-xl shadow-xs shadow-amber-500/20">
              <img src={wwmLogo} alt="Wedding Work Manager" className="w-full h-full object-cover" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-black tracking-tight text-slate-900 dark:text-white leading-tight">
                {t('appName')}
              </span>
            </div>
          </button>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl min-[1700px]:hidden transition-colors cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="p-3 overflow-y-auto flex-1">
          {groupedNavItems.map(({ group, items }, groupIndex) => <div key={group} className={groupIndex === 0 ? '' : 'mt-3 border-t border-slate-200 pt-3 dark:border-slate-800'}>
            <p className="mb-1.5 px-3 text-[10px] font-black tracking-wide text-slate-400 dark:text-slate-500">{language === 'ar' ? navigationGroupLabels[group].ar : navigationGroupLabels[group].en}</p>
            <div className="space-y-1">{items.map((item) => {
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
                  <span>{item.label || (item.labelKey ? t(item.labelKey) : '')}</span>
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
            })}</div>
          </div>)}
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
