import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Search,
  Filter,
  Calendar,
  MapPin,
  Phone,
  Eye,
  Edit,
  Trash2,
  Printer,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  LayoutGrid,
  List,
  Clock,
  CheckCircle2,
  Sparkles,
  ArrowUpDown,
  RotateCcw,
  Wrench,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { Order, OrderStatus, PaymentStatus, WorkerMovement } from '../../types';
import { OrderModal } from './OrderModal';
import { OrderDetailModal } from './OrderDetailModal';
import { OrderInvoicePrint } from './OrderInvoicePrint';
import { localDateString } from '../../utils/localDate';
import { companyDataService } from '../../multiTenant/data/companyDataService';
import { trustedCompanyIdFromSession } from '../../multiTenant/data/useTrustedCompanyId';

type QuickFilterType =
  | 'all'
  | 'todays_bookings'
  | 'todays_events'
  | 'this_weeks_bookings'
  | 'this_weeks_events'
  | 'this_months_bookings'
  | 'this_months_events'
  | 'upcoming_events'
  | 'completed_events';

type SortField = 'bookingDate' | 'eventDate' | 'orderNumber' | 'totalPrice';
type SortOrder = 'asc' | 'desc';

interface OrdersModuleProps {
  createOrderRequest?: number;
  openOrderId?: string;
  onOrderOpened?: () => void;
}

const WorkerMovementIndicators: React.FC<{ companyId: string | null; order: Order }> = ({ companyId, order }) => {
  const [movements, setMovements] = useState<WorkerMovement[]>([]);

  useEffect(() => {
    if (!companyId || !order.workerId) { setMovements([]); return; }
    // Follow the same authoritative nested records used by the order detail
    // screen. This does not rely on optional fields in movement documents.
    return companyDataService.subscribeOrderWorkerMovements<WorkerMovement>(
      companyId,
      order.id,
      order.workerId,
      setMovements,
      () => setMovements([]),
    );
  }, [companyId, order.id, order.workerId]);

  const hasArrived = movements.some(movement => movement.action === 'arrived');
  const hasCompleted = movements.some(movement => movement.action === 'completed');

  return (
    <span className="flex items-center gap-1 me-1" aria-hidden="true">
      <MapPin className={`w-3.5 h-3.5 ${hasArrived ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600 opacity-50'}`} />
      <CheckCircle2 className={`w-3.5 h-3.5 ${hasCompleted ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600 opacity-50'}`} />
    </span>
  );
};

export const OrdersModule: React.FC<OrdersModuleProps> = ({ createOrderRequest = 0, openOrderId, onOrderOpened }) => {
  const { t, language } = useLanguage();
  const { orders, deleteOrder } = useData();
  const { profile, authSession } = useAuth();

  const isWorker = profile?.role === 'worker';
  const workerId = profile?.workerId || '';

  // Search & Basic Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPayment, setSelectedPayment] = useState<string>('all');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('all');
  const [selectedExecutor, setSelectedExecutor] = useState<string>('all');

  const uniqueExecutorsList = useMemo(() => {
    const fromOrders = (orders || []).map((o) => o.executorName).filter(Boolean) as string[];
    let savedStorage: string[] = [];
    try {
      savedStorage = JSON.parse(localStorage.getItem('wedding_saved_executors') || '[]');
    } catch (e) {
      savedStorage = [];
    }
    return Array.from(new Set([...fromOrders, ...savedStorage].map((s) => s.trim()))).filter(Boolean);
  }, [orders]);

  // Quick Filter State
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>('all');

  // Advanced Date Filters State
  const [dateFilterType, setDateFilterType] = useState<'booking' | 'event'>('event');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bookingMonth, setBookingMonth] = useState<string>('all');
  const [eventMonth, setEventMonth] = useState<string>('all');
  const [bookingYear, setBookingYear] = useState<string>('all');
  const [eventYear, setEventYear] = useState<string>('all');

  // View & Sort State
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('grid');
  const [sortField, setSortField] = useState<SortField>('eventDate');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);
  const [printingOrder, setPrintingOrder] = useState<Order | null>(null);

  const managerCompanyId = useMemo(() => {
    if (isWorker || !authSession) return null;
    try { return trustedCompanyIdFromSession(authSession); }
    catch { return null; }
  }, [authSession, isWorker]);

  // Keep an already-open worker modal synchronized with realtime redaction/grant updates.
  useEffect(() => {
    setViewingOrder(current => current ? orders.find(order => order.id === current.id) || null : null);
  }, [orders]);

  useEffect(() => {
    if (!isWorker && createOrderRequest > 0) setIsCreateOpen(true);
    if (isWorker) setIsCreateOpen(false);
  }, [createOrderRequest, isWorker]);

  useEffect(() => {
    if (!openOrderId) return;
    const target = orders.find(order => order.id === openOrderId);
    if (target) { setViewingOrder(target); onOrderOpened?.(); }
  }, [onOrderOpened, openOrderId, orders]);

  // Helper date parsing
  const getBookingDate = (ord: Order) => ord.bookingDate || ord.createdAt.split('T')[0];
  const getEventDate = (ord: Order) => ord.eventDate || ord.weddingDate;

  const todayStr = useMemo(() => localDateString(), []);

  // Reset all filters
  const resetFilters = () => {
    setSearchTerm('');
    setSelectedStatus('all');
    setSelectedPayment('all');
    setSelectedPaymentMethod('all');
    setSelectedExecutor('all');
    setQuickFilter('all');
    setDateFrom('');
    setDateTo('');
    setBookingMonth('all');
    setEventMonth('all');
    setBookingYear('all');
    setEventYear('all');
  };

  // Filter & Sort Logic
  const filteredOrders = useMemo(() => {
    const today = new Date();
    const todayStr = localDateString(today);

    // Helper for week check
    const startOfWeek = new Date(today);
    startOfWeek.setHours(0, 0, 0, 0);
    const day = startOfWeek.getDay();
    startOfWeek.setDate(startOfWeek.getDate() - day);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    return orders
      .filter((ord) => {
        // 0. Worker Role Filter
        if (isWorker) {
          if (workerId) {
            if (ord.workerId !== workerId) return false;
          } else if (profile?.displayName) {
            if (ord.workerName !== profile.displayName && ord.executorName !== profile.displayName) return false;
          }
        }

        const bDate = getBookingDate(ord);
        const eDate = getEventDate(ord);

        // 1. Text Search
        const matchesSearch =
          !searchTerm.trim() ||
          ord.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
          ord.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          ord.eventLocation.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (ord.executorName && ord.executorName.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (ord.customerPhone || '').includes(searchTerm);

        if (!matchesSearch) return false;

        // 2. Status, Payment & Executor
        if (selectedStatus !== 'all' && ord.orderStatus !== selectedStatus) return false;
        if (selectedPayment !== 'all' && ord.paymentStatus !== selectedPayment) return false;
        if (selectedPaymentMethod !== 'all' && ord.paymentMethod !== selectedPaymentMethod) return false;
        if (selectedExecutor !== 'all' && ord.executorName !== selectedExecutor) return false;

        // 3. Quick Filters
        if (quickFilter !== 'all') {
          if (quickFilter === 'todays_bookings' && bDate !== todayStr) return false;
          if (quickFilter === 'todays_events' && eDate !== todayStr) return false;

          if (quickFilter === 'this_weeks_bookings') {
            const bD = new Date(bDate);
            if (bD < startOfWeek || bD > endOfWeek) return false;
          }

          if (quickFilter === 'this_weeks_events') {
            const eD = new Date(eDate);
            if (eD < startOfWeek || eD > endOfWeek) return false;
          }

          if (quickFilter === 'this_months_bookings') {
            const bD = new Date(bDate);
            if (bD.getFullYear() !== today.getFullYear() || bD.getMonth() !== today.getMonth())
              return false;
          }

          if (quickFilter === 'this_months_events') {
            const eD = new Date(eDate);
            if (eD.getFullYear() !== today.getFullYear() || eD.getMonth() !== today.getMonth())
              return false;
          }

          if (quickFilter === 'upcoming_events') {
            if (eDate < todayStr || ord.orderStatus === 'cancelled') return false;
          }

          if (quickFilter === 'completed_events') {
            if (ord.orderStatus !== 'completed' && ord.orderStatus !== 'returned') return false;
          }
        }

        // 4. Booking Month & Year
        if (bookingMonth !== 'all') {
          const bD = new Date(bDate);
          if (bD.getMonth() + 1 !== Number(bookingMonth)) return false;
        }

        if (bookingYear !== 'all') {
          const bD = new Date(bDate);
          if (bD.getFullYear() !== Number(bookingYear)) return false;
        }

        // 5. Event Month & Year
        if (eventMonth !== 'all') {
          const eD = new Date(eDate);
          if (eD.getMonth() + 1 !== Number(eventMonth)) return false;
        }

        if (eventYear !== 'all') {
          const eD = new Date(eDate);
          if (eD.getFullYear() !== Number(eventYear)) return false;
        }

        // 6. Date Range (From - To)
        const targetDate = dateFilterType === 'booking' ? bDate : eDate;
        if (dateFrom && targetDate < dateFrom) return false;
        if (dateTo && targetDate > dateTo) return false;

        return true;
      })
      .sort((a, b) => {
        let valA: string | number = '';
        let valB: string | number = '';

        if (sortField === 'bookingDate') {
          valA = getBookingDate(a);
          valB = getBookingDate(b);
        } else if (sortField === 'eventDate') {
          valA = getEventDate(a);
          valB = getEventDate(b);
        } else if (sortField === 'orderNumber') {
          valA = a.orderNumber;
          valB = b.orderNumber;
        } else if (sortField === 'totalPrice') {
          valA = a.totalPrice;
          valB = b.totalPrice;
        }

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
  }, [
    orders,
    searchTerm,
    selectedStatus,
    selectedPayment,
    selectedPaymentMethod,
    selectedExecutor,
    quickFilter,
    dateFilterType,
    dateFrom,
    dateTo,
    bookingMonth,
    eventMonth,
    bookingYear,
    eventYear,
    sortField,
    sortOrder,
  ]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'pending':
      case 'preparing':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
      case 'confirmed':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300';
      case 'out_for_delivery':
      case 'in_progress':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300';
      case 'completed':
      case 'returned':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
      case 'cancelled':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
    }
  };

  const getPaymentBadge = (payment: PaymentStatus) => {
    switch (payment) {
      case 'unpaid':
        return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800';
      case 'partially_paid':
        return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800';
      case 'fully_paid':
        return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
      default:
        return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    }
  };

  // Quick Filter Badges definitions
  const quickFiltersList: { id: QuickFilterType; labelKey: string }[] = [
    { id: 'all', labelKey: 'all' },
    { id: 'todays_bookings', labelKey: 'todaysBookings' },
    { id: 'todays_events', labelKey: 'todaysEvents' },
    { id: 'this_weeks_bookings', labelKey: 'thisWeeksBookings' },
    { id: 'this_weeks_events', labelKey: 'thisWeeksEvents' },
    { id: 'this_months_bookings', labelKey: 'thisMonthsBookings' },
    { id: 'this_months_events', labelKey: 'thisMonthsEvents' },
    { id: 'upcoming_events', labelKey: 'upcomingEvents' },
    { id: 'completed_events', labelKey: 'statusCompleted' },
  ];

  const monthsList = [
    { value: '1', nameEn: 'January (01)', nameAr: 'يناير (01)' },
    { value: '2', nameEn: 'February (02)', nameAr: 'فبراير (02)' },
    { value: '3', nameEn: 'March (03)', nameAr: 'مارس (03)' },
    { value: '4', nameEn: 'April (04)', nameAr: 'أبريل (04)' },
    { value: '5', nameEn: 'May (05)', nameAr: 'مايو (05)' },
    { value: '6', nameEn: 'June (06)', nameAr: 'يونيو (06)' },
    { value: '7', nameEn: 'July (07)', nameAr: 'يوليو (07)' },
    { value: '8', nameEn: 'August (08)', nameAr: 'أغسطس (08)' },
    { value: '9', nameEn: 'September (09)', nameAr: 'سبتمبر (09)' },
    { value: '10', nameEn: 'October (10)', nameAr: 'أكتوبر (10)' },
    { value: '11', nameEn: 'November (11)', nameAr: 'نوفمبر (11)' },
    { value: '12', nameEn: 'December (12)', nameAr: 'ديسمبر (12)' },
  ];

  const yearsList = ['2024', '2025', '2026', '2027', '2028'];

  const todaysAssignedOrders = useMemo(() => {
    return filteredOrders.filter((ord) => {
      return (ord.deliveryDate || getEventDate(ord)) === todayStr;
    });
  }, [filteredOrders, todayStr]);

  const tomorrowStr = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return localDateString(tomorrow);
  }, []);

  const tomorrowsAssignedOrders = useMemo(
    () => filteredOrders.filter((ord) => (ord.deliveryDate || getEventDate(ord)) === tomorrowStr),
    [filteredOrders, tomorrowStr]
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* WORKER WELCOME BANNER */}
      {isWorker && (
        <div className="p-6 bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-white rounded-3xl shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Wrench className="w-6 h-6" />
                <h3 className="text-2xl font-black">
                  {profile?.workerName || profile?.displayName || 'المنفذ'}
                </h3>
              </div>
              <p className="text-xs sm:text-sm text-amber-100 mt-1 flex items-center gap-1.5 font-medium">
                <Calendar className="w-4 h-4 text-amber-200" />
                <span>
                  {new Date().toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
            <div className="bg-white/20 backdrop-blur-md px-5 py-3 rounded-2xl flex items-center gap-3">
              <ClipboardList className="w-6 h-6 text-white" />
              <div>
                <span className="text-[11px] text-amber-100 font-bold block uppercase">
                  {t('todaysOrders')}
                </span>
                <span className="text-2xl font-black font-mono">
                  {todaysAssignedOrders.length}
                </span>
              </div>
            </div>
            <div className="bg-emerald-600/80 backdrop-blur-md px-5 py-3 rounded-2xl flex items-center gap-3 border border-emerald-300/30">
              <Calendar className="w-6 h-6 text-white" />
              <div>
                <span className="text-[11px] text-emerald-50 font-bold block uppercase">
                  {language === 'ar' ? 'مهام الغد' : "Tomorrow's Tasks"}
                </span>
                <span className="text-2xl font-black font-mono text-white">
                  {tomorrowsAssignedOrders.length}
                </span>
              </div>
            </div>
            </div>
          </div>

          {todaysAssignedOrders.length === 0 && (
            <div className="p-3 bg-black/20 backdrop-blur-sm rounded-xl border border-white/20 text-center text-xs font-bold text-amber-100 flex items-center justify-center gap-2">
              <ClipboardList className="w-4 h-4" />
              <span>{t('noTasksToday')}</span>
            </div>
          )}
        </div>
      )}

      {/* Top Header Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-amber-500" />
            <span>{isWorker ? 'طلباتي' : t('orders')}</span>
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex items-center border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <List className="w-4 h-4" />
              <span className="hidden sm:inline">Table</span>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden sm:inline">Grid</span>
            </button>
          </div>

          {!isWorker && (
            <button
              onClick={() => setIsCreateOpen(true)}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-amber-500/20 transition-all cursor-pointer flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>{t('newOrder')}</span>
            </button>
          )}
        </div>
      </div>

      {/* QUICK FILTERS BAR */}
      <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Quick Filters:</span>
          </span>
          {(quickFilter !== 'all' ||
            searchTerm ||
            selectedStatus !== 'all' ||
            selectedPayment !== 'all' ||
            dateFrom ||
            dateTo ||
            bookingMonth !== 'all' ||
            eventMonth !== 'all') && (
            <button
              onClick={resetFilters}
              className="text-[11px] font-bold text-rose-500 hover:text-rose-600 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Filters</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {quickFiltersList.map((qf) => {
            const isActive = quickFilter === qf.id;
            return (
              <button
                key={qf.id}
                onClick={() => setQuickFilter(qf.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/30'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {t(qf.labelKey) || qf.id}
              </button>
            );
          })}
        </div>
      </div>

      {/* ADVANCED DUAL-DATE SEARCH & FILTERING BAR */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        {/* Row 1: Free Search & Status Dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search Input */}
          <div className="sm:col-span-2 lg:col-span-1 relative">
            <Search className="w-4 h-4 text-slate-400 absolute ltr:left-3.5 rtl:right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={language === 'ar' ? 'بحث بالطلب، العميل، القاعة، المنفذ...' : 'Search by order #, customer, venue, executor...'}
              className="w-full ltr:pl-10 rtl:pr-10 ltr:pr-4 rtl:pl-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Status Select */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
          >
            <option value="all">{t('all')} {t('orderStatus')}</option>
            <option value="new">{t('statusNew')}</option>
            <option value="confirmed">{t('statusConfirmed')}</option>
            <option value="preparing">{t('statusPreparing')}</option>
            <option value="out_for_delivery">{t('statusOutForDelivery')}</option>
            <option value="completed">{t('statusCompleted')}</option>
            <option value="returned">{t('statusReturned')}</option>
            <option value="cancelled">{t('statusCancelled')}</option>
          </select>

          {/* Payment Status Select */}
          <select
            value={selectedPayment}
            onChange={(e) => setSelectedPayment(e.target.value)}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
          >
            <option value="all">{t('all')} {t('paymentStatus')}</option>
            <option value="unpaid">{t('unpaid')}</option>
            <option value="partially_paid">{t('partiallyPaid')}</option>
            <option value="fully_paid">{t('fullyPaid')}</option>
          </select>

          {/* Executor Filter Select */}
          <select
            value={selectedExecutor}
            onChange={(e) => setSelectedExecutor(e.target.value)}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
          >
            <option value="all">{t('allExecutors')}</option>
            {uniqueExecutorsList.map((exec) => (
              <option key={exec} value={exec}>
                {exec}
              </option>
            ))}
          </select>

          {/* Payment Method Select */}
          <select
            value={selectedPaymentMethod}
            onChange={(e) => setSelectedPaymentMethod(e.target.value)}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
          >
            <option value="all">{t('all')} {t('paymentMethod')}</option>
            <option value="InstaPay">InstaPay</option>
            <option value="Cash">Cash</option>
            <option value="E-Wallet">E-Wallet</option>
            <option value="PayPal">PayPal</option>
          </select>
        </div>

        {/* Row 2: Dual-Date System Filters (Month/Year & Date Range) */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {/* Booking Month */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              <Calendar className="w-3.5 h-3.5 inline-block me-1" /> {t('bookingMonth')}
            </label>
            <select
              value={bookingMonth}
              onChange={(e) => setBookingMonth(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="all">{t('all')} Months</option>
              {monthsList.map((m) => (
                <option key={m.value} value={m.value}>
                  {language === 'ar' ? m.nameAr : m.nameEn}
                </option>
              ))}
            </select>
          </div>

          {/* Event Month */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              <Sparkles className="w-3.5 h-3.5 inline-block me-1" /> {t('eventMonth')}
            </label>
            <select
              value={eventMonth}
              onChange={(e) => setEventMonth(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="all">{t('all')} Months</option>
              {monthsList.map((m) => (
                <option key={m.value} value={m.value}>
                  {language === 'ar' ? m.nameAr : m.nameEn}
                </option>
              ))}
            </select>
          </div>

          {/* Booking Year */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              <Calendar className="w-3.5 h-3.5 inline-block me-1" /> {t('bookingYear')}
            </label>
            <select
              value={bookingYear}
              onChange={(e) => setBookingYear(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="all">{t('all')} Years</option>
              {yearsList.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Event Year */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              <Sparkles className="w-3.5 h-3.5 inline-block me-1" /> {t('eventYear')}
            </label>
            <select
              value={eventYear}
              onChange={(e) => setEventYear(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="all">{t('all')} Years</option>
              {yearsList.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range: From */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {t('dateFrom')}
              </label>
              <select
                value={dateFilterType}
                onChange={(e) => setDateFilterType(e.target.value as any)}
                className="text-[10px] font-extrabold text-amber-600 dark:text-amber-400 bg-transparent outline-none cursor-pointer"
              >
                <option value="event">By Event</option>
                <option value="booking">By Booking</option>
              </select>
            </div>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Date Range: To */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
              {t('dateTo')}
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>
      </div>

      {/* Orders Output Count & Sorting summary */}
      <div className="flex items-center justify-between px-1 text-xs text-slate-500">
        <span>
          Showing <strong>{filteredOrders.length}</strong> of {orders.length} orders
        </span>

        <div className="flex items-center gap-2">
          <span>Sort by:</span>
          <button
            onClick={() => toggleSort('bookingDate')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              sortField === 'bookingDate'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Booking Date {sortField === 'bookingDate' && (sortOrder === 'asc' ? '↑' : '↓')}
          </button>
          <button
            onClick={() => toggleSort('eventDate')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              sortField === 'eventDate'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Event Date {sortField === 'eventDate' && (sortOrder === 'asc' ? '↑' : '↓')}
          </button>
        </div>
      </div>

      {/* ORDERS DISPLAY (TABLE vs GRID) */}
      {filteredOrders.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <ClipboardList className="w-12 h-12 mx-auto text-amber-500 opacity-40 mb-3" />
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{t('noData')}</p>
        </div>
      ) : viewMode === 'table' ? (
        /* TABLE VIEW WITH DUAL DATES COLUMNS */
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left rtl:text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-4">{t('orderNumber')}</th>
                  <th className="p-4">{t('customerName')}</th>
                  <th
                    className="p-4 cursor-pointer hover:text-amber-600 transition-colors"
                    onClick={() => toggleSort('bookingDate')}
                  >
                    <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                      <Calendar className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{t('bookingDate')}</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th
                    className="p-4 cursor-pointer hover:text-amber-600 transition-colors"
                    onClick={() => toggleSort('eventDate')}
                  >
                    <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                      <Calendar className="w-3.5 h-3.5 text-amber-500" />
                      <span>{t('eventDate')}</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th className="p-4">{t('eventLocation')}</th>
                  {!isWorker && <th className="p-4">{t('totalPrice')} / {t('remainingBalance')}</th>}
                  <th className="p-4 text-center">{t('status')}</th>
                  <th className="p-4 text-right rtl:text-left">{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {filteredOrders.map((ord) => {
                  const bDate = getBookingDate(ord);
                  const eDate = getEventDate(ord);

                  return (
                    <tr
                      key={ord.id}
                      className="hover:bg-amber-50/30 dark:hover:bg-amber-950/20 transition-colors group"
                    >
                      <td className="p-4 font-mono font-extrabold text-amber-600 dark:text-amber-400">
                        {ord.orderNumber}
                      </td>

                      <td className="p-4 font-bold">
                        <div>{ord.customerName}</div>
                        {(!isWorker || (ord.workerCanContactCustomer === true && Boolean(ord.customerPhone))) && <div className="text-[11px] text-slate-400 font-normal flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3 text-amber-500" />
                          <span>{ord.customerPhone}</span>
                        </div>}
                        {ord.executorName && (
                          <div className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1 mt-1">
                            <Wrench className="w-3 h-3 text-amber-500 shrink-0" />
                            <span>{ord.executorName}</span>
                          </div>
                        )}
                      </td>

                      {/* Booking Date Column */}
                      <td className="p-4 font-semibold text-emerald-800 dark:text-emerald-300">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                          {bDate}
                        </span>
                      </td>

                      {/* Event Date Column */}
                      <td className="p-4 font-semibold text-amber-800 dark:text-amber-300">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg">
                          {eDate}
                        </span>
                      </td>

                      <td className="p-4 max-w-xs truncate text-slate-600 dark:text-slate-300">
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1 truncate">
                            <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                            <span className="truncate">{ord.eventLocation}</span>
                          </div>
                          {ord.locationLink?.trim() && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const url = ord.locationLink!.trim().startsWith('http')
                                  ? ord.locationLink!.trim()
                                  : `https://${ord.locationLink!.trim()}`;
                                window.open(url, '_blank');
                              }}
                              className="p-1 text-amber-600 hover:text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg transition-colors shrink-0 cursor-pointer"
                              title={t('openLocation')}
                            >
                              <MapPin className="w-4 h-4 text-amber-500 fill-amber-500/20" />
                            </button>
                          )}
                        </div>
                      </td>

                      {!isWorker && (
                        <td className="p-4 font-bold">
                          <div>${ord.totalPrice.toLocaleString()}</div>
                          {ord.remainingBalance > 0 ? (
                            <div className="text-[11px] text-rose-600 dark:text-rose-400 font-bold">
                              ${ord.remainingBalance.toLocaleString()} due
                            </div>
                          ) : (
                            <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold">
                              Fully Paid
                            </div>
                          )}
                        </td>
                      )}

                      <td className="p-4 text-center">
                        <span
                          className={`px-2.5 py-1 text-[10px] font-extrabold uppercase rounded-full ${getStatusBadge(
                            ord.orderStatus
                          )}`}
                        >
                          {ord.orderStatus}
                        </span>
                      </td>

                      <td className="p-4 text-right rtl:text-left">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setViewingOrder(ord)}
                            className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg transition-colors"
                            title={t('view')}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {!isWorker && (
                            <>
                              <button
                                onClick={() => setPrintingOrder(ord)}
                                className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg transition-colors"
                                title={t('print')}
                              >
                                <Printer className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setEditingOrder(ord)}
                                className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg transition-colors"
                                title={t('edit')}
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={async () => {
                                  if (window.confirm(t('confirmDelete'))) {
                                    await deleteOrder(ord.id);
                                  }
                                }}
                                className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors"
                                title={t('delete')}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* GRID VIEW WITH DUAL DATES BADGES */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrders.map((ord) => {
            const bDate = getBookingDate(ord);
            const eDate = getEventDate(ord);

            return (
              <div
                key={ord.id}
                className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
              >
                <div>
                  {/* Header row */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="font-extrabold text-base text-amber-600 dark:text-amber-400">
                      {ord.orderNumber}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 text-[10px] font-extrabold uppercase rounded-full ${getStatusBadge(
                        ord.orderStatus
                      )}`}
                    >
                      {ord.orderStatus}
                    </span>
                  </div>

                  {/* Customer info */}
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-amber-600 transition-colors">
                    {ord.customerName}
                  </h3>
                  {(!isWorker || (ord.workerCanContactCustomer === true && Boolean(ord.customerPhone))) && <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                    <Phone className="w-3.5 h-3.5 text-amber-500" />
                    <span>{ord.customerPhone}</span>
                  </p>}

                  {/* Dual Dates Box */}
                  <div className="mt-3 p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl space-y-1.5 border border-slate-100 dark:border-slate-700/50">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-emerald-500" />
                        {t('bookingDate')}:
                      </span>
                      <strong className="text-emerald-700 dark:text-emerald-300 font-semibold">
                        {bDate}
                      </strong>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-amber-500" />
                        {isWorker ? (language === 'ar' ? 'تاريخ التركيب:' : 'Setup Date:') : `${t('eventDate')}:`}
                      </span>
                      <strong className={isWorker ? 'premium-gold font-bold' : 'text-amber-700 dark:text-amber-300 font-semibold'}>
                        {isWorker ? (ord.deliveryDate || eDate) : eDate}
                      </strong>
                    </div>
                  </div>

                  {/* Event venue */}
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-700 dark:text-slate-200 font-medium">
                    <p className="flex items-center gap-1.5 truncate">
                      <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      <span className="truncate">{ord.eventLocation}</span>
                    </p>
                    {ord.locationLink?.trim() && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = ord.locationLink!.trim().startsWith('http')
                            ? ord.locationLink!.trim()
                            : `https://${ord.locationLink!.trim()}`;
                          window.open(url, '_blank');
                        }}
                        className="p-1 text-amber-600 hover:text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg transition-colors shrink-0 flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                        title={t('openLocation')}
                      >
                        <MapPin className="w-3.5 h-3.5 text-amber-500 fill-amber-500/20 shrink-0" />
                        <span>{t('openLocation')}</span>
                      </button>
                    )}
                  </div>

                  {/* Executor */}
                  {ord.executorName && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-semibold">
                      <Wrench className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>{t('executor')}: {ord.executorName}</span>
                    </p>
                  )}
                </div>

                {/* Financials & Action Buttons */}
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  {!isWorker ? (
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                        {t('totalPrice')} / {t('remainingBalance')}
                      </span>
                      <div className="flex items-baseline gap-1.5 mt-0.5">
                        <span className="font-extrabold text-slate-900 dark:text-white text-base">
                          ${ord.totalPrice.toLocaleString()}
                        </span>
                        {ord.remainingBalance > 0 && (
                          <span className="text-xs font-bold text-rose-600 dark:text-rose-400">
                            (${ord.remainingBalance.toLocaleString()} due)
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 font-semibold">تفاصيل الطلب</div>
                  )}

                  <div className="flex items-center gap-1">
                    {!isWorker && (
                      <WorkerMovementIndicators companyId={managerCompanyId} order={ord} />
                    )}
                    <button
                      onClick={() => setViewingOrder(ord)}
                      className="p-2 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-xl transition-colors cursor-pointer"
                      title={t('view')}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {!isWorker && (
                      <>
                        <button
                          onClick={() => setPrintingOrder(ord)}
                          className="p-2 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-xl transition-colors cursor-pointer"
                          title={t('print')}
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingOrder(ord)}
                          className="p-2 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-xl transition-colors cursor-pointer"
                          title={t('edit')}
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {isCreateOpen && !isWorker && (
        <OrderModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      )}

      {/* Edit Modal */}
      {editingOrder && (
        <OrderModal
          isOpen={!!editingOrder}
          initialOrder={editingOrder}
          onClose={() => setEditingOrder(null)}
        />
      )}

      {/* Detail Modal */}
      {viewingOrder && (
        <OrderDetailModal
          order={viewingOrder}
          onClose={() => setViewingOrder(null)}
          onEdit={(ord) => {
            setViewingOrder(null);
            setEditingOrder(ord);
          }}
          onPrint={(ord) => {
            setViewingOrder(null);
            setPrintingOrder(ord);
          }}
        />
      )}

      {/* Print Contract Modal */}
      {printingOrder && (
        <OrderInvoicePrint
          order={printingOrder}
          onClose={() => setPrintingOrder(null)}
        />
      )}
    </div>
  );
};
