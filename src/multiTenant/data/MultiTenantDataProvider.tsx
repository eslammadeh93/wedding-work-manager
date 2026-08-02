import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ActivityLogRecord, AppNotification, CategoryItem, CompanySettings, Customer, Expense, InventoryItem, Order, PaymentEntry, Worker } from '../../types';
import { DataContext, type DataContextType } from '../../context/DataContext';
import { initialCompanySettings } from '../../data/sampleData';
import { sanitizeData } from '../../utils/security';
import { useAuth } from '../../context/AuthContext';
import { companyDataService, type CompanyCollection, type DataOperationResult } from './companyDataService';
import { trustedCompanyIdFromSession } from './useTrustedCompanyId';
import { orderInventoryTransaction } from './orderInventoryTransaction';

const defaultCategories: CategoryItem[] = [];
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
const failure = (result: DataOperationResult<unknown>) => { throw new Error(result.message || 'تعذر تنفيذ العملية.'); };
const sortCreated = <T extends { createdAt?: string }>(items: T[]) => [...items].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

/** Isolated company-only provider. It is mounted only while the feature flag is enabled. */
export function MultiTenantDataProvider({ children }: { children: React.ReactNode }) {
  const { authSession, profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]); const [customers, setCustomers] = useState<Customer[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]); const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]); const [categories, setCategories] = useState<CategoryItem[]>(defaultCategories);
  const [activityLogs, setActivityLogs] = useState<ActivityLogRecord[]>([]); const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [settings, setSettings] = useState<CompanySettings>(initialCompanySettings);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState<string | null>(null); const [retryVersion, setRetryVersion] = useState(0);

  const clear = useCallback(() => { setOrders([]); setCustomers([]); setWorkers([]); setInventory([]); setExpenses([]); setCategories(defaultCategories); setActivityLogs([]); setNotifications([]); setSettings(initialCompanySettings); }, []);
  useEffect(() => {
    clear(); setLoadError(null);
    let companyId: string;
    try { companyId = trustedCompanyIdFromSession(authSession); } catch (error) { setLoading(false); if (authSession?.userType === 'company') setLoadError(error instanceof Error ? error.message : 'تعذر تحميل البيانات.'); return; }
    setLoading(true); const workerOnly = authSession?.role === 'worker'; const hasWorkerId = Boolean(profile?.workerId); let remaining = workerOnly ? 1 : 9; let failed = false;
    const ready = () => { remaining -= 1; if (remaining === 0 && !failed) setLoading(false); };
    const onError = (result: DataOperationResult<never>) => { failed = true; setLoading(false); setLoadError(result.message || 'تعذر تحميل البيانات.'); };
    const listen = <T extends { id: string }>(name: CompanyCollection, set: (items: T[]) => void) => companyDataService.subscribe<T>(companyId, name, (items) => { set(items); ready(); }, onError);
    const orderListener = workerOnly
      ? (() => {
          let cancelled = false;
          if (!hasWorkerId) { setOrders([]); ready(); return () => { cancelled = true; }; }
          void companyDataService.loadWorkerOrders<Order>().then(result => {
            if (cancelled) return;
            if (result.success) setOrders(sortCreated(result.data || []));
            else console.error('[worker-orders] backend load failed', { code: result.code || 'UNKNOWN_ERROR' });
            ready();
          });
          return () => { cancelled = true; };
        })()
      : companyDataService.subscribe<Order>(companyId, 'orders', (items) => { setOrders(sortCreated(items)); ready(); }, onError);
    const unsubs = workerOnly ? [orderListener] : [
      orderListener, listen<Customer>('customers', setCustomers), listen<Worker>('workers', (items) => setWorkers(sortCreated(items))),
      listen<InventoryItem>('inventory', setInventory), listen<Expense>('expenses', (items) => setExpenses(sortCreated(items))), listen<CategoryItem>('categories', setCategories),
      listen<ActivityLogRecord>('activityLogs', (items) => setActivityLogs([...items].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))))), listen<AppNotification>('notifications', setNotifications),
      companyDataService.subscribeSettings<CompanySettings>(companyId, (value) => { setSettings(value || initialCompanySettings); ready(); }, onError),
    ];
    return () => { unsubs.forEach((unsubscribe) => unsubscribe()); clear(); };
  }, [authSession?.uid, authSession?.companyId, authSession?.role, clear, profile?.workerId, retryVersion]);

  const company = useCallback(() => trustedCompanyIdFromSession(authSession), [authSession]);
  const write = useCallback(async <T,>(name: CompanyCollection, id: string, data: T, merge = false) => { const result = await companyDataService.set(company(), name, id, data, merge); if (!result.success) failure(result); return id; }, [company]);
  const remove = useCallback(async (name: CompanyCollection, id: string) => { const result = await companyDataService.remove(company(), name, id); if (!result.success) failure(result); }, [company]);
  const addOrder = useCallback(async (data: Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'remainingBalance' | 'totalPaid' | 'paymentStatus'>) => {
    const id = newId('ord'); const history = data.paymentHistory || []; const totalPaid = Math.max(data.deposit || 0, history.reduce((sum, entry) => sum + (entry.amount || 0), 0)); const totalPrice = data.totalPrice || 0;
    const order: Order = { ...sanitizeData(data), id, paymentHistory: history, totalPaid, remainingBalance: Math.max(0, totalPrice - totalPaid), paymentStatus: totalPaid >= totalPrice && totalPrice > 0 ? 'fully_paid' : totalPaid > 0 ? 'partially_paid' : 'unpaid', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (order.customerId && !customers.some((customer) => customer.id === order.customerId)) throw new Error('العميل المحدد لا يتبع الشركة الحالية.');
    const result = await orderInventoryTransaction.create(company(), order);
    if (!result.success) failure(result);
    return id;
  }, [company, customers]);
  const updateOrder = useCallback(async (id: string, data: Partial<Order>) => {
    const old = orders.find((item) => item.id === id);
    if (!old) throw new Error('لم يتم العثور على الطلب.');
    const paymentHistory = data.paymentHistory || old.paymentHistory || [];
    const totalPrice = data.totalPrice ?? old.totalPrice;
    const totalPaid = Math.max(data.deposit ?? old.deposit, paymentHistory.reduce((sum, entry) => sum + (entry.amount || 0), 0));
    const result = await orderInventoryTransaction.update(company(), id, { ...sanitizeData(data), paymentHistory, totalPaid, remainingBalance: Math.max(0, totalPrice - totalPaid), paymentStatus: totalPaid >= totalPrice && totalPrice > 0 ? 'fully_paid' : totalPaid > 0 ? 'partially_paid' : 'unpaid', updatedAt: new Date().toISOString() }, old.updatedAt);
    if (!result.success) failure(result);
  }, [company, orders]);
  const deleteOrder = useCallback(async (id: string) => { const result = await orderInventoryTransaction.remove(company(), id); if (!result.success) failure(result); }, [company]);
  const addPaymentToOrder = useCallback(async (id: string, payment: Omit<PaymentEntry, 'id'>) => { const order = orders.find((item) => item.id === id); if (!order) throw new Error('لم يتم العثور على الطلب.'); await updateOrder(id, { paymentHistory: [...(order.paymentHistory || []), { ...payment, id: newId('pay') }] }); }, [orders, updateOrder]);
  const addRecord = useCallback(async <T extends object>(name: CompanyCollection, prefix: string, data: T) => { const id = newId(prefix); await write(name, id, { ...sanitizeData(data), id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); return id; }, [write]);
  const updateRecord = useCallback(async <T extends object>(name: CompanyCollection, id: string, data: T) => write(name, id, { ...sanitizeData(data), updatedAt: new Date().toISOString() }, true), [write]);
  const updateSettings = useCallback(async (data: Partial<CompanySettings>) => { const next = { ...settings, ...sanitizeData(data) }; const result = await companyDataService.setSettings(company(), next); if (!result.success) failure(result); }, [company, settings]);
  const checkStockAvailability = useCallback((items: { inventoryItemId: string; quantity: number }[]) => { const warnings = items.flatMap(({ inventoryItemId, quantity }) => { const item = inventory.find((candidate) => candidate.id === inventoryItemId); return item && quantity > item.availableQuantity ? [`الكمية المطلوبة من ${item.nameAr} غير متاحة.`] : []; }); return { available: warnings.length === 0, warnings }; }, [inventory]);
  const exportBackupJson = useCallback(() => { const companyId = company(); const payload = { version: 1, companyId, exportDate: new Date().toISOString(), settings, customers, inventory, orders, expenses, categories }; const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `Company_${companyId}_Backup.json`; link.click(); URL.revokeObjectURL(url); }, [categories, company, customers, expenses, inventory, orders, settings]);
  const restoreBackupJson = useCallback(async (json: string) => { try { const parsed = JSON.parse(json); if (parsed.companyId !== company()) throw new Error('ملف النسخة الاحتياطية يخص شركة أخرى.'); throw new Error('استعادة النسخ الاحتياطية للشركات غير متاحة حتى النسخة الآمنة.'); } catch (error) { console.warn(error instanceof Error ? error.message : 'Restore rejected'); return false; } }, [company]);
  const value = useMemo<DataContextType>(() => ({ orders, customers, workers, inventory, expenses, settings, notifications, categories, activityLogs, loading, totalCapital: expenses.filter((item) => item.type === 'capital').reduce((sum, item) => sum + (item.amount || 0), 0), totalGeneralExpenses: expenses.filter((item) => item.type !== 'capital').reduce((sum, item) => sum + (item.amount || 0), 0), currentCashBalance: expenses.filter((item) => item.type === 'capital').reduce((sum, item) => sum + (item.amount || 0), 0) - expenses.filter((item) => item.type === 'capital').reduce((sum, item) => sum + (item.amount || 0), 0), addOrder, updateOrder, deleteOrder, addPaymentToOrder, addWorker: (data) => addRecord('workers', 'wrk', data), updateWorker: (id, data) => updateRecord('workers', id, data), deleteWorker: (id) => remove('workers', id), toggleWorkerStatus: (id, status) => updateRecord('workers', id, { status }), addCustomer: (data) => addRecord('customers', 'cus', data), updateCustomer: (id, data) => updateRecord('customers', id, data), deleteCustomer: (id) => remove('customers', id), addInventoryItem: (data) => addRecord('inventory', 'inv', { ...data, reservedQuantity: 0, availableQuantity: data.quantity }), updateInventoryItem: (id, data) => updateRecord('inventory', id, data), deleteInventoryItem: (id) => remove('inventory', id), addExpense: (data) => { if (data.linkedOrderId && !orders.some((order) => order.id === data.linkedOrderId)) return Promise.reject(new Error('الطلب المرتبط لا يتبع الشركة الحالية.')); return addRecord('expenses', 'exp', data); }, updateExpense: (id, data) => updateRecord('expenses', id, data), deleteExpense: (id) => remove('expenses', id), addCategory: async (nameEn, nameAr) => { const category: CategoryItem = { id: newId('cat'), key: `custom_${nameEn.toLowerCase().replace(/[^a-z0-9]/g, '_')}`, nameEn: sanitizeData(nameEn), nameAr: sanitizeData(nameAr), isCustom: true }; await write('categories', category.id, category); return category; }, updateSettings, seedSampleData: async () => { throw new Error('البيانات التجريبية معطلة في وضع الشركات.'); }, exportBackupJson, restoreBackupJson, addActivityLog: async (data) => addRecord('activityLogs', 'log', { ...data, timestamp: new Date().toISOString(), logId: newId('log') }), markNotificationAsRead: async (id) => { await updateRecord('notifications', id, { read: true }); }, clearAllNotifications: async () => { await Promise.all(notifications.filter((item) => !item.read).map((item) => updateRecord('notifications', item.id, { read: true }))); }, checkStockAvailability }), [addOrder, addPaymentToOrder, addRecord, categories, checkStockAvailability, customers, deleteOrder, expenses, exportBackupJson, inventory, loading, notifications, orders, remove, restoreBackupJson, settings, updateOrder, updateRecord, updateSettings, workers, write, activityLogs]);
  value.currentCashBalance = expenses.filter((item) => item.type === 'capital').reduce((sum, item) => sum + (item.amount || 0), 0) - expenses.filter((item) => item.type !== 'capital').reduce((sum, item) => sum + (item.amount || 0), 0);
  return <DataContext.Provider value={value}>{loadError && <div role="alert" dir="rtl" className="fixed z-[100] bottom-4 left-4 max-w-sm rounded-xl bg-red-600 text-white px-4 py-3 shadow-lg text-sm"><p>{loadError}</p><button type="button" className="mt-2 underline font-bold" onClick={() => setRetryVersion((version) => version + 1)}>حاول مرة أخرى</button></div>}{children}</DataContext.Provider>;
}
