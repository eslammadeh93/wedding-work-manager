import assert from 'node:assert/strict';
import test from 'node:test';
import { getImportantAlerts } from '../src/utils/importantAlerts';
import type { ActivityLogRecord, InventoryItem, Order } from '../src/types';

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 'order-1', orderNumber: 'WED-1', customerId: 'customer-1', customerName: 'منى', customerPhone: '',
  weddingDate: '2026-08-25', deliveryDate: '2026-08-25', eventLocation: '', totalPrice: 2_000,
  deposit: 500, totalPaid: 500, remainingBalance: 1_500, paymentStatus: 'partial', paymentHistory: [],
  orderStatus: 'confirmed', selectedItems: [], createdAt: '2026-08-01', updatedAt: '2026-08-01', ...overrides,
});

const inventory = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'item-1', itemCode: 'CHAIR', nameAr: 'كرسي', nameEn: 'Chair', category: 'chairs', quantity: 10,
  availableQuantity: 1, reservedQuantity: 9, minStockLevel: 3, storageLocation: '', condition: 'excellent',
  createdAt: '', updatedAt: '', ...overrides,
});

const now = new Date(2026, 7, 23, 10);

test('shows upcoming orders, overdue payments, and low inventory in one alert list', () => {
  const alerts = getImportantAlerts({
    orders: [order(), order({ id: 'overdue', orderNumber: 'WED-2', weddingDate: '2026-08-20', workerId: 'worker-1' })],
    inventory: [inventory()], activityLogs: [], now,
  });

  assert.deepEqual(alerts.map((alert) => alert.type), ['overdue_payment', 'missing_worker_arrival', 'low_inventory', 'upcoming_order']);
});

test('does not flag a worker after an arrival report has been recorded', () => {
  const activity: ActivityLogRecord = {
    id: 'movement-1', orderId: 'order-1', orderNumber: 'WED-1', workerId: 'worker-1', workerName: 'أحمد',
    action: 'worker_reported_arrival', timestamp: '2026-08-23', customerName: 'منى', eventDate: '2026-08-23',
  };
  const alerts = getImportantAlerts({
    orders: [order({ weddingDate: '2026-08-23', workerId: 'worker-1', workerName: 'أحمد' })], inventory: [], activityLogs: [activity], now,
  });

  assert.equal(alerts.some((alert) => alert.type === 'missing_worker_arrival'), false);
});

test('ignores inactive orders and inventory above its minimum level', () => {
  const alerts = getImportantAlerts({
    orders: [order({ weddingDate: '2026-08-20', orderStatus: 'completed', workerId: 'worker-1' })],
    inventory: [inventory({ availableQuantity: 4 })], activityLogs: [], now,
  });

  assert.equal(alerts.length, 0);
});
