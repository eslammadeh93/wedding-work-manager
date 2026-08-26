import React, { useState, useEffect, Suspense, lazy } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { USE_MULTI_TENANT_DATA } from './multiTenant/featureFlags';
import { CompanySessionRouteGuard, PlatformRouteGuard } from './multiTenant/RouteGuards';
import type { Permission } from './multiTenant/permissions';
import { PlatformErrorBoundary } from './multiTenant/platform/PlatformErrorBoundary';

import { Navbar } from './components/Navbar';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { GlobalSearchErrorBoundary, GlobalSearchModal } from './components/GlobalSearchModal';
import { NotificationDrawer } from './components/NotificationDrawer';
import { MobileManagerNav } from './components/MobileManagerNav';
import { LoginPage } from './components/auth/LoginPage';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { WorkerPushNotificationsPrompt } from './components/WorkerPushNotificationsPrompt';

import { Menu, Crown, Loader2 } from 'lucide-react';
import wwmLogo from './assets/wwm-logo.png';

// Load each workspace only when it is opened. This keeps PDF/Excel and other
// heavy feature code out of the application's initial download.
const DashboardModule = lazy(() => import('./components/dashboard/DashboardModule').then(({ DashboardModule }) => ({ default: DashboardModule })));
const OrdersModule = lazy(() => import('./components/orders/OrdersModule').then(({ OrdersModule }) => ({ default: OrdersModule })));
const WorkersModule = lazy(() => import('./components/workers/WorkersModule').then(({ WorkersModule }) => ({ default: WorkersModule })));
const CustomersModule = lazy(() => import('./components/customers/CustomersModule').then(({ CustomersModule }) => ({ default: CustomersModule })));
const SuppliersModule = lazy(() => import('./components/suppliers/SuppliersModule').then(({ SuppliersModule }) => ({ default: SuppliersModule })));
const InventoryModule = lazy(() => import('./components/inventory/InventoryModule').then(({ InventoryModule }) => ({ default: InventoryModule })));
const ExpensesModule = lazy(() => import('./components/expenses/ExpensesModule').then(({ ExpensesModule }) => ({ default: ExpensesModule })));
const CalendarModule = lazy(() => import('./components/calendar/CalendarModule').then(({ CalendarModule }) => ({ default: CalendarModule })));
const ReportsModule = lazy(() => import('./components/reports/ReportsModule').then(({ ReportsModule }) => ({ default: ReportsModule })));
const ActivityLogModule = lazy(() => import('./components/activityLogs/ActivityLogModule').then(({ ActivityLogModule }) => ({ default: ActivityLogModule })));
const WorkerPerformanceModule = lazy(() => import('./components/workerPerformance/WorkerPerformanceModule').then(({ WorkerPerformanceModule }) => ({ default: WorkerPerformanceModule })));
const WorkerMovementsModule = lazy(() => import('./components/workerPerformance/WorkerMovementsModule').then(({ WorkerMovementsModule }) => ({ default: WorkerMovementsModule })));
const SettingsModule = lazy(() => import('./components/settings/SettingsModule').then(({ SettingsModule }) => ({ default: SettingsModule })));
const PlatformModule = lazy(() => import('./multiTenant/platform/PlatformModule').then(({ PlatformModule }) => ({ default: PlatformModule })));
const CompanyMembersModule = lazy(() => import('./components/company/CompanyMembersModule').then(({ CompanyMembersModule }) => ({ default: CompanyMembersModule })));
const ProfileModule = lazy(() => import('./components/profile/ProfileModule').then(({ ProfileModule }) => ({ default: ProfileModule })));
const RecycleBinModule = lazy(() => import('./components/recycleBin/RecycleBinModule').then(({ RecycleBinModule }) => ({ default: RecycleBinModule })));

function UnauthorizedPlatform() {
  return <div dir="rtl" className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6 text-center"><div><Crown className="w-10 h-10 text-amber-500 mx-auto mb-3" /><h1 className="font-black text-xl">غير مصرح لك بالدخول</h1><p className="text-sm text-slate-500 mt-2">هذه الصفحة متاحة لحسابات إدارة المنصة فقط.</p></div></div>;
}

function UnauthorizedCompanyMembers() {
  return <div dir="rtl" className="min-h-64 flex items-center justify-center text-center"><div><Crown className="w-10 h-10 text-amber-500 mx-auto mb-3" /><h1 className="font-black text-xl">غير مصرح لك بالدخول</h1><p className="text-sm text-slate-500 mt-2">ليس لديك الصلاحية المطلوبة لعرض هذا القسم.</p></div></div>;
}

const tabPermission: Partial<Record<ActiveTab, Permission>> = {
  dashboard: 'company:dashboard:read', orders: 'company:orders:read', customers: 'company:customers:read', suppliers: 'company:suppliers:read',
  inventory: 'company:inventory:read', expenses: 'company:expenses:read', workers: 'company:workers:read',
  calendar: 'company:calendar:read', reports: 'company:reports:read', activityLog: 'company:activity_logs:read',
  workerPerformance: 'company:worker_performance:read',
  workerMovements: 'company:worker_performance:read',
  settings: 'company:settings:read', members: 'company:members:read',
  recycleBin: 'company:settings:read',
};
const activeTabs: readonly ActiveTab[] = ['dashboard', 'orders', 'workers', 'workerPerformance', 'workerMovements', 'customers', 'suppliers', 'inventory', 'expenses', 'calendar', 'reports', 'activityLog', 'settings', 'members', 'profile', 'recycleBin'];
const activeTabStorageKey = (uid: string) => `wedding_manager_active_tab:${uid}`;
const isActiveTab = (value: string | null): value is ActiveTab => value !== null && activeTabs.includes(value as ActiveTab);

// Legacy accounts do not have a permission list, so retain their role-based
// access rules here. This check deliberately happens before a lazy module is
// mounted: an unauthorized initial/restored tab must not request its chunk.
const legacyTabRoles: Partial<Record<ActiveTab, readonly NonNullable<ReturnType<typeof useAuth>['profile']>['role'][]>> = {
  dashboard: ['super_admin', 'admin', 'manager'],
  orders: ['super_admin', 'admin', 'manager', 'employee', 'worker'],
  workers: ['super_admin', 'admin', 'manager'],
  workerPerformance: ['super_admin', 'admin', 'manager', 'worker'],
  workerMovements: ['super_admin', 'admin', 'manager'],
  customers: ['super_admin', 'admin', 'manager', 'employee'],
  suppliers: ['super_admin', 'admin', 'manager', 'employee'],
  inventory: ['super_admin', 'admin', 'manager'],
  expenses: ['super_admin'],
  calendar: ['super_admin', 'admin', 'manager', 'employee'],
  reports: ['super_admin', 'admin', 'manager'],
  activityLog: ['super_admin', 'admin', 'manager'],
  settings: ['super_admin', 'admin', 'manager'],
  recycleBin: ['super_admin', 'admin', 'manager'],
};

function CompanyTabGuard({ tab, children }: { tab: ActiveTab; children: React.ReactNode }) {
  const { profile, authSession } = useAuth();
  const permission = tabPermission[tab];
  if (USE_MULTI_TENANT_DATA) {
    return permission
      ? <CompanySessionRouteGuard permission={permission} fallback={<UnauthorizedCompanyMembers />}>{children}</CompanySessionRouteGuard>
      : <>{children}</>;
  }

  const role = profile?.role;
  const allowedRoles = legacyTabRoles[tab];
  return !allowedRoles || (role !== undefined && allowedRoles.includes(role))
    ? <>{children}</>
    : <UnauthorizedCompanyMembers />;
}

/** Kept outside the legacy tree so platform code is only requested after verification. */
function PlatformEntry() {
  const { user, authSession, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 text-amber-500 animate-spin" /></div>;
  // Any active platform role may enter the workspace. Individual pages and
  // navigation items are guarded by the role permission matrix below.
  if (!user || authSession?.userType !== 'platform') return <UnauthorizedPlatform />;
  return <PlatformRouteGuard fallback={<UnauthorizedPlatform />}><PlatformErrorBoundary><div className="platform-ui"><Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 text-amber-500 animate-spin" /></div>}><PlatformModule /></Suspense></div></PlatformErrorBoundary></PlatformRouteGuard>;
}

const getPageTitle = (tab: ActiveTab, lang: string): string => {
  if (lang === 'ar') {
    switch (tab) {
      case 'dashboard':
        return 'لوحة التحكم';
      case 'orders':
        return 'الطلبات';
      case 'workers':
        return 'العمال';
      case 'workerPerformance':
        return 'متابعة الأداء';
      case 'workerMovements':
        return 'تحركات العامل';
      case 'customers':
        return 'العملاء';
      case 'suppliers':
        return 'جهات الاتصال والموردين';
      case 'inventory':
        return 'المخزن';
      case 'expenses':
        return 'المصروفات';
      case 'reports':
        return 'التقارير';
      case 'activityLog':
        return 'سجل النشاط';
      case 'calendar':
        return 'التقويم';
      case 'settings':
        return 'الإعدادات';
      case 'members':
        return 'إدارة الموظفين';
      case 'profile':
        return 'الملف الشخصي';
      case 'recycleBin':
        return 'سلة المحذوفات';
      default:
        return 'لوحة التحكم';
    }
  } else {
    switch (tab) {
      case 'dashboard':
        return 'Dashboard';
      case 'orders':
        return 'Orders';
      case 'workers':
        return 'Workers';
      case 'workerPerformance':
        return 'Worker Performance';
      case 'workerMovements':
        return 'Worker Movements';
      case 'customers':
        return 'Customers';
      case 'suppliers':
        return 'Supplier Contacts';
      case 'inventory':
        return 'Inventory';
      case 'expenses':
        return 'Expenses';
      case 'reports':
        return 'Reports';
      case 'activityLog':
        return 'Activity Log';
      case 'calendar':
        return 'Calendar';
      case 'settings':
        return 'Settings';
      case 'members':
        return 'Employees';
      case 'profile':
        return 'Profile';
      case 'recycleBin':
        return 'Recycle Bin';
      default:
        return 'Dashboard';
    }
  }
};

function AppContent() {
  const { user, profile, authSession, loading, usersInitialized, isDemo } = useAuth();
  const { language } = useLanguage();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
  const [createOrderRequest, setCreateOrderRequest] = useState(0);
  const [todaysOrdersRequest, setTodaysOrdersRequest] = useState(0);
  const [notificationOrderId, setNotificationOrderId] = useState<string | undefined>();
  const [restoredTabForUid, setRestoredTabForUid] = useState<string | null>(null);
  const [showMobileSectionBar, setShowMobileSectionBar] = useState(false);

  // The browser history cannot be erased, but once a session ends every
  // history navigation is rewritten to the public login URL before protected
  // UI can render. This also covers platform URLs such as /platform/...
  // restored through the browser Back button.
  useEffect(() => {
    if (loading || !usersInitialized || (user && profile)) return;

    const forcePublicLoginUrl = () => {
      if (window.location.pathname !== '/') {
        window.history.replaceState({ loggedOut: true }, '', '/');
      }
    };

    forcePublicLoginUrl();
    window.addEventListener('popstate', forcePublicLoginUrl);
    return () => window.removeEventListener('popstate', forcePublicLoginUrl);
  }, [loading, usersInitialized, user, profile]);

  // Restore the workspace page after a refresh. It is scoped to the signed-in
  // user and kept only for this browser tab, so it cannot leak between users.
  useEffect(() => {
    if (user && profile) {
      setCreateOrderRequest(0);
      if (authSession?.userType === 'platform') return;
      let savedTab: string | null = null;
      try {
        savedTab = sessionStorage.getItem(activeTabStorageKey(user.uid));
      } catch {
        // Private browsing may disable storage; the normal default still works.
      }
      setActiveTab(isActiveTab(savedTab) ? savedTab : profile.role === 'worker' ? 'orders' : 'dashboard');
      setRestoredTabForUid(user.uid);
    } else {
      setRestoredTabForUid(null);
    }
  }, [user?.uid, profile?.role, authSession?.userType]);

  // A dashboard "create order" request is a one-shot signal. Clear it as
  // soon as Orders is left so reopening the section never reopens the modal.
  useEffect(() => {
    if (activeTab !== 'orders') setCreateOrderRequest(0);
  }, [activeTab]);

  // Role guard for current active tab
  useEffect(() => {
    if (USE_MULTI_TENANT_DATA && authSession?.userType === 'company') {
      const requiredPermission = tabPermission[activeTab];
      if (!requiredPermission || authSession.permissions.includes(requiredPermission)) return;
      const fallback = (Object.keys(tabPermission) as ActiveTab[]).find(tab => authSession.permissions.includes(tabPermission[tab]!));
      if (fallback) setActiveTab(fallback);
      return;
    }
    const role = profile?.role || 'employee';
    if (role === 'worker') {
      if (!['orders', 'workerPerformance'].includes(activeTab)) {
        setActiveTab('orders');
      }
    } else if (role === 'employee') {
      const allowedEmployeeTabs: ActiveTab[] = ['orders', 'customers', 'suppliers', 'calendar'];
      if (!allowedEmployeeTabs.includes(activeTab)) {
        setActiveTab('orders');
      }
    }
  }, [profile?.role, activeTab]);

  // Persist only after the saved tab has been restored. The role/permission
  // guard above will replace an outdated or unauthorized tab before it is
  // retained for the next refresh.
  useEffect(() => {
    if (!user || !profile || authSession?.userType === 'platform' || restoredTabForUid !== user.uid) return;
    try {
      sessionStorage.setItem(activeTabStorageKey(user.uid), activeTab);
    } catch {
      // Storage is optional; navigation remains fully functional without it.
    }
  }, [user?.uid, profile?.uid, authSession?.userType, restoredTabForUid, activeTab]);

  // Ctrl/Cmd + K shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // The section switcher at the top naturally scrolls away with long pages.
  // On handheld screens, keep a compact replacement within reach once that
  // happens, so the sidebar can be opened without returning to the top.
  useEffect(() => {
    const mobileViewport = window.matchMedia('(max-width: 1023px)');
    const updateVisibility = () => setShowMobileSectionBar(mobileViewport.matches && window.scrollY > 160);
    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
    mobileViewport.addEventListener('change', updateVisibility);
    return () => {
      window.removeEventListener('scroll', updateVisibility);
      mobileViewport.removeEventListener('change', updateVisibility);
    };
  }, []);

  // With the flag off this branch is never selected: no platform module,
  // routes, navigation, or queries are activated in the legacy application.
  if (USE_MULTI_TENANT_DATA && authSession?.userType === 'platform') {
    return <PlatformEntry />;
  }

  const handleNavigate = (tab: ActiveTab, referenceId?: string) => {
    if (tab === 'orders' && referenceId) setNotificationOrderId(referenceId);
    setActiveTab(tab);
  };

  const handleCreateOrder = () => {
    setActiveTab('orders');
    setCreateOrderRequest((request) => request + 1);
  };

  const handleOpenTodaysOrders = () => {
    setActiveTab('orders');
    setTodaysOrdersRequest((request) => request + 1);
  };

  const handleOpenWorkerMovements = () => {
    setActiveTab('workerMovements');
  };

  // 1. App Startup Loading State
  if (loading || !usersInitialized || (user && profile && authSession?.userType !== 'platform' && restoredTabForUid !== user.uid)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-4 transition-colors">
        <div className="w-12 h-12 overflow-hidden rounded-2xl mb-4 shadow-lg shadow-amber-500/20"><img src={wwmLogo} alt="Wedding Work Manager" className="w-full h-full object-cover" /></div>
        <Loader2 className="w-6 h-6 text-amber-500 animate-spin mb-2" />
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Loading Wedding Work Manager...</p>
      </div>
    );
  }

  // 2. Strict Authentication Protection: If not authenticated, open on Login page
  if (!user || !profile) {
    return <LoginPage />;
  }

  // 3. Authenticated Application Main Layout
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans antialiased transition-colors duration-200">
      {/* Top Navbar */}
      <Navbar
        onOpenSearch={() => setIsSearchOpen(true)}
        onToggleNotificationDrawer={() => {
          setIsNotifDrawerOpen(!isNotifDrawerOpen);
        }}
        onNavigateDashboard={() => setActiveTab('dashboard')}
      />

      {/* Main Container */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        {/* Sidebar */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />

        {/* Content Area */}
        <main className="flex-1 p-3 pb-24 sm:p-6 lg:p-8 min-w-0">
          {/* Mobile hamburger menu button */}
          <div className="min-[1700px]:hidden mb-3.5">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 shadow-2xs font-extrabold text-xs flex items-center gap-2 cursor-pointer min-h-[44px] hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <Menu className="w-5 h-5 text-amber-500" />
              <span>{getPageTitle(activeTab, language)}</span>
            </button>
          </div>

          {/* Module Views */}
          <Suspense
            fallback={
              <div className="min-h-64 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
              </div>
            }
          >
            {activeTab === 'dashboard' && <CompanyTabGuard tab="dashboard"><DashboardModule onNavigate={handleNavigate} onCreateOrder={handleCreateOrder} onOpenTodaysOrders={handleOpenTodaysOrders} onOpenWorkerMovements={handleOpenWorkerMovements} /></CompanyTabGuard>}
            {activeTab === 'orders' && <CompanyTabGuard tab="orders"><OrdersModule createOrderRequest={createOrderRequest} todaysOrdersRequest={todaysOrdersRequest} openOrderId={notificationOrderId} onOrderOpened={() => setNotificationOrderId(undefined)} /></CompanyTabGuard>}
            {activeTab === 'workers' && <CompanyTabGuard tab="workers"><WorkersModule /></CompanyTabGuard>}
            {activeTab === 'workerPerformance' && <CompanyTabGuard tab="workerPerformance"><WorkerPerformanceModule /></CompanyTabGuard>}
            {activeTab === 'workerMovements' && <CompanyTabGuard tab="workerMovements"><WorkerMovementsModule /></CompanyTabGuard>}
            {activeTab === 'customers' && <CompanyTabGuard tab="customers"><CustomersModule /></CompanyTabGuard>}
            {activeTab === 'suppliers' && <CompanyTabGuard tab="suppliers"><SuppliersModule /></CompanyTabGuard>}
            {activeTab === 'inventory' && <CompanyTabGuard tab="inventory"><InventoryModule /></CompanyTabGuard>}
            {activeTab === 'expenses' && <CompanyTabGuard tab="expenses"><ExpensesModule /></CompanyTabGuard>}
            {activeTab === 'calendar' && <CompanyTabGuard tab="calendar"><CalendarModule /></CompanyTabGuard>}
            {activeTab === 'recycleBin' && <CompanyTabGuard tab="recycleBin"><RecycleBinModule /></CompanyTabGuard>}
            {activeTab === 'reports' && <CompanyTabGuard tab="reports"><ReportsModule /></CompanyTabGuard>}
            {activeTab === 'activityLog' && <CompanyTabGuard tab="activityLog"><ActivityLogModule /></CompanyTabGuard>}
            {activeTab === 'settings' && <CompanyTabGuard tab="settings"><SettingsModule /></CompanyTabGuard>}
            {USE_MULTI_TENANT_DATA && !isDemo && activeTab === 'members' && <CompanyTabGuard tab="members"><CompanyMembersModule /></CompanyTabGuard>}
            {USE_MULTI_TENANT_DATA && !isDemo && activeTab === 'profile' && <ProfileModule />}
          </Suspense>
        </main>
      </div>

      {/* Mobile section switcher: visible below the fixed top header while
          scrolling long pages. It is hidden while the sidebar is open so the
          backdrop remains the only active layer. */}
      {showMobileSectionBar && !isSidebarOpen && (
        <div className="fixed inset-x-0 top-14 z-40 border-y border-slate-200/90 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-lg dark:border-slate-700 dark:bg-slate-900/95 sm:top-16 lg:hidden">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            aria-label={`فتح قائمة الأقسام، القسم الحالي: ${getPageTitle(activeTab, language)}`}
            aria-expanded={isSidebarOpen}
            className="mx-auto flex min-h-11 w-full max-w-lg items-center justify-between rounded-xl border border-amber-300/70 bg-amber-50 px-4 text-sm font-extrabold text-slate-800 shadow-sm transition-colors hover:bg-amber-100 active:scale-[0.99] dark:border-amber-800 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <span className="flex items-center gap-2">
              <Menu className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <span>{getPageTitle(activeTab, language)}</span>
            </span>
            <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">تغيير القسم</span>
          </button>
        </div>
      )}

      {/* Modals & Drawers */}
      <GlobalSearchErrorBoundary
        key={isSearchOpen ? 'global-search-open' : 'global-search-closed'}
        onClose={() => setIsSearchOpen(false)}
      >
        <GlobalSearchModal
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          onNavigate={handleNavigate}
        />
      </GlobalSearchErrorBoundary>

      <NotificationDrawer
        isOpen={isNotifDrawerOpen}
        onClose={() => {
          setIsNotifDrawerOpen(false);
        }}
        onNavigate={handleNavigate}
      />

      <MobileManagerNav
        onCreateOrder={handleCreateOrder}
        onOpenTodaysOrders={handleOpenTodaysOrders}
        onOpenWorkerMovements={handleOpenWorkerMovements}
      />

    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <DataProvider>
            <AppContent />
            <PwaInstallPrompt />
            <WorkerPushNotificationsPrompt />
          </DataProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
