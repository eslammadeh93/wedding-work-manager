import { Timestamp, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit, onSnapshot, orderBy, query, setDoc, startAfter, where, type DocumentData, type QueryConstraint, type QueryDocumentSnapshot, type Unsubscribe } from 'firebase/firestore';
import { auth, db, functions } from '../../firebase/config';
import { httpsCallable } from 'firebase/functions';
import { firestorePaths } from '../firestorePaths';
import { mergeWorkerContact } from '../../utils/workerContact';
import type { AuthSession } from '../types';

export type CompanyCollection = 'orders' | 'workTasks' | 'customers' | 'suppliers' | 'workers' | 'inventory' | 'expenses' | 'categories' | 'activityLogs' | 'notifications';
export type DataErrorCode = 'UNAUTHENTICATED' | 'NO_COMPANY_CONTEXT' | 'PERMISSION_DENIED' | 'NETWORK_ERROR' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT' | 'WRITE_FAILED' | 'DELETE_FAILED' | 'INVALID_QUANTITY' | 'INVENTORY_NOT_FOUND' | 'CROSS_TENANT_INVENTORY' | 'INSUFFICIENT_STOCK' | 'INVENTORY_INVARIANT' | 'ORDER_NOT_FOUND' | 'CUSTOMER_NOT_FOUND' | 'ORDER_ALREADY_DELETED' | 'ORDER_STALE' | 'UNKNOWN_ERROR';
export interface DataOperationResult<T> { success: boolean; data?: T; code?: DataErrorCode; message?: string; error?: unknown; }
export type OrderPageScope = 'active' | 'finished' | 'archived' | 'all';
export interface OrderPageRequest {
  scope: OrderPageScope;
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  status?: string;
  paymentStatus?: string;
  dateField?: 'eventDate' | 'bookingDate';
  dateFrom?: string;
  dateTo?: string;
}
export interface ActivityLogPageRequest {
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  action?: string;
  from?: string;
  to?: string;
}
export interface PageResult<T> { records: T[]; cursor: QueryDocumentSnapshot<DocumentData> | null; hasMore: boolean; }
export interface OrderScopeCounts { active: number; finished: number; }
const ROOT_COLLECTIONS = new Set(['users', 'orders', 'customers', 'workers', 'inventory', 'expenses', 'categories', 'activityLogs', 'settings']);
const isDevelopment = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
const firebaseErrorCode = (error: unknown) => String((error as { code?: unknown })?.code || 'unknown');
const workerContactDebug = (event: string, details: Record<string, unknown>) => {
  if (isDevelopment) console.info(`[worker-contact] ${event}`, details);
};

export interface WorkerOrdersListenerInput {
  companyId: string;
  workerId: string;
  session: Pick<AuthSession, 'uid' | 'userType' | 'role' | 'memberStatus'> | null;
}

type WorkerOrdersQueryConstraint = Readonly<{
  type: 'where';
  fieldPath: 'workerId';
  operator: '==';
  value: string;
}>;

const nonBlank = (value: string | null | undefined) => String(value || '').trim();
const workerOrdersQueryConstraints = (workerId: string): readonly WorkerOrdersQueryConstraint[] => [
  { type: 'where', fieldPath: 'workerId', operator: '==', value: workerId },
];
const workerOrdersQueryDetails = (companyId: string, workerId: string) => {
  const collectionPath = companyId ? firestorePaths.workerOrders(companyId) : null;
  const constraints = workerOrdersQueryConstraints(workerId);
  return {
    collectionPath,
    constraints,
    hasWorkerIdEqualityConstraint: constraints.some(constraint => constraint.fieldPath === 'workerId' && constraint.operator === '==' && constraint.value === workerId),
    actualQuery: collectionPath
      ? `query(collection(db, ${JSON.stringify(collectionPath)}), where(\"workerId\", \"==\", ${JSON.stringify(workerId)}))`
      : null,
  };
};
const workerOrdersDebug = (event: string, details: Record<string, unknown>) => {
  console.info(`[worker-orders] ${event}`, details);
};

/** A worker projection query must never start until the tenant session is fully usable. */
export const workerOrdersListenerInputReady = (input: WorkerOrdersListenerInput): boolean => {
  const session = input.session;
  return Boolean(
    nonBlank(input.companyId)
    && nonBlank(input.workerId)
    && session
    && nonBlank(session.uid)
    && session.userType === 'company'
    && session.role === 'worker'
    && session.memberStatus === 'active',
  );
};

/** Development-only guard for future tenant code; it deliberately does nothing in legacy mode. */
export const warnOnTenantRootCollection = (path: string) => {
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
  if (env?.DEV && ROOT_COLLECTIONS.has(path.split('/')[0])) console.warn('Multi-tenant data access attempted a root collection.');
};

const messageFor = (error: unknown, fallback: string): Pick<DataOperationResult<never>, 'code' | 'message' | 'error'> => {
  const code = (error as { code?: string })?.code || '';
  if (code.includes('permission-denied')) return { code: 'PERMISSION_DENIED', message: 'ليس لديك صلاحية للوصول إلى البيانات.', error };
  if (code.includes('unauthenticated')) return { code: 'UNAUTHENTICATED', message: 'يرجى تسجيل الدخول مرة أخرى.', error };
  if (code.includes('unavailable') || code.includes('network')) return { code: 'NETWORK_ERROR', message: 'انقطع الاتصال. حاول مرة أخرى.', error };
  return { code: 'UNKNOWN_ERROR', message: fallback, error };
};

const activeOrderStatuses = ['new', 'pending', 'confirmed', 'preparing', 'out_for_delivery', 'in_progress'];
const finishedOrderStatuses = ['completed', 'returned', 'cancelled', 'cancelled_deposit_retained'];
const safePageSize = (value: number | undefined, fallback = 50) => Math.min(100, Math.max(10, Math.floor(value || fallback)));
const isIndexUnavailable = (error: unknown) => firebaseErrorCode(error) === 'failed-precondition';

function pageResult<T extends { id: string }>(snapshots: QueryDocumentSnapshot<DocumentData>[], pageSize: number): PageResult<T> {
  const page = snapshots.slice(0, pageSize);
  return {
    records: page.map((item) => ({ id: item.id, ...item.data() } as T)),
    cursor: page.length ? page[page.length - 1] : null,
    hasMore: snapshots.length > pageSize,
  };
}

function matchesOrderPageRequest(data: DocumentData, request: OrderPageRequest): boolean {
  const status = String(data.orderStatus || '');
  if (request.scope === 'archived') return Boolean(data.archivedAt);
  if (data.archivedAt) return false;
  if (request.status ? status !== request.status : request.scope === 'active' ? !activeOrderStatuses.includes(status) : request.scope === 'finished' ? !finishedOrderStatuses.includes(status) : false) return false;
  return !request.paymentStatus || data.paymentStatus === request.paymentStatus;
}

/**
 * A short-lived safety net while Firestore builds a newly deployed composite
 * index. Normal requests always use the fully server-filtered path below.
 */
async function getOrderPageWhileIndexBuilds<T extends { id: string }>(companyId: string, request: OrderPageRequest): Promise<PageResult<T>> {
  const pageSize = safePageSize(request.pageSize);
  const dateField = request.dateField || 'eventDate';
  const constraints: QueryConstraint[] = [];
  if (request.scope === 'archived') constraints.push(orderBy('archivedAt', 'desc'));
  else {
    if (request.dateFrom) constraints.push(where(dateField, '>=', request.dateFrom));
    if (request.dateTo) constraints.push(where(dateField, '<=', request.dateTo));
    constraints.push(orderBy(dateField, request.scope === 'active' ? 'asc' : 'desc'));
  }
  if (request.cursor) constraints.push(startAfter(request.cursor));
  // This bounded window is deliberately larger than a page because status and
  // payment are temporarily filtered locally until the composite index is ready.
  const scanSize = Math.min(100, pageSize * 2);
  constraints.push(limit(scanSize));
  const snapshot = await getDocs(query(collection(db, firestorePaths.orders(companyId)), ...constraints));
  const matched = snapshot.docs.filter((item) => matchesOrderPageRequest(item.data(), request));
  return {
    records: matched.slice(0, pageSize).map((item) => ({ id: item.id, ...item.data() } as T)),
    cursor: snapshot.docs.length ? snapshot.docs[snapshot.docs.length - 1] : null,
    hasMore: snapshot.docs.length === scanSize,
  };
}

/** All tenant operational paths are constructed here, never in UI components. */
export const companyDataService = {
  /** Tab counters are independent aggregate queries, so switching pages never resets the other tab's total. */
  async getOrderScopeCounts(companyId: string): Promise<DataOperationResult<OrderScopeCounts>> {
    try {
      const orders = collection(db, firestorePaths.orders(companyId));
      const [active, finished] = await Promise.all([
        getCountFromServer(query(orders, where('orderStatus', 'in', activeOrderStatuses))),
        getCountFromServer(query(orders, where('orderStatus', 'in', finishedOrderStatuses))),
      ]);
      return { success: true, data: { active: active.data().count, finished: finished.data().count } };
    } catch (error) { return { success: false, ...messageFor(error, 'تعذر تحميل أعداد الطلبات.') }; }
  },
  async get<T extends { id: string }>(companyId: string, name: CompanyCollection, id: string): Promise<DataOperationResult<T>> {
    try {
      const path = firestorePaths[name](companyId); warnOnTenantRootCollection(path);
      const snapshot = await getDoc(doc(db, path, id));
      if (!snapshot.exists()) return { success: false, code: 'NOT_FOUND', message: 'لم يتم العثور على السجل.' };
      return { success: true, data: { id: snapshot.id, ...snapshot.data() } as T };
    } catch (error) { return { success: false, ...messageFor(error, 'تعذر تحميل السجل.') }; }
  },
  /**
   * Fetches one server-filtered page instead of opening a listener for the
   * entire orders collection. Text search remains client-side because
   * Firestore has no safe arbitrary-substring query.
   */
  async getOrderPage<T extends { id: string }>(companyId: string, request: OrderPageRequest): Promise<DataOperationResult<PageResult<T>>> {
    try {
      const pageSize = safePageSize(request.pageSize);
      const constraints: QueryConstraint[] = [];
      const dateField = request.dateField || 'eventDate';

      if (request.scope === 'archived') {
        constraints.push(where('archivedAt', '>', ''), orderBy('archivedAt', 'desc'));
      } else {
        if (request.status) constraints.push(where('orderStatus', '==', request.status));
        else if (request.scope !== 'all') {
          const statuses = request.scope === 'active' ? activeOrderStatuses : finishedOrderStatuses;
          constraints.push(where('orderStatus', 'in', statuses));
        }
        if (request.paymentStatus) constraints.push(where('paymentStatus', '==', request.paymentStatus));
        if (request.dateFrom) constraints.push(where(dateField, '>=', request.dateFrom));
        if (request.dateTo) constraints.push(where(dateField, '<=', request.dateTo));
        constraints.push(orderBy(dateField, request.scope === 'active' ? 'asc' : 'desc'));
      }
      if (request.cursor) constraints.push(startAfter(request.cursor));
      constraints.push(limit(pageSize + 1));
      const snapshot = await getDocs(query(collection(db, firestorePaths.orders(companyId)), ...constraints));
      return { success: true, data: pageResult<T>(snapshot.docs, pageSize) };
    } catch (error) {
      if (isIndexUnavailable(error)) {
        try {
          return {
            success: true,
            data: await getOrderPageWhileIndexBuilds<T>(companyId, request),
            message: 'يتم تجهيز فهارس البحث. تم عرض نتائج مؤقتة.',
          };
        } catch (fallbackError) {
          return { success: false, ...messageFor(fallbackError, 'تعذر تحميل صفحة الطلبات.') };
        }
      }
      return { success: false, ...messageFor(error, 'تعذر تحميل صفحة الطلبات.') };
    }
  },
  /** The activity log always starts newest-first and can be extended on demand. */
  async getActivityLogPage<T extends { id: string }>(companyId: string, request: ActivityLogPageRequest = {}): Promise<DataOperationResult<PageResult<T>>> {
    try {
      const pageSize = safePageSize(request.pageSize);
      const constraints: QueryConstraint[] = [];
      if (request.action) constraints.push(where('action', '==', request.action));
      if (request.from) constraints.push(where('timestamp', '>=', Timestamp.fromDate(new Date(`${request.from}T00:00:00.000Z`))));
      if (request.to) constraints.push(where('timestamp', '<=', Timestamp.fromDate(new Date(`${request.to}T23:59:59.999Z`))));
      constraints.push(orderBy('timestamp', 'desc'));
      if (request.cursor) constraints.push(startAfter(request.cursor));
      constraints.push(limit(pageSize + 1));
      const snapshot = await getDocs(query(collection(db, firestorePaths.activityLogs(companyId)), ...constraints));
      return { success: true, data: pageResult<T>(snapshot.docs, pageSize) };
    } catch (error) { return { success: false, ...messageFor(error, 'تعذر تحميل صفحة سجل النشاط.') }; }
  },
  /** A short realtime window is enough for dashboard operations; historical pages use getOrderPage. */
  subscribeLatest<T extends { id: string }>(companyId: string, name: CompanyCollection, next: (records: T[]) => void, fail: (result: DataOperationResult<never>) => void, options: { orderByField: string; direction?: 'asc' | 'desc'; pageSize: number; equalTo?: { field: string; value: string }; from?: { field: string; value: string } }): Unsubscribe {
    const path = firestorePaths[name](companyId); warnOnTenantRootCollection(path);
    const constraints: QueryConstraint[] = [];
    if (options.equalTo) constraints.push(where(options.equalTo.field, '==', options.equalTo.value));
    if (options.from) constraints.push(where(options.from.field, '>=', options.from.value));
    constraints.push(orderBy(options.orderByField, options.direction || 'desc'), limit(safePageSize(options.pageSize)));
    return onSnapshot(query(collection(db, path), ...constraints), snapshot => {
      next(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as T)));
    }, (error) => fail({ success: false, ...messageFor(error, 'تعذر تحميل البيانات.') }));
  },
  async loadWorkerOrders<T extends { id: string }>(): Promise<DataOperationResult<T[]>> {
    try {
      const response = await httpsCallable<Record<string, never>, { success: boolean; code: string; message?: string; orders?: T[] }>(functions, 'getWorkerOrders')({});
      return response.data.success ? { success: true, data: response.data.orders || [] } : { success: false, code: response.data.code === 'UNAUTHORIZED' ? 'UNAUTHENTICATED' : 'PERMISSION_DENIED', message: response.data.message || 'تعذر تحميل الطلبات.' };
    } catch (error) { return { success: false, ...messageFor(error, 'تعذر تحميل الطلبات.') }; }
  },
  subscribeWorkerOrders<T extends { id: string; workerId?: string; workerCanContactCustomer?: boolean; customerPhone: string }>(input: WorkerOrdersListenerInput, next: (records: T[]) => void, fail: (result: DataOperationResult<never>) => void): Unsubscribe {
    const companyId = nonBlank(input.companyId);
    const workerId = nonBlank(input.workerId);
    const sessionUid = nonBlank(input.session?.uid);
    const currentAuthUid = nonBlank(auth.currentUser?.uid);
    const queryDetails = workerOrdersQueryDetails(companyId, workerId);
    const sessionMatchesFirebaseAuth = Boolean(sessionUid && currentAuthUid && sessionUid === currentAuthUid);
    if (!workerOrdersListenerInputReady({ ...input, companyId, workerId }) || !sessionMatchesFirebaseAuth) {
      workerOrdersDebug('listener skipped: prerequisites not ready', {
        companyId: companyId || null,
        workerId: workerId || null,
        sessionPresent: Boolean(input.session),
        sessionUid: sessionUid || null,
        currentAuthUid: currentAuthUid || null,
        sessionMatchesFirebaseAuth,
        sessionRole: input.session?.role || null,
        sessionMemberStatus: input.session?.memberStatus || null,
        ...queryDetails,
      });
      return () => undefined;
    }
    const safeOrders = new Map<string, Omit<T, 'customerPhone'>>();
    const contacts = new Map<string, string>();
    const contactUnsubscribes = new Map<string, Unsubscribe>();
    const workerOrdersPath = firestorePaths.workerOrders(companyId);
    const workerOrderContactsPath = firestorePaths.workerOrderContacts(companyId);
    let stopped = false;
    const emit = () => next([...safeOrders.values()].map(order => mergeWorkerContact(order, contacts.get(order.id)) as T));
    const stopContact = (orderId: string) => {
      contactUnsubscribes.get(orderId)?.();
      contactUnsubscribes.delete(orderId);
      contacts.delete(orderId);
    };
    // Do not replace `source` with the bare collection: worker rules require this exact filter.
    const source = query(collection(db, workerOrdersPath), where('workerId', '==', workerId));
    workerOrdersDebug('listener creating', {
      companyId,
      workerId,
      sessionUid,
      currentAuthUid,
      sessionMatchesFirebaseAuth,
      workerOrdersPath,
      workerOrderContactsPath,
      ...queryDetails,
    });
    const unsubscribeOrders = onSnapshot(source, snapshot => {
      const activeIds = new Set(snapshot.docs.map(item => item.id));
      for (const id of safeOrders.keys()) if (!activeIds.has(id)) { safeOrders.delete(id); stopContact(id); }
      for (const item of snapshot.docs) {
        const order = { id: item.id, ...item.data() } as Omit<T, 'customerPhone'>;
        safeOrders.set(item.id, order);
        const contactPath = firestorePaths.workerOrderContact(companyId, item.id);
        workerContactDebug('worker order snapshot', {
          orderId: item.id, workerId, assignedWorkerId: order.workerId || null,
          workerCanContactCustomer: order.workerCanContactCustomer === true,
          workerOrderContactsPath: contactPath, contactDocumentExists: contacts.has(item.id),
        });
        if (order.workerCanContactCustomer === true && !contactUnsubscribes.has(item.id)) {
          const unsubscribeContact = onSnapshot(doc(db, contactPath), contactSnapshot => {
            const phone = contactSnapshot.exists() ? contactSnapshot.data().customerPhone : '';
            if (typeof phone === 'string' && phone) contacts.set(item.id, phone);
            else contacts.delete(item.id);
            workerContactDebug('worker contact snapshot', {
              orderId: item.id, workerId, assignedWorkerId: order.workerId || null,
              workerCanContactCustomer: order.workerCanContactCustomer === true,
              workerOrderContactsPath: contactPath, contactDocumentExists: contactSnapshot.exists(),
            });
            emit();
          }, error => {
            // Atomic revocation normally arrives as an empty contact snapshot.
            // If a stale document is denied instead, wait one event turn for
            // workerOrders before deciding whether it is expected; every other
            // denied path is surfaced to the caller.
            contactUnsubscribes.delete(item.id);
            contacts.delete(item.id);
            emit();
            const handleError = () => {
              if (stopped) return;
              const currentOrder = safeOrders.get(item.id);
              const permissionDenied = firebaseErrorCode(error).includes('permission-denied');
              const expectedRevocation = permissionDenied && currentOrder?.workerCanContactCustomer !== true;
              workerContactDebug(expectedRevocation ? 'expected contact access revoked' : 'worker contact listener failed', {
                orderId: item.id, workerId, assignedWorkerId: currentOrder?.workerId || order.workerId || null,
                workerCanContactCustomer: currentOrder?.workerCanContactCustomer === true,
                workerOrderContactsPath: contactPath, contactDocumentExists: false,
                firebaseErrorCode: firebaseErrorCode(error), rejectedPath: contactPath,
              });
              if (!expectedRevocation) fail({ success: false, ...messageFor(error, 'تعذر تحميل بيانات اتصال العميلة.') });
            };
            if (firebaseErrorCode(error).includes('permission-denied')) setTimeout(handleError, 0);
            else handleError();
          });
          contactUnsubscribes.set(item.id, unsubscribeContact);
        } else if (order.workerCanContactCustomer !== true) {
          stopContact(item.id);
        }
      }
      emit();
    }, error => {
      workerOrdersDebug('listener failed', {
        companyId,
        workerId,
        sessionUid,
        currentAuthUid,
        workerOrdersPath,
        workerOrderContactsPath,
        firebaseErrorCode: firebaseErrorCode(error),
        rejectedPath: workerOrdersPath,
        ...queryDetails,
      });
      fail({ success: false, ...messageFor(error, 'تعذر تحميل الطلبات المسندة.') });
    });
    return () => { stopped = true; unsubscribeOrders(); contactUnsubscribes.forEach(unsubscribe => unsubscribe()); contactUnsubscribes.clear(); contacts.clear(); safeOrders.clear(); };
  },
  /** Reads the same nested collection written by recordWorkerMovement. */
  subscribeOrderWorkerMovements<T extends { id: string }>(companyId: string, orderId: string, workerId: string | undefined, next: (records: T[]) => void, fail: (result: DataOperationResult<never>) => void): Unsubscribe {
    const path = firestorePaths.workerMovements(companyId, orderId);
    const source = collection(db, path);
    // Worker rules require this exact identity constraint; managers read the
    // complete movement history for a single order.
    const restricted = workerId ? query(source, where('workerId', '==', workerId)) : source;
    return onSnapshot(restricted, snapshot => next(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as T))), error => fail({ success: false, ...messageFor(error, 'تعذر تحميل سجل تحركات المنفذ.') }));
  },
  subscribe<T extends { id: string }>(companyId: string, name: CompanyCollection, next: (records: T[]) => void, fail: (result: DataOperationResult<never>) => void, equalTo?: { field: string; value: string }): Unsubscribe {
    const path = firestorePaths[name](companyId); warnOnTenantRootCollection(path);
    const source = collection(db, path);
    return onSnapshot(equalTo ? query(source, where(equalTo.field, '==', equalTo.value)) : source, (snapshot) => {
      next(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as T)));
    }, (error) => fail({ success: false, ...messageFor(error, 'تعذر تحميل البيانات.') }));
  },
  subscribeSettings<T>(companyId: string, next: (value: T | null) => void, fail: (result: DataOperationResult<never>) => void): Unsubscribe {
    const path = firestorePaths.settings(companyId); warnOnTenantRootCollection(path);
    return onSnapshot(doc(db, path), (snapshot) => next(snapshot.exists() ? snapshot.data() as T : null), (error) => fail({ success: false, ...messageFor(error, 'تعذر تحميل الإعدادات.') }));
  },
  async set<T>(companyId: string, name: CompanyCollection, id: string, value: T, merge = false): Promise<DataOperationResult<T>> {
    try { const path = firestorePaths[name](companyId); warnOnTenantRootCollection(path); await setDoc(doc(db, path, id), value as object, { merge }); return { success: true, data: value }; }
    catch (error) { return { success: false, ...messageFor(error, 'تعذر حفظ البيانات.'), code: 'WRITE_FAILED' }; }
  },
  async remove(companyId: string, name: CompanyCollection, id: string): Promise<DataOperationResult<void>> {
    try { const path = firestorePaths[name](companyId); warnOnTenantRootCollection(path); await deleteDoc(doc(db, path, id)); return { success: true }; }
    catch (error) { return { success: false, ...messageFor(error, 'تعذر حذف البيانات.'), code: 'DELETE_FAILED' }; }
  },
  async setSettings<T>(companyId: string, value: T): Promise<DataOperationResult<T>> {
    try { const path = firestorePaths.settings(companyId); warnOnTenantRootCollection(path); await setDoc(doc(db, path), value as object, { merge: true }); return { success: true, data: value }; }
    catch (error) { return { success: false, ...messageFor(error, 'تعذر حفظ الإعدادات.'), code: 'WRITE_FAILED' }; }
  },
};

export const makeDataError = (code: DataErrorCode, message: string): DataOperationResult<never> => ({ success: false, code, message });
