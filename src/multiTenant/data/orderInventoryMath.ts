import type { InventoryItem, OrderItemReservation } from '../../types';

export type OrderInventoryErrorCode =
  | 'INVALID_QUANTITY'
  | 'INVENTORY_NOT_FOUND'
  | 'CROSS_TENANT_INVENTORY'
  | 'INSUFFICIENT_STOCK'
  | 'INVENTORY_INVARIANT'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_ALREADY_DELETED'
  | 'ORDER_STALE';

export class OrderInventoryError extends Error {
  constructor(public readonly code: OrderInventoryErrorCode, message: string) { super(message); this.name = 'OrderInventoryError'; }
}

export type InventoryReservationUpdate = Pick<InventoryItem, 'reservedQuantity' | 'availableQuantity'>;

const invalidQuantity = () => new OrderInventoryError('INVALID_QUANTITY', 'كمية المخزون يجب أن تكون رقماً صحيحاً أكبر من صفر.');

/** Merges duplicate lines before any stock calculation. */
export function reservationQuantities(items: readonly OrderItemReservation[] | undefined): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const item of items || []) {
    if (!item || typeof item.inventoryItemId !== 'string' || !item.inventoryItemId || item.inventoryItemId.includes('/') || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw invalidQuantity();
    quantities.set(item.inventoryItemId, (quantities.get(item.inventoryItemId) || 0) + item.quantity);
  }
  return quantities;
}

export function normalizedReservations(items: readonly OrderItemReservation[] | undefined): OrderItemReservation[] {
  const quantities = reservationQuantities(items);
  const names = new Map((items || []).map((item) => [item.inventoryItemId, item.inventoryItemName]));
  return [...quantities].map(([inventoryItemId, quantity]) => ({ inventoryItemId, inventoryItemName: names.get(inventoryItemId) || '', quantity }));
}

/**
 * Produces the affected document updates only. The caller supplies documents read
 * in the same Firestore transaction, so concurrent retries always recalculate
 * from the latest committed reservation totals.
 */
export function calculateReservationUpdates(
  inventory: ReadonlyMap<string, InventoryItem | undefined>,
  oldItems: readonly OrderItemReservation[] | undefined,
  newItems: readonly OrderItemReservation[] | undefined,
  companyId: string,
): Map<string, InventoryReservationUpdate> {
  const oldQuantities = reservationQuantities(oldItems);
  const newQuantities = reservationQuantities(newItems);
  const ids = new Set([...oldQuantities.keys(), ...newQuantities.keys()]);
  const updates = new Map<string, InventoryReservationUpdate>();

  for (const id of ids) {
    const item = inventory.get(id);
    if (!item) throw new OrderInventoryError('INVENTORY_NOT_FOUND', 'تعذر العثور على عنصر المخزون المطلوب.');
    if (item.companyId !== undefined && item.companyId !== companyId) throw new OrderInventoryError('CROSS_TENANT_INVENTORY', 'عنصر المخزون لا يتبع الشركة الحالية.');

    const total = item.totalQuantity ?? item.quantity;
    const reserved = item.reservedQuantity;
    const available = item.availableQuantity;
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(reserved) || !Number.isSafeInteger(available) || total < 0 || reserved < 0 || available < 0 || reserved > total || available !== total - reserved) {
      throw new OrderInventoryError('INVENTORY_INVARIANT', 'بيانات المخزون غير صالحة ولا يمكن تنفيذ الحجز بأمان.');
    }

    const nextReserved = reserved + (newQuantities.get(id) || 0) - (oldQuantities.get(id) || 0);
    if (nextReserved < 0 || nextReserved > total) {
      throw new OrderInventoryError(nextReserved > total ? 'INSUFFICIENT_STOCK' : 'INVENTORY_INVARIANT', nextReserved > total ? 'الكمية المطلوبة غير متاحة في المخزون.' : 'لا يمكن إرجاع كمية أكبر من الكمية المحجوزة.');
    }
    updates.set(id, { reservedQuantity: nextReserved, availableQuantity: total - nextReserved });
  }
  return updates;
}
