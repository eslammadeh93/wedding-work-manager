import assert from 'node:assert/strict';
import test from 'node:test';
import type { InventoryItem, OrderItemReservation } from '../src/types';
import { calculateReservationUpdates, OrderInventoryError, reservationQuantities } from '../src/multiTenant/data/orderInventoryMath';

const item = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({ id: 'chairs', companyId: 'company-a', itemCode: 'CHAIR', nameEn: 'Chair', nameAr: 'كرسي', category: 'furniture', quantity: 5, totalQuantity: 5, reservedQuantity: 0, availableQuantity: 5, minStockLevel: 0, storageLocation: 'A', condition: 'good', createdAt: '', updatedAt: '', ...overrides });
const reservation = (id: string, quantity: number): OrderItemReservation => ({ inventoryItemId: id, inventoryItemName: id, quantity });
const updates = (stock: InventoryItem, oldItems: OrderItemReservation[] = [], newItems: OrderItemReservation[] = []) => calculateReservationUpdates(new Map([[stock.id, stock]]), oldItems, newItems, 'company-a').get(stock.id)!;
const code = (fn: () => unknown) => { try { fn(); assert.fail('Expected an error'); } catch (error) { assert.ok(error instanceof OrderInventoryError); return error.code; } };

test('successful reservation merges duplicate items', () => assert.deepEqual(updates(item(), [], [reservation('chairs', 2), reservation('chairs', 1)]), { reservedQuantity: 3, availableQuantity: 2 }));
test('insufficient inventory leaves no computed update', () => assert.equal(code(() => updates(item(), [], [reservation('chairs', 6)])), 'INSUFFICIENT_STOCK'));
test('two users cannot reserve the last unit from the same committed stock', () => {
  const afterFirst = updates(item({ quantity: 1, totalQuantity: 1, availableQuantity: 1 }), [], [reservation('chairs', 1)]);
  assert.equal(code(() => updates(item({ quantity: 1, totalQuantity: 1, ...afterFirst }), [], [reservation('chairs', 1)])), 'INSUFFICIENT_STOCK');
});
test('editing reserves only an increase', () => assert.deepEqual(updates(item({ reservedQuantity: 2, availableQuantity: 3 }), [reservation('chairs', 2)], [reservation('chairs', 4)]), { reservedQuantity: 4, availableQuantity: 1 }));
test('editing returns a decrease and removing an item returns all stock', () => {
  assert.deepEqual(updates(item({ reservedQuantity: 4, availableQuantity: 1 }), [reservation('chairs', 4)], [reservation('chairs', 1)]), { reservedQuantity: 1, availableQuantity: 4 });
  assert.deepEqual(updates(item({ reservedQuantity: 2, availableQuantity: 3 }), [reservation('chairs', 2)]), { reservedQuantity: 0, availableQuantity: 5 });
});
test('adding a new item affects that item only', () => {
  const chair = item(), table = item({ id: 'tables', quantity: 2, totalQuantity: 2, availableQuantity: 2 });
  const result = calculateReservationUpdates(new Map([['chairs', chair], ['tables', table]]), [reservation('chairs', 1)], [reservation('chairs', 1), reservation('tables', 2)], 'company-a');
  assert.equal(result.size, 2); assert.deepEqual(result.get('tables'), { reservedQuantity: 2, availableQuantity: 0 });
});
test('deleting an order returns its reservation without exceeding total', () => assert.deepEqual(updates(item({ reservedQuantity: 5, availableQuantity: 0 }), [reservation('chairs', 5)]), { reservedQuantity: 0, availableQuantity: 5 }));
test('rejects negative quantities and invalid inventory invariants', () => {
  assert.equal(code(() => reservationQuantities([reservation('chairs', -1)])), 'INVALID_QUANTITY');
  assert.equal(code(() => updates(item({ reservedQuantity: 6, availableQuantity: 0 }), [], [reservation('chairs', 1)])), 'INVENTORY_INVARIANT');
});
test('rejects item from another company and missing items', () => {
  assert.equal(code(() => updates(item({ companyId: 'company-b' }), [], [reservation('chairs', 1)])), 'CROSS_TENANT_INVENTORY');
  assert.equal(code(() => calculateReservationUpdates(new Map(), [], [reservation('missing', 1)], 'company-a')), 'INVENTORY_NOT_FOUND');
});
test('a failure computes no partial state (transaction rollback input)', () => {
  const good = item(), bad = item({ id: 'tables', quantity: 1, totalQuantity: 1, availableQuantity: 1 });
  assert.equal(code(() => calculateReservationUpdates(new Map([['chairs', good], ['tables', bad]]), [], [reservation('chairs', 1), reservation('tables', 2)], 'company-a')), 'INSUFFICIENT_STOCK');
  assert.deepEqual(good, item());
});
