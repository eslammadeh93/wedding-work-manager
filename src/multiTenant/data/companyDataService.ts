import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where, type Unsubscribe } from 'firebase/firestore';
import { auth, db, functions } from '../../firebase/config';
import { httpsCallable } from 'firebase/functions';
import { firestorePaths } from '../firestorePaths';
import { mergeWorkerContact } from '../../utils/workerContact';
import type { AuthSession } from '../types';

export type CompanyCollection = 'orders' | 'customers' | 'workers' | 'inventory' | 'expenses' | 'categories' | 'activityLogs' | 'notifications';
export type DataErrorCode = 'UNAUTHENTICATED' | 'NO_COMPANY_CONTEXT' | 'PERMISSION_DENIED' | 'NETWORK_ERROR' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT' | 'WRITE_FAILED' | 'DELETE_FAILED' | 'INVALID_QUANTITY' | 'INVENTORY_NOT_FOUND' | 'CROSS_TENANT_INVENTORY' | 'INSUFFICIENT_STOCK' | 'INVENTORY_INVARIANT' | 'ORDER_NOT_FOUND' | 'ORDER_ALREADY_DELETED' | 'ORDER_STALE' | 'UNKNOWN_ERROR';
export interface DataOperationResult<T> { success: boolean; data?: T; code?: DataErrorCode; message?: string; error?: unknown; }
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

/** All tenant operational paths are constructed here, never in UI components. */
export const companyDataService = {
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
