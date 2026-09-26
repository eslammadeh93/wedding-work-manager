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
import { resolveOrderCustomers } from '../../utils/orderCustomer';
import { initialOrderPaymentState, resolveOrderPaymentState, appendPaymentEntry, type OrderPaymentIntent } from '../../utils/orderPaymentState';
import { assertValidExpense, assertValidOrderFinancials } from '../../utils/financialValidation';
import { expenseReversalEntry, expenseVoidMetadata, financialHistoryOrders } from '../../utils/financialRetention';
import { loadFinancialOrderHistory, type FinancialHistoryStatus } from './financialHistory';
import type { ExpenseAccess } from '../../utils/financialAvailability';
import { buildFinancialBackup } from '../../utils/financialBackup';
import { newSubmissionId, submissionIdFor } from '../../utils/submissionId';

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
  const [deletedOrders, setDeletedOrders] = useState<Order[]>([]);
  const [workTasks, setWorkTasks] = useState<WorkTask[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]); const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]); const [categories, setCategories] = useState<CategoryItem[]>(defaultCategories);
  const [activityLogs, setActivityLogs] = useState<ActivityLogRecord[]>([]); const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [settings, setSettings] = useState<CompanySettings>(initialCompanySettings);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState<string | null>(null); const [retryVersion, setRetryVersion] = useState(0);
  // Accounting history is a separate dataset from the operational order list:
  // the listener above deliberately keeps only a short recent window so the
  // screens stay fast, which is far too little to total the books from.
  const [financialOrders, setFinancialOrders] = useState<Order[]>([]);
  const [financialHistoryStatus, setFinancialHistoryStatus] = useState<FinancialHistoryStatus | undefined>(undefined);
  const [financialHistoryMessage, setFinancialHistoryMessage] = useState<string | undefined>(undefined);
  const [financialHistoryLoading, setFinancialHistoryLoading] = useState(true);
  const [expenseAccess, setExpenseAccess] = useState<ExpenseAccess>('denied');
  // Bumped whenever a write changes something the books depend on, so the
  // history reloads once instead of going stale or polling.
  const [financialDataVersion, setFinancialDataVersion] = useState(0);

  // Firestore listeners confirm every write for all connected devices. These
  // local patches cover the small gap before that acknowledgement arrives,
  // so add/edit/delete actions never leave a stale card on screen.
  const mergeLocal = <T extends { id: string }>(set: React.Dispatch<React.SetStateAction<T[]>>, id: string, data: object, merge: boolean) => {
    set(current => {
      const index = current.findIndex(item => item.id === id);
      const next = { ...(merge && index >= 0 ? current[index] : {}), ...data, id } as T;
      return index < 0 ? [next, ...current] : current.map(item => item.id === id ? next : item);
    });
  };
  const removeLocal = <T extends { id: string }>(set: React.Dispatch<React.SetStateAction<T[]>>, id: string) => set(current => current.filter(item => item.id !== id));
  const applyLocalWrite = useCallback((name: CompanyCollection, id: string, data: object, merge: boolean) => {
    // Anything that moves money invalidates the loaded history exactly once.
    if (name === 'orders' || name === 'expenses') setFinancialDataVersion((version) => version + 1);
    if (name === 'orders') mergeLocal(setOrders, id, data, merge);
    else if (name === 'workTasks') mergeLocal(setWorkTasks, id, data, merge);
    else if (name === 'customers') mergeLocal(setCustomers, id, data, merge);
    else if (name === 'suppliers') mergeLocal(setSuppliers, id, data, merge);
    else if (name === 'workers') mergeLocal(setWorkers, id, data, merge);
    else if (name === 'inventory') mergeLocal(setInventory, id, data, merge);
    else if (name === 'expenses') mergeLocal(setExpenses, id, data, merge);
    else if (name === 'categories') mergeLocal(setCategories, id, data, merge);
    else if (name === 'activityLogs') mergeLocal(setActivityLogs, id, data, merge);
    else if (name === 'notifications') mergeLocal(setNotifications, id, data, merge);
  }, []);
  const applyLocalRemove = useCallback((name: CompanyCollection, id: string) => {
    if (name === 'orders') removeLocal(setOrders, id);
    else if (name === 'workTasks') removeLocal(setWorkTasks, id);
    else if (name === 'customers') removeLocal(setCustomers, id);
    else if (name === 'suppliers') removeLocal(setSuppliers, id);
    else if (name === 'workers') removeLocal(setWorkers, id);
    else if (name === 'inventory') removeLocal(setInventory, id);
    else if (name === 'expenses') removeLocal(setExpenses, id);
    else if (name === 'categories') removeLocal(setCategories, id);
    else if (name === 'activityLogs') removeLocal(setActivityLogs, id);
    else if (name === 'notifications') removeLocal(setNotifications, id);
  }, []);

  const clear = useCallback(() => { setOrders([]); setDeletedOrders([]); setWorkTasks([]); setCustomers([]); setSuppliers([]); setWorkers([]); setInventory([]); setExpenses([]); setCategories(defaultCategories); setActivityLogs([]); setNotifications([]); setSettings(initialCompanySettings); }, []);
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
    setExpenseAccess(allowed('company:expenses:read') ? 'granted' : 'denied');
    const unsubs = [orderListener];
    let deferredListenersTimer: number | undefined;
    // The operational listener intentionally loads only current orders. Keep a
    // separate realtime query for the recycle bin so deleting an old order is
    // immediately visible there too.
    // Orders and company settings are sufficient for the first screen. Delay
    // secondary datasets so Safari can paint before opening many Firestore
    // streams at once on lower-memory iPhones.
    deferredListenersTimer = window.setTimeout(() => {
    if (failed) return;
    if (!workerOnly && allowed('company:orders:read')) {
      remaining += 1;
      unsubs.push(companyDataService.subscribeDeletedOrders<Order>(companyId, (items) => { setDeletedOrders(items); ready(); }, onError));
    }
    if (workerOnly && workerId) unsubs.push(listen<WorkTask>('workTasks', (items) => setWorkTasks(sortCreated(items)), { field: 'workerId', value: workerId }));
    else if (allowed('company:orders:read')) unsubs.push(listen<WorkTask>('workTasks', (items) => setWorkTasks(sortCreated(items))));
    if (allowed('company:customers:read')) unsubs.push(listen<Customer>('customers', setCustomers));
    if (allowed('company:suppliers:read')) unsubs.push(listen<Supplier>('suppliers', (items) => setSuppliers(sortCreated(items))));
    if (allowed('company:workers:read')) unsubs.push(listen<Worker>('workers', (items) => setWorkers(sortCreated(items))));
    if (allowed('company:inventory:read')) unsubs.push(listen<InventoryItem>('inventory', setInventory));
    // An unreadable collection is not an empty one. The flag lets the screens
    // withhold expense-dependent figures instead of showing them as zero.
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
    }, 900);
    if (allowed('company:settings:read') || allowed('company:calculator:use') || allowed('company:calculator:manage') || allowed('company:order_responsibles:manage') || allowed('company:orders:write')) { remaining += 1; unsubs.push(companyDataService.subscribeSettings<CompanySettings>(companyId, (value) => { setSettings(value || initialCompanySettings); ready(); }, onError)); }
    if (remaining === 0) setLoading(false);
    return () => { if (deferredListenersTimer !== undefined) window.clearTimeout(deferredListenersTimer); unsubs.forEach((unsubscribe) => unsubscribe()); clear(); };
  }, [authSession, clear, profile?.workerId, retryVersion]);

  const company = useCallback(() => trustedCompanyIdFromSession(authSession), [authSession]);
  /**
   * Loads the complete financial dataset, separately from the operational
   * listener and without touching it. A failure is reported as a failure; the
   * operational list is never quietly substituted for history that did not
   * load, because that would silently understate the books.
   */
  useEffect(() => {
    let cancelled = false;
    let companyId = '';
    try { companyId = trustedCompanyIdFromSession(authSession); } catch { companyId = ''; }
    const canReadOrders = authSession?.userType === 'company' && authSession.permissions.includes('company:orders:read');
    if (!companyId || !canReadOrders) {
      setFinancialOrders([]); setFinancialHistoryStatus(undefined); setFinancialHistoryLoading(false);
      return () => { cancelled = true; };
    }
    setFinancialHistoryLoading(true);
    void (async () => {
      const result = await loadFinancialOrderHistory(companyId);
      if (cancelled) return;
      setFinancialOrders(result.status === 'error' ? [] : result.records);
      setFinancialHistoryStatus(result.status);
      setFinancialHistoryMessage(result.message);
      setFinancialHistoryLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authSession, financialDataVersion, retryVersion]);
  const refreshFinancialHistory = useCallback(() => setFinancialDataVersion((version) => version + 1), []);

  const write = useCallback(async <T extends object,>(name: CompanyCollection, id: string, data: T, merge = false) => { const result = await companyDataService.set(company(), name, id, data, merge); if (!result.success) failure(result); applyLocalWrite(name, id, data, merge); return id; }, [applyLocalWrite, company]);
  const remove = useCallback(async (name: CompanyCollection, id: string) => { const result = await companyDataService.remove(company(), name, id); if (!result.success) failure(result); applyLocalRemove(name, id); }, [applyLocalRemove, company]);
  const addOrder = useCallback(async (data: NewOrderData, newCustomer?: NewOrderCustomer, options?: { submissionId?: string }) => {
    // The submission id becomes the document id, so retrying the same save
    // targets the document that already exists instead of making a second one.
    const id = submissionIdFor('ord', options?.submissionId);
    const customerId = data.customerId || (newCustomer ? newId('cus') : '');
    if (!customerId) throw new Error('يرجى اختيار عميل أو إدخال بيانات عميل جديد.');
    const now = new Date().toISOString(); const companyId = company();
    const history = (data.paymentHistory || []).filter((entry) => Number(entry.amount) > 0);
    const totalPrice = data.totalPrice || 0;
    // The deposit field and opening history describe the same payment.
    // Do not treat the deposit as legacy money before adding that history.
    const financial = initialOrderPaymentState({ deposit: data.deposit || 0, paymentHistory: history, totalPrice });
    assertValidOrderFinancials({ ...data, ...financial });
    const totalPaid = financial.totalPaid;
    const eventDate = data.eventDate || data.weddingDate;
    const order: Order = { ...sanitizeData(data), id, companyId, customerId, eventDate, archiveEligibleAt: archiveEligibleAt(eventDate), archivedAt: null, orderSource: data.orderSource || 'other', workerCanContactCustomer: data.workerCanContactCustomer === true, paymentHistory: history, totalPaid, remainingBalance: financial.remainingBalance, paymentStatus: financial.paymentStatus, createdAt: now, updatedAt: now };
    const customer: Customer | undefined = newCustomer ? { ...sanitizeData(newCustomer), id: customerId, companyId, orderIds: [id], createdAt: now, updatedAt: now } : undefined;
    const result = await orderInventoryTransaction.create(companyId, order, customer);
    // `create` refuses to overwrite an existing order, so a retry of the same
    // submission comes back as a stale-order conflict. That is this submission
    // having already succeeded, not a new failure, so the id is returned.
    if (!result.success) {
      if (options?.submissionId && result.code === 'ORDER_STALE') return id;
      failure(result);
    }
    applyLocalWrite('orders', id, order, false);
    if (customer) applyLocalWrite('customers', customer.id, customer, false);
    return id;
  }, [applyLocalWrite, company]);
  const updateOrder = useCallback(async (id: string, data: Partial<Order>, options?: { expectedUpdatedAt?: string }) => {
    let old = orders.find((item) => item.id === id);
    if (!old) {
      const fetched = await companyDataService.get<Order>(company(), 'orders', id);
      if (fetched.success) old = fetched.data;
    }
    if (!old) throw new Error('لم يتم العثور على الطلب.');
    if (authSession?.role === 'worker') throw new Error('لا يُسمح للمنفذ بتعديل الطلب أو حالته.');
    // Derived financial fields are never accepted from a caller: they are
    // recomputed inside the transaction from the record as it is stored.
    const { paymentHistory, totalPaid: _storedPaid, remainingBalance: _storedBalance, paymentStatus: _storedStatus, ...editable } = data;
    const eventDate = data.eventDate || data.weddingDate || old.eventDate || old.weddingDate;
    const intent: OrderPaymentIntent = {
      totalPrice: data.totalPrice ?? old.totalPrice,
      ...(paymentHistory ? { paymentHistory } : {}),
      ...(data.deposit !== undefined ? { deposit: Number(data.deposit) } : {}),
    };
    const patch: Partial<Order> = { ...(sanitizeData(editable) as Partial<Order>), eventDate, archiveEligibleAt: archiveEligibleAt(eventDate), updatedAt: new Date().toISOString() };
    assertValidOrderFinancials(patch, old);
    // A form that was opened earlier passes the version it started from, so a
    // payment recorded in the meantime is never overwritten.
    const result = await orderInventoryTransaction.update(company(), id, patch, options?.expectedUpdatedAt ?? old.updatedAt, intent);
    if (!result.success) failure(result);
    applyLocalWrite('orders', id, { ...patch, ...resolveOrderPaymentState(old, intent) }, true);
  }, [applyLocalWrite, authSession?.role, company, orders]);
  /**
   * Every payment mutation runs against the order as stored right now, so an
   * open detail screen can never resurrect a payment list it read minutes ago.
   */
  /**
   * The one payment write. `apply` is a reducer over the history as stored
   * inside the transaction, never a snapshot from the screen, so a payment
   * recorded while the modal was open is carried through rather than
   * overwritten. `expectedUpdatedAt` is passed by corrections and deletions,
   * which must refuse outright if the record moved on; an ordinary append
   * leaves it out so a retry stays idempotent.
   */
  const updateOrderPayments = useCallback(async (
    id: string,
    apply: (history: PaymentEntry[]) => PaymentEntry[] | null,
    options?: { expectedUpdatedAt?: string },
  ) => {
    if (authSession?.role === 'worker') throw new Error('لا يُسمح للمنفذ بتعديل الطلب أو حالته.');
    const result = await orderInventoryTransaction.mutateFinancial(company(), id, (current) => {
      const nextHistory = apply(current.paymentHistory || []);
      if (!nextHistory) return null;
      const financial = resolveOrderPaymentState(current, { paymentHistory: nextHistory, totalPrice: current.totalPrice });
      assertValidOrderFinancials({ ...financial, totalPrice: current.totalPrice }, current);
      return financial;
    }, options?.expectedUpdatedAt);
    if (!result.success) failure(result);
    if (result.data?.patch) applyLocalWrite('orders', id, result.data.patch, true);
  }, [applyLocalWrite, authSession?.role, company]);
  const deleteOrder = useCallback(async (id: string) => {
    const result = await orderInventoryTransaction.remove(company(), id);
    if (!result.success) failure(result);
    // Do not manufacture a partial order record when this historical order is
    // not in the short operational window. The dedicated recycle-bin listener
    // will provide the complete record; visible page cards are removed by the
    // orders screen immediately after this succeeds.
    if (orders.some((order) => order.id === id)) applyLocalWrite('orders', id, { ...deletionMetadata(), updatedAt: new Date().toISOString() }, true);
  }, [applyLocalWrite, company, orders]);
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
  const addPaymentToOrder = useCallback(async (id: string, payment: Omit<PaymentEntry, 'id'> & { id?: string }) => {
    // Keep a caller-provided id: retrying the same action cannot create a
    // second settlement payment, and the duplicate check runs against the
    // record inside the transaction rather than a cached copy.
    const entry: PaymentEntry = { ...payment, id: payment.id || newId('pay') };
    await updateOrderPayments(id, (history) => appendPaymentEntry(history, entry));
  }, [updateOrderPayments]);
  const addRecord = useCallback(async <T extends object>(name: CompanyCollection, prefix: string, data: T, options?: { submissionId?: string }) => {
    // Same rule as orders: the submission id is the document id, so a retried
    // save writes over its own document rather than creating a second expense.
    const id = submissionIdFor(prefix, options?.submissionId);
    await write(name, id, { ...sanitizeData(data), id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return id;
  }, [write]);
  // Version-checked so two open editors cannot silently overwrite each other
  // and a stale editor cannot resurrect a record deleted in the meantime.
  const updateRecord = useCallback(async <T extends object>(name: CompanyCollection, id: string, data: T, options?: { expectedUpdatedAt?: string }) => {
    const value = { ...sanitizeData(data), updatedAt: new Date().toISOString() };
    const result = await companyDataService.updateExisting(company(), name, id, value, options?.expectedUpdatedAt);
    if (!result.success) failure(result);
    applyLocalWrite(name, id, value, true);
  }, [applyLocalWrite, company]);
  /**
   * A financial entry is never destroyed. The original stays as evidence, and
   * a dated reversal entry cancels it from the day of the void, so the month
   * it was booked in keeps the number it was reported with.
   */
  const voidExpense = useCallback(async (id: string) => {
    const existing = expenses.find((item) => item.id === id);
    if (!existing) throw new Error('لم يتم العثور على القيد.');
    if (existing.voidedAt) return;
    const reversalId = newId('exp');
    const reversal = expenseReversalEntry(existing, reversalId);
    const result = await companyDataService.voidFinanceEntry(company(), id, expenseVoidMetadata(reversalId), reversalId, { ...reversal, id: reversalId }, existing.updatedAt);
    if (!result.success) failure(result);
    applyLocalWrite('expenses', id, expenseVoidMetadata(reversalId), true);
    applyLocalWrite('expenses', reversalId, { ...reversal, id: reversalId }, false);
  }, [applyLocalWrite, company, expenses]);
  const updateSettings = useCallback(async (data: Partial<CompanySettings>) => { const next = { ...settings, ...sanitizeData(data) }; const result = await companyDataService.setSettings(company(), next); if (!result.success) failure(result); }, [company, settings]);

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
      setDeletedOrders((items) => items.filter((order) => order.id !== item.id));
      return;
    }
    const collection = item.type === 'customer' ? 'customers' : 'inventory';
    await write(collection, item.id, { deletedAt: null, purgeAt: null }, true);
  }, [company, write]);
  const activeOrders = useMemo(
    () => resolveOrderCustomers(orders.filter((order) => !isSoftDeleted(order)), customers),
    [customers, orders],
  );
  const activeCustomers = useMemo(() => customers.filter((customer) => !isSoftDeleted(customer)), [customers]);
  const activeInventory = useMemo(() => inventory.filter((item) => !isSoftDeleted(item)), [inventory]);
  const recycleBinOrders = useMemo(() => {
    const itemsById = new Map<string, Order>();
    for (const order of orders) itemsById.set(order.id, order);
    for (const order of deletedOrders) itemsById.set(order.id, order);
    return [...itemsById.values()];
  }, [deletedOrders, orders]);
  const deletedItems = useMemo(() => buildRecycleBinItems(recycleBinOrders, customers, inventory), [recycleBinOrders, customers, inventory]);
  const checkStockAvailability = useCallback((items: { inventoryItemId: string; quantity: number }[]) => { const warnings = items.flatMap(({ inventoryItemId, quantity }) => { const item = activeInventory.find((candidate) => candidate.id === inventoryItemId); return item && quantity > item.availableQuantity ? [`الكمية المطلوبة من ${item.nameAr} غير متاحة.`] : []; }); return { available: warnings.length === 0, warnings }; }, [activeInventory]);
  /**
   * Deleting an order removes it from the screens, not from the books. Orders
   * that were retained for their posted financial history stay in the dataset
   * the cash balance is computed from.
   */
  const accountingOrders = useMemo(
    () => financialHistoryOrders(
      // The financial scope already carries archived and retained-deleted
      // orders; the operational list and the recycle bin only fill the gap
      // while that dataset is still loading.
      resolveOrderCustomers(financialOrders, customers).concat(activeOrders),
      resolveOrderCustomers(deletedOrders, customers),
    ),
    [activeOrders, customers, deletedOrders, financialOrders],
  );
  /**
   * Writes the whole accounting dataset, not the short operational window, and
   * refuses outright when the financial history is loading, failed, truncated
   * or unreadable. A backup that is quietly missing most of the ledger is
   * worse than none, because it looks like one.
   */
  const exportBackupJson = useCallback(() => {
    const payload = buildFinancialBackup({
      companyId: company(),
      historyStatus: financialHistoryStatus,
      historyLoading: financialHistoryLoading,
      historyMessage: financialHistoryMessage,
      expenseAccess,
      accountingOrders,
      expenses, customers, suppliers, inventory, categories, settings,
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `Company_${payload.companyId}_Financial_Backup.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [accountingOrders, categories, company, customers, expenseAccess, expenses, financialHistoryLoading, financialHistoryMessage, financialHistoryStatus, inventory, settings, suppliers]);
  /** What a repair run would change, computed without writing anything. */
  const financialTotals = useMemo(() => {
    // A voided entry keeps its original amount as evidence; the dated reversal
    // entry is what cancels it, so the two net out in these totals.
    const effect = (item: Expense) => (item.isReversal ? -(item.amount || 0) : (item.amount || 0));
    const totalCapital = expenses.filter((item) => item.type === 'capital').reduce((sum, item) => sum + effect(item), 0);
    const totalGeneralExpenses = expenses.filter((item) => item.type !== 'capital').reduce((sum, item) => sum + effect(item), 0);
    return { totalCapital, totalGeneralExpenses, currentCashBalance: calculateSafeBalanceToDate(accountingOrders, expenses) };
  }, [accountingOrders, expenses]);
  const addCategory = useCallback(async (data: NewCategoryData) => {
    const key = sanitizeData(data.key).trim().toLowerCase().replace(/\s+/g, '_');
    const nameEn = sanitizeData(data.nameEn).trim(); const nameAr = sanitizeData(data.nameAr).trim();
    if (!key || !nameEn || !nameAr) throw new Error('أدخل مفتاح التصنيف واسمه بالعربية والإنجليزية.');
    const category: CategoryItem = { id: newId('cat'), key, nameEn, nameAr, isCustom: true };
    await write('categories', category.id, category);
    return category;
  }, [write]);
  const value = useMemo<DataContextType>(() => ({ orders: activeOrders, workTasks, customers: activeCustomers, suppliers, workers, inventory: activeInventory, expenses, settings, notifications, categories, activityLogs, loading, recycleBinItems: deletedItems, restoreDeletedItem, ...financialTotals,
    accountingOrders,
    financialData: { status: financialHistoryStatus, loading: financialHistoryLoading, message: financialHistoryMessage, expenseAccess },
    refreshFinancialHistory, addOrder, updateOrder, updateOrderPayments, deleteOrder, addPaymentToOrder, addWorkTask, updateWorkTask, deleteWorkTask, addWorker: async () => { throw new Error('إنشاء العامل متاح من قسم العمال فقط.'); }, updateWorker: updateWorkerSafe, deleteWorker: deleteWorkerSafe, toggleWorkerStatus: toggleWorkerStatusSafe, addCustomer: (data) => addRecord('customers', 'cus', data), updateCustomer: (id, data) => updateRecord('customers', id, data), deleteCustomer: (id) => write('customers', id, deletionMetadata(), true), addSupplier: (data) => addRecord('suppliers', 'sup', data), updateSupplier: (id, data) => updateRecord('suppliers', id, data), deleteSupplier: (id) => remove('suppliers', id), addInventoryItem: (data) => addRecord('inventory', 'inv', { ...data, reservedQuantity: 0, availableQuantity: data.quantity }), updateInventoryItem: (id, data) => updateRecord('inventory', id, data), deleteInventoryItem: (id) => write('inventory', id, deletionMetadata(), true), addExpense: (data, options) => { try { assertValidExpense(data, (orderId) => activeOrders.some((order) => order.id === orderId)); } catch (error) { return Promise.reject(error); } return addRecord('expenses', 'exp', data, options); }, updateExpense: (id, data, options) => { assertValidExpense(data, (orderId) => activeOrders.some((order) => order.id === orderId), expenses.find((item) => item.id === id)); return updateRecord('expenses', id, data, options); }, deleteExpense: voidExpense, addCategory, updateSettings, seedSampleData: async () => { throw new Error('البيانات التجريبية معطلة في وضع الشركات.'); }, exportBackupJson, restoreBackupJson, addActivityLog: addActivityLogSafe, recordWorkerMovement: recordWorkerMovementSafe, markNotificationAsRead: async (id) => markNotificationsSafe([id]), clearAllNotifications: async () => markNotificationsSafe(notifications.filter((item) => !item.read).map((item) => item.id)), checkStockAvailability }), [activeCustomers, activeInventory, activeOrders, activityLogs, addActivityLogSafe, addCategory, addOrder, addPaymentToOrder, addRecord, addWorkTask, categories, checkStockAvailability, deleteOrder, deleteWorkTask, deleteWorkerSafe, deletedItems, expenses, exportBackupJson, financialTotals, loading, markNotificationsSafe, notifications, recordWorkerMovementSafe, remove, restoreBackupJson, updateOrderPayments, voidExpense, accountingOrders, expenseAccess, financialHistoryLoading, financialHistoryMessage, financialHistoryStatus, refreshFinancialHistory, restoreDeletedItem, settings, suppliers, toggleWorkerStatusSafe, updateOrder, updateRecord, updateSettings, updateWorkTask, updateWorkerSafe, workTasks, workers, write]);
  return <DataContext.Provider value={value}>{loadError && <div role="alert" dir="rtl" className="fixed z-[100] bottom-4 left-4 max-w-sm rounded-xl bg-red-600 text-white px-4 py-3 shadow-lg text-sm"><p>{loadError}</p><button type="button" className="mt-2 underline font-bold" onClick={() => setRetryVersion((version) => version + 1)}>حاول مرة أخرى</button></div>}{children}</DataContext.Provider>;
}
