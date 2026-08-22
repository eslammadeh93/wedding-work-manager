import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ActivityLogRecord, AppNotification, CategoryItem, CompanySettings, Customer, Expense, InventoryItem, Order, PaymentEntry, RecycleBinItem, Supplier, Worker, WorkerMovement, WorkTask } from '../../types';
import { DataContext, type DataContextType, type NewCategoryData, type NewOrderCustomer, type NewOrderData, type NewWorkTaskData } from '../../context/DataContext';
import { initialCompanySettings } from '../../data/sampleData';
import { sanitizeData } from '../../utils/security';
import { useAuth } from '../../context/AuthContext';
import { companyDataService, workerOrdersListenerInputReady, type CompanyCollection, type DataOperationResult } from './companyDataService';
import { trustedCompanyIdFromSession } from './useTrustedCompanyId';
import { orderInventoryTransaction } from './orderInventoryTransaction';
import { type Permission } from '../permissions';
import { companyMembersService } from '../companyMembersService';
import { calculateSafeBalanceToDate } from '../../utils/monthlyCash';
import { deletionMetadata, isSoftDeleted, recycleBinItems as buildRecycleBinItems } from '../../utils/recycleBin';

const defaultCategories: CategoryItem[] = [];
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
const failure = (result: DataOperationResult<unknown>) => { throw new Error(result.message || 'تعذر تنفيذ العملية.'); };
const sortCreated = <T extends { createdAt?: string }>(items: T[]) => [...items].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
const archiveEligibleAt = (eventDate?: string) => {
  const value = String(eventDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00`);
  date.setMonth(date.getMonth() + 6);
  return date.toISOString();
};
const operationalWindowStart = () => {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** Isolated company-only provider. It is mounted only while the feature flag is enabled. */
export function MultiTenantDataProvider({ children }: { children: React.ReactNode }) {
  const { authSession, profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]); const [customers, setCustomers] = useState<Customer[]>([]); const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [workTasks, setWorkTasks] = useState<WorkTask[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]); const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]); const [categories, setCategories] = useState<CategoryItem[]>(defaultCategories);
  const [activityLogs, setActivityLogs] = useState<ActivityLogRecord[]>([]); const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [settings, setSettings] = useState<CompanySettings>(initialCompanySettings);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState<string | null>(null); const [retryVersion, setRetryVersion] = useState(0);

  const clear = useCallback(() => { setOrders([]); setWorkTasks([]); setCustomers([]); setSuppliers([]); setWorkers([]); setInventory([]); setExpenses([]); setCategories(defaultCategories); setActivityLogs([]); setNotifications([]); setSettings(initialCompanySettings); }, []);
  useEffect(() => {
    clear(); setLoadError(null);
    let companyId: string;
    try { companyId = trustedCompanyIdFromSession(authSession); } catch (error) { setLoading(false); if (authSession?.userType === 'company') setLoadError(error instanceof Error ? error.message : 'تعذر تحميل البيانات.'); return; }
    setLoading(true); const role = authSession?.role; const workerOnly = role === 'worker'; const workerId = profile?.workerId?.trim() || ''; let remaining = 0; let failed = false;
    const ready = () => { remaining -= 1; if (remaining === 0 && !failed) setLoading(false); };
    const onError = (result: DataOperationResult<never>) => { failed = true; setLoading(false); setLoadError(result.message || 'تعذر تحميل البيانات.'); };
    const allowed = (permission: Permission) => Boolean(authSession?.userType === 'company' && authSession.permissions.includes(permission));
    const listen = <T extends { id: string }>(name: CompanyCollection, set: (items: T[]) => void, equalTo?: { field: string; value: string }) => { remaining += 1; return companyDataService.subscribe<T>(companyId, name, (items) => { set(items); ready(); }, onError, equalTo); };
    const listenLatest = <T extends { id: string }>(name: CompanyCollection, set: (items: T[]) => void, options: { orderByField: string; direction?: 'asc' | 'desc'; pageSize: number; equalTo?: { field: string; value: string }; from?: { field: string; value: string } }) => { remaining += 1; return companyDataService.subscribeLatest<T>(companyId, name, (items) => { set(items); ready(); }, onError, options); };
    const orderListener = workerOnly
      ? (() => {
          let cancelled = false; let unsubscribeRealtime: (() => void) | undefined;
          remaining += 1;
          const workerOrdersInput = { companyId, workerId, session: authSession };
          if (!workerOrdersListenerInputReady(workerOrdersInput)) {
            console.info('[worker-orders] listener not requested: provider prerequisites not ready', {
              companyId: companyId || null,
              workerId: workerId || null,
              sessionPresent: Boolean(authSession),
              sessionUid: authSession?.uid || null,
              sessionRole: authSession?.role || null,
              sessionMemberStatus: authSession?.memberStatus || null,
              constraints: [{ type: 'where', fieldPath: 'workerId', operator: '==', value: workerId }],
              hasWorkerIdEqualityConstraint: true,
            });
            setOrders([]); ready(); return () => { cancelled = true; };
          }
          void companyDataService.loadWorkerOrders<Order>().then(result => {
            if (cancelled) return;
            if (result.success) {
              setOrders(sortCreated((result.data || []).map(order => ({ ...order, customerPhone: '' }))));
              unsubscribeRealtime = companyDataService.subscribeWorkerOrders<Order>(workerOrdersInput, items => setOrders(sortCreated(items)), onError);
            } else {
              onError(result as DataOperationResult<never>);
              console.error('[worker-orders] backend load failed', { code: result.code || 'UNKNOWN_ERROR' });
            }
            ready();
          });
          return () => { cancelled = true; unsubscribeRealtime?.(); };
        })()
      : allowed('company:orders:read')
        ? listenLatest<Order>('orders', setOrders, { orderByField: 'eventDate', direction: 'asc', pageSize: 75, from: { field: 'eventDate', value: operationalWindowStart() } })
        : () => undefined;
    const unsubs = [orderListener];
    if (workerOnly && workerId) unsubs.push(listen<WorkTask>('workTasks', (items) => setWorkTasks(sortCreated(items)), { field: 'workerId', value: workerId }));
    else if (allowed('company:orders:read')) unsubs.push(listen<WorkTask>('workTasks', (items) => setWorkTasks(sortCreated(items))));
    if (allowed('company:customers:read')) unsubs.push(listen<Customer>('customers', setCustomers));
    if (allowed('company:suppliers:read')) unsubs.push(listen<Supplier>('suppliers', (items) => setSuppliers(sortCreated(items))));
    if (allowed('company:workers:read')) unsubs.push(listen<Worker>('workers', (items) => setWorkers(sortCreated(items))));
    if (allowed('company:inventory:read')) unsubs.push(listen<InventoryItem>('inventory', setInventory));
    if (allowed('company:expenses:read')) unsubs.push(listen<Expense>('expenses', (items) => setExpenses(sortCreated(items))));
    if (allowed('company:categories:read')) unsubs.push(listen<CategoryItem>('categories', setCategories));
    if (allowed('company:activity_logs:read')) {
      unsubs.push(listenLatest<ActivityLogRecord>('activityLogs', (items) => {
        setActivityLogs([...items].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))));
      }, { orderByField: 'timestamp', direction: 'desc', pageSize: 100 }));
    }
    // Notifications are private to their recipient, including company owners.
    // Order managers must receive worker arrival/completion reports even when
    // the optional generic-notifications checkbox was not selected for them.
    if ((allowed('company:notifications:read') || allowed('company:orders:read')) && authSession?.uid) unsubs.push(listen<AppNotification>('notifications', setNotifications, { field: 'targetUid', value: authSession.uid }));
    if (allowed('company:settings:read')) { remaining += 1; unsubs.push(companyDataService.subscribeSettings<CompanySettings>(companyId, (value) => { setSettings(value || initialCompanySettings); ready(); }, onError)); }
    if (remaining === 0) setLoading(false);
    return () => { unsubs.forEach((unsubscribe) => unsubscribe()); clear(); };
  }, [authSession, clear, profile?.workerId, retryVersion]);

  const company = useCallback(() => trustedCompanyIdFromSession(authSession), [authSession]);
  const write = useCallback(async <T,>(name: CompanyCollection, id: string, data: T, merge = false) => { const result = await companyDataService.set(company(), name, id, data, merge); if (!result.success) failure(result); return id; }, [company]);
  const remove = useCallback(async (name: CompanyCollection, id: string) => { const result = await companyDataService.remove(company(), name, id); if (!result.success) failure(result); }, [company]);
  const addOrder = useCallback(async (data: NewOrderData, newCustomer?: NewOrderCustomer) => {
    const id = newId('ord'); const customerId = data.customerId || (newCustomer ? newId('cus') : '');
    if (!customerId) throw new Error('يرجى اختيار عميل أو إدخال بيانات عميل جديد.');
    const now = new Date().toISOString(); const companyId = company(); const history = data.paymentHistory || []; const totalPaid = Math.max(data.deposit || 0, history.reduce((sum, entry) => sum + (entry.amount || 0), 0)); const totalPrice = data.totalPrice || 0;
    const eventDate = data.eventDate || data.weddingDate;
    const order: Order = { ...sanitizeData(data), id, companyId, customerId, eventDate, archiveEligibleAt: archiveEligibleAt(eventDate), archivedAt: null, orderSource: data.orderSource || 'other', workerCanContactCustomer: data.workerCanContactCustomer === true, paymentHistory: history, totalPaid, remainingBalance: Math.max(0, totalPrice - totalPaid), paymentStatus: totalPaid >= totalPrice && totalPrice > 0 ? 'fully_paid' : totalPaid > 0 ? 'partially_paid' : 'unpaid', createdAt: now, updatedAt: now };
    const customer: Customer | undefined = newCustomer ? { ...sanitizeData(newCustomer), id: customerId, companyId, orderIds: [id], createdAt: now, updatedAt: now } : undefined;
    const result = await orderInventoryTransaction.create(companyId, order, customer);
    if (!result.success) failure(result);
    return id;
  }, [company]);
  const updateOrder = useCallback(async (id: string, data: Partial<Order>) => {
    let old = orders.find((item) => item.id === id);
    if (!old) {
      const fetched = await companyDataService.get<Order>(company(), 'orders', id);
      if (fetched.success) old = fetched.data;
    }
    if (!old) throw new Error('لم يتم العثور على الطلب.');
    if (authSession?.role === 'worker') throw new Error('لا يُسمح للمنفذ بتعديل الطلب أو حالته.');
    const paymentHistory = data.paymentHistory || old.paymentHistory || [];
    const totalPrice = data.totalPrice ?? old.totalPrice;
    const totalPaid = Math.max(data.deposit ?? old.deposit, paymentHistory.reduce((sum, entry) => sum + (entry.amount || 0), 0));
    const eventDate = data.eventDate || data.weddingDate || old.eventDate || old.weddingDate;
    const result = await orderInventoryTransaction.update(company(), id, { ...sanitizeData(data), eventDate, archiveEligibleAt: archiveEligibleAt(eventDate), paymentHistory, totalPaid, remainingBalance: Math.max(0, totalPrice - totalPaid), paymentStatus: totalPaid >= totalPrice && totalPrice > 0 ? 'fully_paid' : totalPaid > 0 ? 'partially_paid' : 'unpaid', updatedAt: new Date().toISOString() }, old.updatedAt);
    if (!result.success) failure(result);
  }, [authSession?.role, company, orders]);
  const deleteOrder = useCallback(async (id: string) => { const result = await orderInventoryTransaction.remove(company(), id); if (!result.success) failure(result); }, [company]);
  const addWorkTask = useCallback(async (data: NewWorkTaskData) => {
    const id = newId('task'); const now = new Date().toISOString();
    const task: WorkTask = { ...sanitizeData(data), id, companyId: company(), status: 'pending', createdAt: now, updatedAt: now };
    await write('workTasks', id, task); return id;
  }, [company, write]);
  const updateWorkTask = useCallback(async (id: string, data: Partial<WorkTask>) => {
    const existing = workTasks.find((task) => task.id === id);
    if (!existing) throw new Error('لم يتم العثور على المهمة.');
    const workerUpdate = authSession?.role === 'worker';
    if (workerUpdate && existing.workerId !== profile?.workerId) throw new Error('لا يُسمح لك بتعديل هذه المهمة.');
    const changes = workerUpdate ? { status: data.status, completedAt: data.status === 'completed' ? new Date().toISOString() : '' } : sanitizeData(data);
    await write('workTasks', id, { ...changes, updatedAt: new Date().toISOString() }, true);
  }, [authSession?.role, profile?.workerId, workTasks, write]);
  const deleteWorkTask = useCallback(async (id: string) => { if (authSession?.role === 'worker') throw new Error('لا يُسمح للمنفذ بحذف المهمة.'); await remove('workTasks', id); }, [authSession?.role, remove]);
  const addPaymentToOrder = useCallback(async (id: string, payment: Omit<PaymentEntry, 'id'>) => {
    let order = orders.find((item) => item.id === id);
    if (!order) {
      const fetched = await companyDataService.get<Order>(company(), 'orders', id);
      if (fetched.success) order = fetched.data;
    }
    if (!order) throw new Error('لم يتم العثور على الطلب.');
    await updateOrder(id, { paymentHistory: [...(order.paymentHistory || []), { ...payment, id: newId('pay') }] });
  }, [company, orders, updateOrder]);
  const addRecord = useCallback(async <T extends object>(name: CompanyCollection, prefix: string, data: T) => { const id = newId(prefix); await write(name, id, { ...sanitizeData(data), id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); return id; }, [write]);
  const updateRecord = useCallback(async <T extends object>(name: CompanyCollection, id: string, data: T) => write(name, id, { ...sanitizeData(data), updatedAt: new Date().toISOString() }, true), [write]);
  const updateSettings = useCallback(async (data: Partial<CompanySettings>) => { const next = { ...settings, ...sanitizeData(data) }; const result = await companyDataService.setSettings(company(), next); if (!result.success) failure(result); }, [company, settings]);
  const exportBackupJson = useCallback(() => { const companyId = company(); const payload = { version: 1, companyId, exportDate: new Date().toISOString(), settings, customers, suppliers, inventory, orders, expenses, categories }; const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `Company_${companyId}_Backup.json`; link.click(); URL.revokeObjectURL(url); }, [categories, company, customers, expenses, inventory, orders, settings, suppliers]);
  const restoreBackupJson = useCallback(async (json: string) => { try { const parsed = JSON.parse(json); if (parsed.companyId !== company()) throw new Error('ملف النسخة الاحتياطية يخص شركة أخرى.'); throw new Error('استعادة النسخ الاحتياطية للشركات غير متاحة حتى النسخة الآمنة.'); } catch (error) { console.warn(error instanceof Error ? error.message : 'Restore rejected'); return false; } }, [company]);
  const updateWorkerSafe = useCallback(async (id: string, data: Partial<Worker>) => { const result = await companyMembersService.updateWorker({ workerId: id, name: data.fullName, username: data.username, phone: data.phone, jobTitle: data.jobTitle, notes: data.notes }); if (!result.success) throw new Error(result.message); }, []);
  const deleteWorkerSafe = useCallback(async (id: string) => { const result = await companyMembersService.deleteWorker({ workerId: id }); if (!result.success) throw new Error(result.message); }, []);
  const toggleWorkerStatusSafe = useCallback(async (id: string, status: Worker['status']) => { const result = await companyMembersService.setWorkerStatus({ workerId: id, status }); if (!result.success) throw new Error(result.message); }, []);
  const addActivityLogSafe = useCallback(async (data: Omit<ActivityLogRecord, 'id' | 'timestamp'>) => { const action = data.action; if (!['opened', 'arrived', 'finished'].includes(action)) throw new Error('نوع النشاط غير مسموح.'); const result = await companyMembersService.recordOrderActivity({ orderId: data.orderId, action: action as 'opened' | 'arrived' | 'finished' }); if (!result.success) throw new Error(result.message); return ''; }, []);
  const recordWorkerMovementSafe = useCallback(async (orderId: string, action: WorkerMovement['action']) => {
    const result = await companyMembersService.recordWorkerMovement({ companyId: company(), orderId, action });
    if (!result.success || !result.data?.movementId) throw new Error(result.message || 'تعذر تسجيل بلاغ المنفذ.');
    return result.data.movementId;
  }, [company]);
  const markNotificationsSafe = useCallback(async (ids: string[]) => { if (!ids.length) return; const result = await companyMembersService.markNotificationsRead({ notificationIds: ids }); if (!result.success) throw new Error(result.message); }, []);
  const restoreDeletedItem = useCallback(async (item: RecycleBinItem) => {
    if (item.type === 'order') {
      const result = await orderInventoryTransaction.restore(company(), item.id);
      if (!result.success) failure(result);
      return;
    }
    const collection = item.type === 'customer' ? 'customers' : 'inventory';
    await write(collection, item.id, { deletedAt: null, purgeAt: null }, true);
  }, [company, write]);
  const activeOrders = useMemo(() => orders.filter((order) => !isSoftDeleted(order)), [orders]);
  const activeCustomers = useMemo(() => customers.filter((customer) => !isSoftDeleted(customer)), [customers]);
  const activeInventory = useMemo(() => inventory.filter((item) => !isSoftDeleted(item)), [inventory]);
  const deletedItems = useMemo(() => buildRecycleBinItems(orders, customers, inventory), [orders, customers, inventory]);
  const checkStockAvailability = useCallback((items: { inventoryItemId: string; quantity: number }[]) => { const warnings = items.flatMap(({ inventoryItemId, quantity }) => { const item = activeInventory.find((candidate) => candidate.id === inventoryItemId); return item && quantity > item.availableQuantity ? [`الكمية المطلوبة من ${item.nameAr} غير متاحة.`] : []; }); return { available: warnings.length === 0, warnings }; }, [activeInventory]);
  const financialTotals = useMemo(() => {
    const totalCapital = expenses.filter((item) => item.type === 'capital').reduce((sum, item) => sum + (item.amount || 0), 0);
    const totalGeneralExpenses = expenses.filter((item) => item.type !== 'capital').reduce((sum, item) => sum + (item.amount || 0), 0);
    return { totalCapital, totalGeneralExpenses, currentCashBalance: calculateSafeBalanceToDate(activeOrders, expenses) };
  }, [activeOrders, expenses]);
  const addCategory = useCallback(async (data: NewCategoryData) => {
    const key = sanitizeData(data.key).trim().toLowerCase().replace(/\s+/g, '_');
    const nameEn = sanitizeData(data.nameEn).trim(); const nameAr = sanitizeData(data.nameAr).trim();
    if (!key || !nameEn || !nameAr) throw new Error('أدخل مفتاح التصنيف واسمه بالعربية والإنجليزية.');
    const category: CategoryItem = { id: newId('cat'), key, nameEn, nameAr, isCustom: true };
    await write('categories', category.id, category);
    return category;
  }, [write]);
  const value = useMemo<DataContextType>(() => ({ orders: activeOrders, workTasks, customers: activeCustomers, suppliers, workers, inventory: activeInventory, expenses, settings, notifications, categories, activityLogs, loading, recycleBinItems: deletedItems, restoreDeletedItem, ...financialTotals, addOrder, updateOrder, deleteOrder, addPaymentToOrder, addWorkTask, updateWorkTask, deleteWorkTask, addWorker: async () => { throw new Error('إنشاء العامل متاح من قسم العمال فقط.'); }, updateWorker: updateWorkerSafe, deleteWorker: deleteWorkerSafe, toggleWorkerStatus: toggleWorkerStatusSafe, addCustomer: (data) => addRecord('customers', 'cus', data), updateCustomer: (id, data) => updateRecord('customers', id, data), deleteCustomer: (id) => write('customers', id, deletionMetadata(), true), addSupplier: (data) => addRecord('suppliers', 'sup', data), updateSupplier: (id, data) => updateRecord('suppliers', id, data), deleteSupplier: (id) => remove('suppliers', id), addInventoryItem: (data) => addRecord('inventory', 'inv', { ...data, reservedQuantity: 0, availableQuantity: data.quantity }), updateInventoryItem: (id, data) => updateRecord('inventory', id, data), deleteInventoryItem: (id) => write('inventory', id, deletionMetadata(), true), addExpense: (data) => { if (data.linkedOrderId && !activeOrders.some((order) => order.id === data.linkedOrderId)) return Promise.reject(new Error('الطلب المرتبط لا يتبع الشركة الحالية.')); return addRecord('expenses', 'exp', data); }, updateExpense: (id, data) => updateRecord('expenses', id, data), deleteExpense: (id) => remove('expenses', id), addCategory, updateSettings, seedSampleData: async () => { throw new Error('البيانات التجريبية معطلة في وضع الشركات.'); }, exportBackupJson, restoreBackupJson, addActivityLog: addActivityLogSafe, recordWorkerMovement: recordWorkerMovementSafe, markNotificationAsRead: async (id) => markNotificationsSafe([id]), clearAllNotifications: async () => markNotificationsSafe(notifications.filter((item) => !item.read).map((item) => item.id)), checkStockAvailability }), [activeCustomers, activeInventory, activeOrders, activityLogs, addActivityLogSafe, addCategory, addOrder, addPaymentToOrder, addRecord, addWorkTask, categories, checkStockAvailability, deleteOrder, deleteWorkTask, deleteWorkerSafe, deletedItems, expenses, exportBackupJson, financialTotals, loading, markNotificationsSafe, notifications, recordWorkerMovementSafe, remove, restoreBackupJson, restoreDeletedItem, settings, suppliers, toggleWorkerStatusSafe, updateOrder, updateRecord, updateSettings, updateWorkTask, updateWorkerSafe, workTasks, workers, write]);
  return <DataContext.Provider value={value}>{loadError && <div role="alert" dir="rtl" className="fixed z-[100] bottom-4 left-4 max-w-sm rounded-xl bg-red-600 text-white px-4 py-3 shadow-lg text-sm"><p>{loadError}</p><button type="button" className="mt-2 underline font-bold" onClick={() => setRetryVersion((version) => version + 1)}>حاول مرة أخرى</button></div>}{children}</DataContext.Provider>;
}
