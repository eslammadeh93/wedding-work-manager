import { doc, runTransaction, type DocumentSnapshot } from 'firebase/firestore';
import type { Customer, InventoryItem, Order, OrderItemReservation } from '../../types';
import { db } from '../../firebase/config';
import { firestorePaths } from '../firestorePaths';
import { calculateReservationUpdates, normalizedReservations, OrderInventoryError } from './orderInventoryMath';
import type { DataOperationResult } from './companyDataService';
import { deletionMetadata } from '../../utils/recycleBin';

type OrderMutationResult = DataOperationResult<{ id: string }>;
const messageFor = (code: string) => ({
  INVALID_QUANTITY: 'كمية المخزون يجب أن تكون رقماً صحيحاً أكبر من صفر.', INVENTORY_NOT_FOUND: 'تعذر العثور على عنصر المخزون المطلوب.',
  CROSS_TENANT_INVENTORY: 'عنصر المخزون لا يتبع الشركة الحالية.', INSUFFICIENT_STOCK: 'الكمية المطلوبة غير متاحة في المخزون.',
  INVENTORY_INVARIANT: 'بيانات المخزون غير صالحة ولا يمكن تنفيذ العملية بأمان.', ORDER_NOT_FOUND: 'لم يتم العثور على الطلب.',
  ORDER_ALREADY_DELETED: 'هذا الطلب حُذف بالفعل.', ORDER_STALE: 'تم تعديل الطلب من مستخدم آخر. حدّث الصفحة ثم حاول مرة أخرى.', CUSTOMER_NOT_FOUND: 'العميل المحدد لا يتبع الشركة الحالية.',
  CONFLICT: 'حدث تعارض متزامن. حاول مرة أخرى.', PERMISSION_DENIED: 'ليس لديك صلاحية لتنفيذ هذه العملية.', NETWORK_ERROR: 'انقطع الاتصال. حاول مرة أخرى.', UNKNOWN_ERROR: 'تعذر تنفيذ عملية الطلب والمخزون.',
} as Record<string, string>)[code] || 'تعذر تنفيذ عملية الطلب والمخزون.';

const failed = (error: unknown): OrderMutationResult => {
  if (error instanceof OrderInventoryError) return { success: false, code: error.code, message: error.message, error };
  const firebaseCode = String((error as { code?: string })?.code || '');
  const code = firebaseCode.includes('aborted') || firebaseCode.includes('failed-precondition') ? 'CONFLICT'
    : firebaseCode.includes('permission-denied') ? 'PERMISSION_DENIED'
    : firebaseCode.includes('unavailable') || firebaseCode.includes('network') ? 'NETWORK_ERROR' : 'UNKNOWN_ERROR';
  return { success: false, code, message: messageFor(code), error };
};

const inventoryRefs = (companyId: string, items: readonly OrderItemReservation[]) => [...new Set(items.map((item) => item.inventoryItemId))].map((id) => doc(db, firestorePaths.inventoryItem(companyId, id)));
const inventoryMap = (snapshots: readonly DocumentSnapshot[]) => new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.exists() ? ({ id: snapshot.id, ...(snapshot.data() || {}) } as InventoryItem) : undefined]));

export const orderInventoryTransaction = {
  async create(companyId: string, order: Order, newCustomer?: Customer): Promise<OrderMutationResult> {
    try {
      await runTransaction(db, async (transaction) => {
        const reservedItems = normalizedReservations(order.reservedItems);
        const refs = inventoryRefs(companyId, reservedItems);
        const orderRef = doc(db, firestorePaths.order(companyId, order.id));
        const customerRef = doc(db, firestorePaths.customer(companyId, order.customerId));
        const [existingOrder, ...snapshots] = await Promise.all([transaction.get(orderRef), ...refs.map((ref) => transaction.get(ref)), transaction.get(customerRef)]);
        if (existingOrder.exists()) throw new OrderInventoryError('ORDER_STALE', messageFor('ORDER_STALE'));
        const customerSnapshot = snapshots.pop();
        if (!customerSnapshot) throw new OrderInventoryError('CUSTOMER_NOT_FOUND', messageFor('CUSTOMER_NOT_FOUND'));
        if (newCustomer) {
          if (newCustomer.id !== order.customerId || newCustomer.companyId !== companyId || customerSnapshot.exists()) throw new OrderInventoryError('ORDER_STALE', messageFor('ORDER_STALE'));
        } else if (!customerSnapshot.exists()) {
          throw new OrderInventoryError('CUSTOMER_NOT_FOUND', messageFor('CUSTOMER_NOT_FOUND'));
        }
        const updates = calculateReservationUpdates(inventoryMap(snapshots), [], reservedItems, companyId);
        for (const ref of refs) transaction.update(ref, { ...updates.get(ref.id), updatedAt: order.updatedAt });
        if (newCustomer) transaction.set(customerRef, newCustomer);
        else {
          const existingCustomer = customerSnapshot.data() as Customer;
          const orderIds = [...new Set([...(existingCustomer.orderIds || []), order.id])];
          if (orderIds.length !== (existingCustomer.orderIds || []).length) transaction.update(customerRef, { orderIds, updatedAt: order.updatedAt });
        }
        transaction.set(orderRef, { ...order, reservedItems });
      });
      return { success: true, data: { id: order.id } };
    } catch (error) { return failed(error); }
  },
  async update(companyId: string, orderId: string, patch: Partial<Order>, expectedUpdatedAt: string | undefined): Promise<OrderMutationResult> {
    try {
      await runTransaction(db, async (transaction) => {
        const orderRef = doc(db, firestorePaths.order(companyId, orderId));
        const currentSnapshot = await transaction.get(orderRef);
        if (!currentSnapshot.exists()) throw new OrderInventoryError('ORDER_NOT_FOUND', messageFor('ORDER_NOT_FOUND'));
        const current = { id: currentSnapshot.id, ...currentSnapshot.data() } as Order;
        if (current.deletedAt) throw new OrderInventoryError('ORDER_ALREADY_DELETED', messageFor('ORDER_ALREADY_DELETED'));
        if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) throw new OrderInventoryError('ORDER_STALE', messageFor('ORDER_STALE'));
        const reservedItems = normalizedReservations(patch.reservedItems ?? current.reservedItems);
        const refs = inventoryRefs(companyId, [...(current.reservedItems || []), ...reservedItems]);
        const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        const updates = calculateReservationUpdates(inventoryMap(snapshots), current.reservedItems, reservedItems, companyId);
        for (const ref of refs) transaction.update(ref, { ...updates.get(ref.id), updatedAt: patch.updatedAt });
        transaction.update(orderRef, { ...patch, reservedItems });
      });
      return { success: true, data: { id: orderId } };
    } catch (error) { return failed(error); }
  },
  async remove(companyId: string, orderId: string): Promise<OrderMutationResult> {
    try {
      await runTransaction(db, async (transaction) => {
        const orderRef = doc(db, firestorePaths.order(companyId, orderId));
        const currentSnapshot = await transaction.get(orderRef);
        if (!currentSnapshot.exists()) throw new OrderInventoryError('ORDER_ALREADY_DELETED', messageFor('ORDER_ALREADY_DELETED'));
        const current = { id: currentSnapshot.id, ...currentSnapshot.data() } as Order;
        if (current.deletedAt) throw new OrderInventoryError('ORDER_ALREADY_DELETED', messageFor('ORDER_ALREADY_DELETED'));
        const refs = inventoryRefs(companyId, current.reservedItems || []);
        const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        const updates = calculateReservationUpdates(inventoryMap(snapshots), current.reservedItems, [], companyId);
        for (const ref of refs) transaction.update(ref, { ...updates.get(ref.id), updatedAt: new Date().toISOString() });
        transaction.update(orderRef, { ...deletionMetadata(), updatedAt: new Date().toISOString() });
      });
      return { success: true, data: { id: orderId } };
    } catch (error) { return failed(error); }
  },
  async restore(companyId: string, orderId: string): Promise<OrderMutationResult> {
    try {
      await runTransaction(db, async (transaction) => {
        const orderRef = doc(db, firestorePaths.order(companyId, orderId));
        const currentSnapshot = await transaction.get(orderRef);
        if (!currentSnapshot.exists()) throw new OrderInventoryError('ORDER_NOT_FOUND', messageFor('ORDER_NOT_FOUND'));
        const current = { id: currentSnapshot.id, ...currentSnapshot.data() } as Order;
        if (!current.deletedAt) throw new OrderInventoryError('ORDER_STALE', messageFor('ORDER_STALE'));
        const refs = inventoryRefs(companyId, current.reservedItems || []);
        const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        const updates = calculateReservationUpdates(inventoryMap(snapshots), [], current.reservedItems, companyId);
        for (const ref of refs) transaction.update(ref, { ...updates.get(ref.id), updatedAt: new Date().toISOString() });
        transaction.update(orderRef, { deletedAt: null, purgeAt: null, updatedAt: new Date().toISOString() });
      });
      return { success: true, data: { id: orderId } };
    } catch (error) { return failed(error); }
  },
};
