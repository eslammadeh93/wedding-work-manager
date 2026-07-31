import React, { useState, useEffect } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';

import { Navbar } from './components/Navbar';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import { NotificationDrawer } from './components/NotificationDrawer';
import { AuthModal } from './components/auth/AuthModal';
import { LoginPage } from './components/auth/LoginPage';

import { DashboardModule } from './components/dashboard/DashboardModule';
import { OrdersModule } from './components/orders/OrdersModule';
import { WorkersModule } from './components/workers/WorkersModule';
import { CustomersModule } from './components/customers/CustomersModule';
import { InventoryModule } from './components/inventory/InventoryModule';
import { ExpensesModule } from './components/expenses/ExpensesModule';
import { CalendarModule } from './components/calendar/CalendarModule';
import { ReportsModule } from './components/reports/ReportsModule';
import { ActivityLogModule } from './components/activityLogs/ActivityLogModule';
import { UsersModule } from './components/users/UsersModule';
import { SettingsModule } from './components/settings/SettingsModule';
import { Menu, Crown, Loader2 } from 'lucide-react';

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
      case 'users':
        return 'المستخدمين';
      case 'settings':
        return 'الإعدادات';
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
      case 'users':
        return 'Users';
      case 'settings':
        return 'Settings';
      default:
        return 'Dashboard';
    }
  }
};

function AppContent() {
  const { user, profile, loading, usersInitialized } = useAuth();
  const { language } = useLanguage();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Set default active tab to dashboard (or orders for workers) when logged in
  useEffect(() => {
    if (user && profile) {
      if (profile.role === 'worker') {
        setActiveTab('orders');
      } else {
        setActiveTab('dashboard');
      }
    }
  }, [user?.uid, profile?.role]);

  // Role guard for current active tab
  useEffect(() => {
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
    } else if (role === 'manager') {
      const restrictedManagerTabs: ActiveTab[] = ['expenses', 'reports', 'activityLog', 'users', 'settings'];
      if (restrictedManagerTabs.includes(activeTab)) {
        setActiveTab('dashboard');
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

  const handleNavigate = (tab: ActiveTab) => {
    setActiveTab(tab);
  };

  // 1. App Startup Loading State
  if (loading || !usersInitialized) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center text-slate-950 mb-4 shadow-lg shadow-amber-500/20">
          <Crown className="w-6 h-6" />
        </div>
        <Loader2 className="w-6 h-6 text-amber-500 animate-spin mb-2" />
        <p className="text-xs font-bold text-slate-400">Loading Wedding Work Manager...</p>
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
        onOpenAuth={() => setIsAuthModalOpen(true)}
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
          {activeTab === 'dashboard' && <DashboardModule onNavigate={handleNavigate} />}
          {activeTab === 'orders' && <OrdersModule />}
          {activeTab === 'workers' && <WorkersModule />}
          {activeTab === 'customers' && <CustomersModule />}
          {activeTab === 'inventory' && <InventoryModule />}
          {activeTab === 'expenses' && <ExpensesModule />}
          {activeTab === 'calendar' && <CalendarModule />}
          {activeTab === 'reports' && <ReportsModule />}
          {activeTab === 'activityLog' && <ActivityLogModule />}
          {activeTab === 'users' && <UsersModule />}
          {activeTab === 'settings' && <SettingsModule />}
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

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
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
