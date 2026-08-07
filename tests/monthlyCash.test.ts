import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMonthlyCash } from '../src/utils/monthlyCash';
import type { Order } from '../src/types';

const order = (changes: Partial<Order>): Order => ({
  id: 'order-1', orderNumber: 'ORD-1', customerId: 'customer-1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-08-02', weddingDate: '2026-08-20', deliveryDate: '2026-08-20', eventLocation: '',
  totalPrice: 2000, deposit: 500, totalPaid: 500, remainingBalance: 1500, paymentStatus: 'partially_paid',
  paymentHistory: [], orderStatus: 'confirmed', reservedItems: [], attachments: [], createdAt: '2026-08-02', updatedAt: '2026-08-02',
  ...changes,
});

test('separates completed collections, future-order advances, and monthly outflows', () => {
  const result = calculateMonthlyCash([
    order({ id: 'completed', orderStatus: 'completed', totalPaid: 1000, paymentHistory: [{ id: 'one', amount: 1000, date: '2026-08-15', method: 'cash' }], workerCost: 200, transportationCost: 50, otherExpenses: 25 }),
    order({ id: 'future', totalPaid: 400, otherExpenses: 75, paymentHistory: [{ id: 'two', amount: 400, date: '2026-08-10', method: 'cash' }] }),
  ], [
    { id: 'capital', type: 'capital', category: 'رأس مال', amount: 300, date: '2026-08-05', createdAt: '' },
    { id: 'expense', type: 'expense', category: 'إيجار', amount: 100, date: '2026-08-12', createdAt: '' },
  ], 2026, 7);

  assert.equal(result.collectedFromCompletedOrders, 1000);
  assert.equal(result.advancesFromUpcomingOrders, 400);
  assert.equal(result.completedOrderCosts, 275);
  assert.equal(result.upcomingOrderOtherExpenses, 75);
  assert.equal(result.orderCashNet, 1050);
  assert.equal(result.orderCashBalanceToDate, 1050);
  assert.equal(result.cashMovement, 1325);
  assert.equal(result.expectedSafeBalance, 1325);
});

test('uses booking date for legacy payments without history', () => {
  const result = calculateMonthlyCash([order({ totalPaid: 500, paymentHistory: [] })], [], 2026, 7);
  assert.equal(result.advancesFromUpcomingOrders, 500);
});
