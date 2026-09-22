import { doc, runTransaction, type DocumentSnapshot } from 'firebase/firestore';
import type { Customer, InventoryItem, Order, OrderItemReservation } from '../../types';
import { db } from '../../firebase/config';
import { firestorePaths } from '../firestorePaths';
import { calculateReservationUpdates, normalizedReservations, OrderInventoryError } from './orderInventoryMath';
import type { DataOperationResult } from './companyDataService';
import { deletionMetadata } from '../../utils/recycleBin';
import { cancellationMetadata, orderRetentionMetadata } from '../../utils/financialRetention';
import { orderVersionsMatch } from './orderVersion';
import { resolveOrderPaymentState, type OrderPaymentIntent } from '../../utils/orderPaymentState';
import { assertValidOrderFinancials, FinancialValidationError } from '../../utils/financialValidation';

type OrderMutationResult = DataOperationResult<{ id: string }>;
type OrderFinancialMutationResult = DataOperationResult<{ id: string; patch?: Partial<Order> }>;
const messageFor = (code: string) => ({
  INVALID_QUANTITY: 'كمية المخزون يجب أن تكون رقماً صحيحاً أكبر من صفر.', INVENTORY_NOT_FOUND: 'تعذر العثور على عنصر المخزون المطلوب.',
  CROSS_TENANT_INVENTORY: 'عنصر المخزون لا يتبع الشركة الحالية.', INSUFFICIENT_STOCK: 'الكمية المطلوبة غير متاحة في المخزون.',
  INVENTORY_INVARIANT: 'بيانات المخزون غير صالحة ولا يمكن تنفيذ العملية بأمان.', ORDER_NOT_FOUND: 'لم يتم العثور على الطلب.',
  ORDER_ALREADY_DELETED: 'هذا الطلب حُذف بالفعل.', ORDER_STALE: 'تم تعديل الطلب من مستخدم آخر. حدّث الصفحة ثم حاول مرة أخرى.', CUSTOMER_NOT_FOUND: 'العميل المحدد لا يتبع الشركة الحالية.',
  CONFLICT: 'حدث تعارض متزامن. حاول مرة أخرى.', PERMISSION_DENIED: 'ليس لديك صلاحية لتنفيذ هذه العملية.', NETWORK_ERROR: 'انقطع الاتصال. حاول مرة أخرى.', UNKNOWN_ERROR: 'تعذر تنفيذ عملية الطلب والمخزون.',
} as Record<string, string>)[code] || 'تعذر تنفيذ عملية الطلب والمخزون.';

const failed = (error: unknown): OrderMutationResult => {
  if (error instanceof OrderInventoryError) return { success: false, code: error.code, message: error.message, error };
  if (error instanceof FinancialValidationError) return { success: false, code: 'VALIDATION_ERROR', message: error.message, error };
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
  /**
   * `patch` carries only non-financial fields. The paid total is always
   * derived inside the transaction from the stored record plus `paymentIntent`
   * so two screens can never disagree about how much was collected.
   */
  async update(companyId: string, orderId: string, patch: Partial<Order>, expectedUpdatedAt: string | undefined, paymentIntent?: OrderPaymentIntent): Promise<OrderMutationResult> {
    try {
      await runTransaction(db, async (transaction) => {
        const orderRef = doc(db, firestorePaths.order(companyId, orderId));
        const currentSnapshot = await transaction.get(orderRef);
        if (!currentSnapshot.exists()) throw new OrderInventoryError('ORDER_NOT_FOUND', messageFor('ORDER_NOT_FOUND'));
        const current = { id: currentSnapshot.id, ...currentSnapshot.data() } as Order;
        if (current.deletedAt) throw new OrderInventoryError('ORDER_ALREADY_DELETED', messageFor('ORDER_ALREADY_DELETED'));
        if (expectedUpdatedAt && !orderVersionsMatch(expectedUpdatedAt, current.updatedAt)) throw new OrderInventoryError('ORDER_STALE', messageFor('ORDER_STALE'));
        const financial = paymentIntent ? resolveOrderPaymentState(current, paymentIntent) : undefined;
        // `current` is passed so a legacy fractional figure this write is not
        // touching does not block an otherwise valid edit.
        if (financial) assertValidOrderFinancials({ ...patch, ...financial }, current);
        const reservedItems = normalizedReservations(patch.reservedItems ?? current.reservedItems);
        const refs = inventoryRefs(companyId, [...(current.reservedItems || []), ...reservedItems]);
        const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
        const updates = calculateReservationUpdates(inventoryMap(snapshots), current.reservedItems, reservedItems, companyId);
        for (const ref of refs) transaction.update(ref, { ...updates.get(ref.id), updatedAt: patch.updatedAt });
        // Recognition is stamped once and never cleared: from here on the
        // fulfillment costs stay recognized even if the order is later moved
        // to `returned`.
        const recognition = patch.orderStatus === 'completed' && !current.fulfillmentRecognizedAt
          ? { fulfillmentRecognizedAt: new Date().toISOString() }
          : {};
        const cancellation = cancellationMetadata(current, patch.orderStatus);
        transaction.update(orderRef, { ...patch, ...(financial || {}), ...recognition, ...cancellation, reservedItems });
      });
      return { success: true, data: { id: orderId } };
    } catch (error) { return failed(error); }
  },
  /**
   * Applies a purely financial change against the order as it exists inside
   * the transaction.  Payment mutations must never be computed from a cached
   * copy of the order: another user may have recorded a payment in between.
   * `expectedUpdatedAt` is supplied only by long-lived editors, so a stale
   * form fails instead of overwriting newer financial changes.
   */
  async mutateFinancial(companyId: string, orderId: string, mutate: (current: Order) => Partial<Order> | null, expectedUpdatedAt?: string): Promise<OrderFinancialMutationResult> {
    let applied: Partial<Order> | undefined;
    try {
      await runTransaction(db, async (transaction) => {
        applied = undefined;
        const orderRef = doc(db, firestorePaths.order(companyId, orderId));
        const currentSnapshot = await transaction.get(orderRef);
        if (!currentSnapshot.exists()) throw new OrderInventoryError('ORDER_NOT_FOUND', messageFor('ORDER_NOT_FOUND'));
        const current = { id: currentSnapshot.id, ...currentSnapshot.data() } as Order;
        if (current.deletedAt) throw new OrderInventoryError('ORDER_ALREADY_DELETED', messageFor('ORDER_ALREADY_DELETED'));
        if (expectedUpdatedAt && !orderVersionsMatch(expectedUpdatedAt, current.updatedAt)) throw new OrderInventoryError('ORDER_STALE', messageFor('ORDER_STALE'));
        const patch = mutate(current);
        // A no-op (for example a retried payment that already exists) must not
        // bump the version and invalidate other open editors.
        if (!patch) return;
        applied = { ...patch, updatedAt: new Date().toISOString() };
        transaction.update(orderRef, applied);
      });
      return { success: true, data: { id: orderId, patch: applied } };
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
        // Deleting is an operational action. An order that carries posted
        // financial history is marked retained so it leaves the screens but
        // stays in accounting datasets, and the purge job skips it.
        transaction.update(orderRef, { ...deletionMetadata(), ...orderRetentionMetadata(current), updatedAt: new Date().toISOString() });
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
