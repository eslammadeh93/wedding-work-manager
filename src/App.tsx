import React, { useState, useEffect, Suspense, lazy } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { USE_MULTI_TENANT_DATA } from './multiTenant/featureFlags';
import { CompanySessionRouteGuard, PlatformRouteGuard } from './multiTenant/RouteGuards';
import { PlatformErrorBoundary } from './multiTenant/platform/PlatformErrorBoundary';

import { Navbar } from './components/Navbar';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import { NotificationDrawer } from './components/NotificationDrawer';
import { LoginPage } from './components/auth/LoginPage';

import { Menu, Crown, Loader2 } from 'lucide-react';

// Load each workspace only when it is opened. This keeps PDF/Excel and other
// heavy feature code out of the application's initial download.
const DashboardModule = lazy(() => import('./components/dashboard/DashboardModule').then(({ DashboardModule }) => ({ default: DashboardModule })));
const OrdersModule = lazy(() => import('./components/orders/OrdersModule').then(({ OrdersModule }) => ({ default: OrdersModule })));
const WorkersModule = lazy(() => import('./components/workers/WorkersModule').then(({ WorkersModule }) => ({ default: WorkersModule })));
const CustomersModule = lazy(() => import('./components/customers/CustomersModule').then(({ CustomersModule }) => ({ default: CustomersModule })));
const InventoryModule = lazy(() => import('./components/inventory/InventoryModule').then(({ InventoryModule }) => ({ default: InventoryModule })));
const ExpensesModule = lazy(() => import('./components/expenses/ExpensesModule').then(({ ExpensesModule }) => ({ default: ExpensesModule })));
const CalendarModule = lazy(() => import('./components/calendar/CalendarModule').then(({ CalendarModule }) => ({ default: CalendarModule })));
const ReportsModule = lazy(() => import('./components/reports/ReportsModule').then(({ ReportsModule }) => ({ default: ReportsModule })));
const ActivityLogModule = lazy(() => import('./components/activityLogs/ActivityLogModule').then(({ ActivityLogModule }) => ({ default: ActivityLogModule })));
const SettingsModule = lazy(() => import('./components/settings/SettingsModule').then(({ SettingsModule }) => ({ default: SettingsModule })));
const PlatformModule = lazy(() => import('./multiTenant/platform/PlatformModule').then(({ PlatformModule }) => ({ default: PlatformModule })));
const CompanyMembersModule = lazy(() => import('./components/company/CompanyMembersModule').then(({ CompanyMembersModule }) => ({ default: CompanyMembersModule })));
const ProfileModule = lazy(() => import('./components/profile/ProfileModule').then(({ ProfileModule }) => ({ default: ProfileModule })));

function UnauthorizedPlatform() {
  return <div dir="rtl" className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6 text-center"><div><Crown className="w-10 h-10 text-amber-500 mx-auto mb-3" /><h1 className="font-black text-xl">غير مصرح لك بالدخول</h1><p className="text-sm text-slate-500 mt-2">هذه الصفحة متاحة لصاحب المنصة فقط.</p></div></div>;
}

function UnauthorizedCompanyMembers() {
  return <div dir="rtl" className="min-h-64 flex items-center justify-center text-center"><div><Crown className="w-10 h-10 text-amber-500 mx-auto mb-3" /><h1 className="font-black text-xl">غير مصرح لك بالدخول</h1><p className="text-sm text-slate-500 mt-2">هذه الصفحة متاحة لصاحب الشركة والمديرين فقط.</p></div></div>;
}

/** Kept outside the legacy tree so platform code is only requested after verification. */
function PlatformEntry() {
  const { user, authSession, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 text-amber-500 animate-spin" /></div>;
  if (!user || authSession?.userType !== 'platform' || authSession.role !== 'platform_owner') return <UnauthorizedPlatform />;
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
      case 'customers':
        return 'العملاء';
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
        return 'إدارة المديرين';
      case 'profile':
        return 'الملف الشخصي';
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
      case 'customers':
        return 'Customers';
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
        return 'Managers';
      case 'profile':
        return 'Profile';
      default:
        return 'Dashboard';
    }
  }
};

function AppContent() {
  const { user, profile, authSession, loading, usersInitialized } = useAuth();
  const { language } = useLanguage();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
  const [createOrderRequest, setCreateOrderRequest] = useState(0);

  // Set default active tab to dashboard (or orders for workers) when logged in
  useEffect(() => {
    if (user && profile) {
      setCreateOrderRequest(0);
      if (profile.role === 'worker') {
        setActiveTab('orders');
      } else {
        setActiveTab('dashboard');
      }
    }
  }, [user?.uid, profile?.role]);

  // A dashboard "create order" request is a one-shot signal. Clear it as
  // soon as Orders is left so reopening the section never reopens the modal.
  useEffect(() => {
    if (activeTab !== 'orders') setCreateOrderRequest(0);
  }, [activeTab]);

  // Role guard for current active tab
  useEffect(() => {
    // The member screen performs its own AuthSession permission guard so a
    // direct /company/members visit can show Unauthorized rather than redirect.
    if (USE_MULTI_TENANT_DATA && activeTab === 'members') return;
    const role = profile?.role || 'employee';
    if (role === 'worker') {
      if (activeTab !== 'orders') {
        setActiveTab('orders');
      }
    } else if (role === 'employee') {
      const allowedEmployeeTabs: ActiveTab[] = ['orders', 'customers', 'calendar'];
      if (!allowedEmployeeTabs.includes(activeTab)) {
        setActiveTab('orders');
      }
    }
  }, [profile?.role, activeTab]);

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

  // With the flag off this branch is never selected: no platform module,
  // routes, navigation, or queries are activated in the legacy application.
  if (USE_MULTI_TENANT_DATA && authSession?.userType === 'platform') {
    return <PlatformEntry />;
  }

  const handleNavigate = (tab: ActiveTab) => {
    setActiveTab(tab);
  };

  const handleCreateOrder = () => {
    setActiveTab('orders');
    setCreateOrderRequest((request) => request + 1);
  };

  // 1. App Startup Loading State
  if (loading || !usersInitialized) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-4 transition-colors">
        <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center text-slate-950 mb-4 shadow-lg shadow-amber-500/20">
          <Crown className="w-6 h-6" />
        </div>
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
        onToggleNotificationDrawer={() => setIsNotifDrawerOpen(!isNotifDrawerOpen)}
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
        <main className="flex-1 p-3 sm:p-6 lg:p-8 min-w-0">
          {/* Mobile hamburger menu button */}
          <div className="lg:hidden mb-3.5">
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
            {activeTab === 'dashboard' && <DashboardModule onNavigate={handleNavigate} onCreateOrder={handleCreateOrder} />}
            {activeTab === 'orders' && <OrdersModule createOrderRequest={createOrderRequest} />}
            {activeTab === 'workers' && <WorkersModule />}
            {activeTab === 'customers' && <CustomersModule />}
            {activeTab === 'inventory' && <InventoryModule />}
            {activeTab === 'expenses' && (USE_MULTI_TENANT_DATA ? <CompanySessionRouteGuard roles={['company_super_admin']} permission="company:expenses:read"><ExpensesModule /></CompanySessionRouteGuard> : <ExpensesModule />)}
            {activeTab === 'calendar' && <CalendarModule />}
            {activeTab === 'reports' && <ReportsModule />}
            {activeTab === 'activityLog' && <ActivityLogModule />}
            {activeTab === 'settings' && <SettingsModule />}
            {USE_MULTI_TENANT_DATA && activeTab === 'members' && <CompanySessionRouteGuard permission="company:members:read" fallback={<UnauthorizedCompanyMembers />}><CompanyMembersModule /></CompanySessionRouteGuard>}
            {USE_MULTI_TENANT_DATA && activeTab === 'profile' && <ProfileModule />}
          </Suspense>
        </main>
      </div>

      {/* Modals & Drawers */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigate={handleNavigate}
      />

      <NotificationDrawer
        isOpen={isNotifDrawerOpen}
        onClose={() => setIsNotifDrawerOpen(false)}
        onNavigate={handleNavigate}
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
          </DataProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
