import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
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

test('an August advance matches its month, and September shows margin not yet collected', () => {
  const settledLate = [
    order({
      bookingDate: '2026-08-29', createdAt: '2026-08-29', eventDate: '2026-09-02', weddingDate: '2026-09-02', orderStatus: 'completed',
      totalPrice: 2_800, totalPaid: 2_800, remainingBalance: 0, paymentStatus: 'fully_paid', workerCost: 1_000, transportationCost: 500,
      paymentHistory: [
        { id: 'deposit', amount: 1_000, date: '2026-08-29', method: 'cash', type: 'deposit' },
        { id: 'settlement', amount: 1_800, date: '2026-09-02', method: 'cash', type: 'settlement' },
      ],
    }),
  ];
  // August takes 1,000 in cash for work scheduled in September, so that
  // advance is what August is expected to have earned - cash and expectation
  // agree, and the month reconciles.
  const august = reconcileMonthlyCash(settledLate, [], 2026, 7);
  const september = reconcileMonthlyCash(settledLate, [], 2026, 8);
  assert.equal(august.netOrderCash, 1_000);
  assert.equal(august.expectedProfit, 1_000, 'the advance is the August expectation');
  assert.equal(august.difference, 0);

  // September earns the whole contract margin and collects the balance, so the
  // difference there is the margin not yet turned into cash this month.
  assert.equal(september.expectedProfit, 1_300); // 2,800 - 1,000 - 500
  assert.equal(september.netOrderCash, 300); // 1,800 collected - 1,500 fulfillment
  assert.equal(september.difference, 1_000);
});

// --- the summary and its per-order cards are what remains --------------------

test('the reconciliation reports only a summary and the orders causing the gap', () => {
  const reconciliation = reconcileMonthlyCash([
    order({ id: 'gap', orderNumber: 'ORD-GAP', totalPrice: 2_000, totalPaid: 0, remainingBalance: 2_000, paymentHistory: [] }),
  ], [], 2026, 7);

  assert.equal(typeof reconciliation.netOrderCash, 'number');
  assert.equal(typeof reconciliation.expectedProfit, 'number');
  assert.equal(reconciliation.difference, reconciliation.expectedProfit - reconciliation.netOrderCash);
  assert.equal(reconciliation.items.length, 1, 'the order causing the gap is still listed');
  assert.ok(reconciliation.items[0].reason, 'and still explains itself');
  assert.equal('issues' in reconciliation, false, 'the month review list is gone');
  assert.equal('globalIssues' in reconciliation, false, 'and so is the global problems list');
});

test('the reports screen renders the summary and the per-order cards, and no review list', () => {
  const source = fs.readFileSync('src/components/reports/ReportsModule.tsx', 'utf8');

  // Kept.
  assert.ok(source.includes('reconcileMonthlyCash'), 'the reconciliation still runs');
  assert.ok(source.includes('cashReconciliation.netOrderCash'), 'net order cash is shown');
  assert.ok(source.includes('cashReconciliation.expectedProfit'), 'expected profit is shown');
  assert.ok(source.includes('cashReconciliation.difference'), 'the difference is shown');
  assert.ok(source.includes('cashReconciliation.items'), 'the orders causing it are shown');
  assert.ok(source.includes('reasonText[item.reason]'), 'each with its own explanation');

  // Removed.
  assert.equal(source.includes('بيانات تحتاج مراجعة'), false, 'no month review list');
  assert.equal(source.includes('مشاكل بيانات عامة'), false, 'no global problems list');
  assert.equal(source.includes('cashReconciliation.issues'), false);
  assert.equal(source.includes('cashReconciliation.globalIssues'), false);
});
