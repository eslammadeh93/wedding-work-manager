import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ActivityLogRecord, AppNotification, CategoryItem, CompanySettings, Customer, Expense, InventoryItem, Order, PaymentEntry, RecycleBinItem, Supplier, Worker, WorkerMovement, WorkTask } from '../types';
import { DataContext, type DataContextType, type NewCategoryData, type NewOrderCustomer, type NewOrderData, type NewWorkTaskData } from '../context/DataContext';
import { sanitizeData } from '../utils/security';
import { calculateSafeBalanceToDate } from '../utils/monthlyCash';
import { deletionMetadata, isSoftDeleted, recycleBinItems as buildRecycleBinItems } from '../utils/recycleBin';
import { createDemoStore, type DemoStore } from './demoData';

const DEMO_DATA_KEY = 'wwm_demo_workspace_v1';
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const load = (): DemoStore => {
  try {
    const value = localStorage.getItem(DEMO_DATA_KEY);
    if (value) return JSON.parse(value) as DemoStore;
  } catch { /* A blocked cache simply starts with a fresh demo. */ }
  return createDemoStore();
};

interface DemoModeValue { isDemo: boolean; resetDemo: () => void; }
const DemoModeContext = createContext<DemoModeValue>({ isDemo: false, resetDemo: () => undefined });
export const useDemoMode = () => useContext(DemoModeContext);

/** Local-only data provider. It contains no Firebase imports or network writes. */
export function DemoDataProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<DemoStore>(load);
  useEffect(() => {
    try { localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(store)); } catch { /* keep the in-memory demo usable */ }
  }, [store]);
  const resetDemo = useCallback(() => {
    const next = createDemoStore();
    try { localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(next)); } catch { /* state still resets */ }
    setStore(next);
  }, []);
  const update = useCallback((recipe: (current: DemoStore) => DemoStore) => setStore(current => recipe(current)), []);
  const activeOrders = useMemo(() => store.orders.filter(item => !isSoftDeleted(item)), [store.orders]);
  const activeCustomers = useMemo(() => store.customers.filter(item => !isSoftDeleted(item)), [store.customers]);
  const activeInventory = useMemo(() => store.inventory.filter(item => !isSoftDeleted(item)), [store.inventory]);
  const recycleBinItems = useMemo(() => buildRecycleBinItems(store.orders, store.customers, store.inventory), [store]);
  const totals = useMemo(() => ({
    totalCapital: store.expenses.filter(item => item.type === 'capital').reduce((sum, item) => sum + (item.amount || 0), 0),
    totalGeneralExpenses: store.expenses.filter(item => item.type !== 'capital').reduce((sum, item) => sum + (item.amount || 0), 0),
    currentCashBalance: calculateSafeBalanceToDate(activeOrders, store.expenses),
  }), [activeOrders, store.expenses]);
  const addOrder = useCallback(async (data: NewOrderData, newCustomer?: NewOrderCustomer) => {
    const customerId = data.customerId || (newCustomer ? newId('demo_customer') : '');
    if (!customerId) throw new Error('يرجى اختيار عميل أو إدخال بيانات عميل جديد.');
    const now = new Date().toISOString(); const id = newId('demo_order'); const paymentHistory = data.paymentHistory || [];
    const totalPrice = data.totalPrice || 0; const totalPaid = Math.max(data.deposit || 0, paymentHistory.reduce((sum, payment) => sum + (payment.amount || 0), 0));
    const order: Order = { ...(sanitizeData(data) as NewOrderData), id, customerId, eventDate: data.eventDate || data.weddingDate, totalPaid, remainingBalance: Math.max(0, totalPrice - totalPaid), paymentStatus: totalPaid >= totalPrice && totalPrice > 0 ? 'fully_paid' : totalPaid > 0 ? 'partially_paid' : 'unpaid', paymentHistory, createdAt: now, updatedAt: now };
    const customer: Customer | null = newCustomer ? { ...(sanitizeData(newCustomer) as NewOrderCustomer), id: customerId, orderIds: [id], createdAt: now, updatedAt: now } : null;
    update(current => ({ ...current, orders: [order, ...current.orders], customers: customer ? [customer, ...current.customers] : current.customers.map(item => item.id === customerId ? { ...item, orderIds: [...(item.orderIds || []), id], updatedAt: now } : item) }));
    return id;
  }, [update]);
  const updateOrder = useCallback(async (id: string, data: Partial<Order>) => {
    const original = store.orders.find(item => item.id === id); if (!original) throw new Error('لم يتم العثور على الطلب.');
    const paymentHistory = data.paymentHistory || original.paymentHistory || []; const totalPrice = data.totalPrice ?? original.totalPrice;
    const totalPaid = Math.max(data.deposit ?? original.deposit, paymentHistory.reduce((sum, payment) => sum + (payment.amount || 0), 0));
    const patch: Partial<Order> = { ...(sanitizeData(data) as Partial<Order>), eventDate: data.eventDate || data.weddingDate || original.eventDate || original.weddingDate, paymentHistory, totalPaid, remainingBalance: Math.max(0, totalPrice - totalPaid), paymentStatus: totalPaid >= totalPrice && totalPrice > 0 ? 'fully_paid' : totalPaid > 0 ? 'partially_paid' : 'unpaid', updatedAt: new Date().toISOString() };
    update(current => ({ ...current, orders: current.orders.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }, [store.orders, update]);
  const deleteOrder = useCallback(async (id: string) => update(current => ({ ...current, orders: current.orders.map(item => item.id === id ? { ...item, ...deletionMetadata(), updatedAt: new Date().toISOString() } : item) })), [update]);
  const addPaymentToOrder = useCallback(async (id: string, payment: Omit<PaymentEntry, 'id'>) => { const order = store.orders.find(item => item.id === id); if (!order) throw new Error('لم يتم العثور على الطلب.'); await updateOrder(id, { paymentHistory: [...(order.paymentHistory || []), { ...payment, id: newId('demo_payment') }] }); }, [store.orders, updateOrder]);
  const addWorkTask = useCallback(async (data: NewWorkTaskData) => { const now = new Date().toISOString(); const task: WorkTask = { ...(sanitizeData(data) as NewWorkTaskData), id: newId('demo_task'), status: 'pending', createdAt: now, updatedAt: now }; update(current => ({ ...current, workTasks: [task, ...current.workTasks] })); return task.id; }, [update]);
  const updateWorkTask = useCallback(async (id: string, data: Partial<WorkTask>) => update(current => ({ ...current, workTasks: current.workTasks.map(item => item.id === id ? { ...item, ...(sanitizeData(data) as Partial<WorkTask>), updatedAt: new Date().toISOString(), completedAt: data.status === 'completed' ? new Date().toISOString() : item.completedAt } : item) })), [update]);
  const deleteWorkTask = useCallback(async (id: string) => update(current => ({ ...current, workTasks: current.workTasks.filter(item => item.id !== id) })), [update]);
  const addRecord = useCallback(async <T extends object>(key: 'customers' | 'suppliers' | 'inventory' | 'expenses', prefix: string, data: T) => { const id = newId(prefix); const now = new Date().toISOString(); update(current => ({ ...current, [key]: [{ ...(sanitizeData(data) as object), id, createdAt: now, updatedAt: now }, ...current[key]] } as DemoStore)); return id; }, [update]);
  const updateRecord = useCallback(async <T extends object>(key: 'customers' | 'suppliers' | 'inventory' | 'expenses', id: string, data: T) => update(current => ({ ...current, [key]: current[key].map((item: { id: string }) => item.id === id ? { ...item, ...(sanitizeData(data) as object), updatedAt: new Date().toISOString() } : item) } as DemoStore)), [update]);
  const addWorker = useCallback(async (data: Omit<Worker, 'id' | 'createdAt' | 'updatedAt'>) => { const now = new Date().toISOString(); const worker: Worker = { ...(sanitizeData(data) as Omit<Worker, 'id' | 'createdAt' | 'updatedAt'>), id: newId('demo_worker'), createdAt: now, updatedAt: now }; update(current => ({ ...current, workers: [worker, ...current.workers] })); return worker.id; }, [update]);
  const updateWorker = useCallback(async (id: string, data: Partial<Worker>) => update(current => ({ ...current, workers: current.workers.map(item => item.id === id ? { ...item, ...(sanitizeData(data) as Partial<Worker>), updatedAt: new Date().toISOString() } : item) })), [update]);
  const addCategory = useCallback(async (data: NewCategoryData) => { const category: CategoryItem = { id: newId('demo_category'), key: data.key.trim().toLowerCase().replace(/\s+/g, '_'), nameAr: data.nameAr.trim(), nameEn: data.nameEn.trim(), isCustom: true }; if (!category.key || !category.nameAr || !category.nameEn) throw new Error('أدخل مفتاح التصنيف واسمه بالعربية والإنجليزية.'); update(current => ({ ...current, categories: [category, ...current.categories] })); return category; }, [update]);
  const addActivityLog = useCallback(async (data: Omit<ActivityLogRecord, 'id' | 'timestamp'>) => { const id = newId('demo_log'); const log: ActivityLogRecord = { ...data, id, logId: id, timestamp: new Date().toISOString() }; update(current => ({ ...current, activityLogs: [log, ...current.activityLogs] })); return id; }, [update]);
  const restoreDeletedItem = useCallback(async (item: RecycleBinItem) => { const key = item.type === 'order' ? 'orders' : item.type === 'customer' ? 'customers' : 'inventory'; update(current => ({ ...current, [key]: current[key].map((record: { id: string }) => record.id === item.id ? { ...record, deletedAt: null, purgeAt: null, updatedAt: new Date().toISOString() } : record) } as DemoStore)); }, [update]);
  const exportBackupJson = useCallback(() => { const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'Wedding_Manager_Demo_Backup.json'; link.click(); URL.revokeObjectURL(url); }, [store]);
  const restoreBackupJson = useCallback(async (json: string) => { try { const parsed = JSON.parse(json) as DemoStore; if (!Array.isArray(parsed.orders) || !Array.isArray(parsed.customers) || !parsed.settings) return false; setStore(clone(parsed)); return true; } catch { return false; } }, []);
  const value = useMemo<DataContextType>(() => ({
    orders: activeOrders, workTasks: store.workTasks, customers: activeCustomers, suppliers: store.suppliers, inventory: activeInventory, expenses: store.expenses, workers: store.workers, settings: store.settings, notifications: store.notifications, categories: store.categories, activityLogs: store.activityLogs, loading: false, recycleBinItems, ...totals,
    addOrder, updateOrder, deleteOrder, addPaymentToOrder, addWorkTask, updateWorkTask, deleteWorkTask, addWorker, updateWorker, deleteWorker: async (id) => update(current => ({ ...current, workers: current.workers.filter(item => item.id !== id) })), toggleWorkerStatus: async (id, status) => updateWorker(id, { status }),
    addCustomer: data => addRecord('customers', 'demo_customer', data), updateCustomer: (id, data) => updateRecord('customers', id, data), deleteCustomer: async id => update(current => ({ ...current, customers: current.customers.map(item => item.id === id ? { ...item, ...deletionMetadata(), updatedAt: new Date().toISOString() } : item) })),
    addSupplier: data => addRecord('suppliers', 'demo_supplier', data), updateSupplier: (id, data) => updateRecord('suppliers', id, data), deleteSupplier: async id => update(current => ({ ...current, suppliers: current.suppliers.filter(item => item.id !== id) })),
    addInventoryItem: data => addRecord('inventory', 'demo_inventory', { ...data, reservedQuantity: 0, availableQuantity: data.quantity }), updateInventoryItem: (id, data) => updateRecord('inventory', id, data), deleteInventoryItem: async id => update(current => ({ ...current, inventory: current.inventory.map(item => item.id === id ? { ...item, ...deletionMetadata(), updatedAt: new Date().toISOString() } : item) })),
    addExpense: data => addRecord('expenses', 'demo_expense', data), updateExpense: (id, data) => updateRecord('expenses', id, data), deleteExpense: async id => update(current => ({ ...current, expenses: current.expenses.filter(item => item.id !== id) })),
    addCategory, updateSettings: async (data: Partial<CompanySettings>) => update(current => ({ ...current, settings: { ...current.settings, ...(sanitizeData(data) as Partial<CompanySettings>) } })), seedSampleData: async () => resetDemo(), exportBackupJson, restoreBackupJson, addActivityLog, recordWorkerMovement: async (orderId: string, action: WorkerMovement['action']) => { const order = store.orders.find(item => item.id === orderId); if (!order) throw new Error('لم يتم العثور على الطلب.'); return addActivityLog({ orderId, orderNumber: order.orderNumber, workerId: order.workerId || 'demo_worker', workerName: order.workerName || 'مستخدم تجريبي', action: action === 'arrived' ? 'arrived' : 'finished', actionText: action === 'arrived' ? 'تم الوصول للموقع' : 'تم إنهاء العمل', customerName: order.customerName, eventDate: order.eventDate || order.weddingDate }); },
    markNotificationAsRead: id => update(current => ({ ...current, notifications: current.notifications.map(item => item.id === id ? { ...item, read: true } : item) })), clearAllNotifications: () => update(current => ({ ...current, notifications: current.notifications.map(item => ({ ...item, read: true })) })), checkStockAvailability: items => { const warnings = items.flatMap(({ inventoryItemId, quantity }) => { const item = activeInventory.find(candidate => candidate.id === inventoryItemId); return item && quantity > item.availableQuantity ? [`الكمية المطلوبة من ${item.nameAr} غير متاحة.`] : []; }); return { available: warnings.length === 0, warnings }; }, restoreDeletedItem,
  }), [activeCustomers, activeInventory, activeOrders, addActivityLog, addCategory, addOrder, addPaymentToOrder, addRecord, addWorkTask, exportBackupJson, recycleBinItems, restoreBackupJson, restoreDeletedItem, store, totals, update, updateOrder, updateRecord, updateWorkTask, updateWorker]);
  return <DemoModeContext.Provider value={{ isDemo: true, resetDemo }}><DataContext.Provider value={value}>{children}</DataContext.Provider></DemoModeContext.Provider>;
}
