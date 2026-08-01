import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where, type Unsubscribe } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { firestorePaths } from '../firestorePaths';

export type CompanyCollection = 'orders' | 'customers' | 'workers' | 'inventory' | 'expenses' | 'categories' | 'activityLogs' | 'notifications';
export type DataErrorCode = 'UNAUTHENTICATED' | 'NO_COMPANY_CONTEXT' | 'PERMISSION_DENIED' | 'NETWORK_ERROR' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT' | 'WRITE_FAILED' | 'DELETE_FAILED' | 'UNKNOWN_ERROR';
export interface DataOperationResult<T> { success: boolean; data?: T; code?: DataErrorCode; message?: string; error?: unknown; }
const ROOT_COLLECTIONS = new Set(['users', 'orders', 'customers', 'workers', 'inventory', 'expenses', 'categories', 'activityLogs', 'settings']);

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
