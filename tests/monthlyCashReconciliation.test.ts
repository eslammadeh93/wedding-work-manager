import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileMonthlyCash } from '../src/utils/monthlyCashReconciliation';
import type { Order } from '../src/types';

const order = (changes: Partial<Order>): Order => ({
  id: 'order-1', orderNumber: 'ORD-1', customerId: 'customer-1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-08-02', weddingDate: '2026-08-20', eventDate: '2026-08-20', deliveryDate: '2026-08-20', eventLocation: '',
  totalPrice: 2_000, deposit: 500, totalPaid: 500, remainingBalance: 1_500, paymentStatus: 'partially_paid', paymentHistory: [],
  orderStatus: 'confirmed', reservedItems: [], attachments: [], createdAt: '2026-08-02', updatedAt: '2026-08-02', ...changes,
});

test('attributes the cash-vs-expected gap to the relevant order', () => {
  const reconciliation = reconcileMonthlyCash([
    order({ id: 'uncompleted', totalPrice: 2_000, totalPaid: 1_000, remainingBalance: 1_000, paymentHistory: [{ id: 'deposit', amount: 1_000, date: '2026-08-02', method: 'cash', type: 'deposit' }], otherExpenses: 100 }),
  ], [], 2026, 7);

  assert.equal(reconciliation.netOrderCash, 900);
  assert.equal(reconciliation.expectedProfit, 1_900);
  assert.equal(reconciliation.difference, 1_000);
  assert.deepEqual(reconciliation.items.map(item => [item.orderNumber, item.difference]), [['ORD-1', 1_000]]);
});

test('flags payment and balance records that disagree with their calculated values', () => {
  const reconciliation = reconcileMonthlyCash([
    order({ totalPaid: 500, remainingBalance: 1_200, paymentHistory: [{ id: 'deposit', amount: 400, date: '2026-08-02', method: 'cash' }] }),
  ], [], 2026, 7);
  assert.deepEqual(reconciliation.issues.map(issue => issue.kind), ['payment-history', 'remaining-balance']);
});

test('explains the exact action when a fully-paid label conflicts with an unpaid balance', () => {
  const reconciliation = reconcileMonthlyCash([
    order({ totalPrice: 2_800, totalPaid: 1_000, remainingBalance: 1_800, paymentStatus: 'fully_paid', paymentHistory: [{ id: 'deposit', amount: 1_000, date: '2026-08-02', method: 'cash' }] }),
  ], [], 2026, 7);
  const issue = reconciliation.issues.find(item => item.kind === 'payment-status');
  assert.match(issue?.messageAr || '', /دفعة سداد بقيمة 1,800/);
});

test('matches an August deposit for an order completed after its September event', () => {
  const reconciliation = reconcileMonthlyCash([
    order({
      bookingDate: '2026-08-29', createdAt: '2026-08-29', eventDate: '2026-09-02', weddingDate: '2026-09-02', orderStatus: 'completed',
      totalPrice: 2_800, totalPaid: 2_800, remainingBalance: 0, paymentStatus: 'fully_paid', workerCost: 1_000, transportationCost: 500,
      paymentHistory: [
        { id: 'deposit', amount: 1_000, date: '2026-08-29', method: 'cash', type: 'deposit' },
        { id: 'settlement', amount: 1_800, date: '2026-09-02', method: 'cash', type: 'settlement' },
      ],
    }),
  ], [], 2026, 7);
  assert.equal(reconciliation.difference, 0);
});
