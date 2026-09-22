import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyFinanceEntry, Order } from '../src/types';
import { calculateMonthlyCash, calculateSafeBalanceToDate } from '../src/utils/monthlyCash';
import { completedOrderFulfillmentCosts, fulfillmentCostsRecognized } from '../src/utils/orderPayments';
import {
  expenseReversalEntry,
  expenseVoidMetadata,
  financialHistoryOrders,
  isFinanciallyActiveOrder,
  orderRetentionMetadata,
  refundPaymentEntry,
} from '../src/utils/financialRetention';

const order = (changes: Partial<Order>): Order => ({
  id: 'order-1', orderNumber: 'ORD-1', customerId: 'customer-1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-08-02', weddingDate: '2026-08-20', eventDate: '2026-08-20', deliveryDate: '2026-08-20', eventLocation: '',
  totalPrice: 2000, deposit: 500, totalPaid: 500, remainingBalance: 1500, paymentStatus: 'partially_paid',
  paymentHistory: [], orderStatus: 'confirmed', reservedItems: [], attachments: [], createdAt: '2026-08-02', updatedAt: '2026-08-02',
  ...changes,
});

const asOf = new Date(2026, 8, 30);

// --- F5 --------------------------------------------------------------------

test('completed -> returned does not remove already recognized worker and transport costs', () => {
  const completed = order({
    id: 'done', orderStatus: 'completed', totalPaid: 2_000, remainingBalance: 0, paymentStatus: 'fully_paid',
    paymentHistory: [{ id: 'pay_1', amount: 2_000, date: '2026-08-20', method: 'Cash', type: 'settlement' }],
    workerCost: 400, transportationCost: 100, fulfillmentRecognizedAt: '2026-08-20T18:00:00.000Z',
  });
  const returned: Order = { ...completed, orderStatus: 'returned' };

  assert.equal(completedOrderFulfillmentCosts(completed), 500);
  assert.equal(completedOrderFulfillmentCosts(returned), 500, 'recognition survives the status change');
  assert.equal(fulfillmentCostsRecognized(returned), true);

  const before = calculateMonthlyCash([completed], [], 2026, 7);
  const after = calculateMonthlyCash([returned], [], 2026, 7);
  assert.equal(before.completedWorkerTransportCosts, 500);
  assert.equal(after.completedWorkerTransportCosts, 500, 'the closed month keeps its costs');
  assert.equal(after.orderCashNet, before.orderCashNet, 'cash cannot go back up on return');

  assert.equal(
    calculateSafeBalanceToDate([returned], [], asOf),
    calculateSafeBalanceToDate([completed], [], asOf),
  );
});

test('a record written before recognition existed still falls back to its status', () => {
  const legacy = order({ orderStatus: 'completed', workerCost: 300, transportationCost: 50 });
  assert.equal(completedOrderFulfillmentCosts(legacy), 350);
  assert.equal(completedOrderFulfillmentCosts({ ...legacy, orderStatus: 'returned' }), 0, 'legacy behaviour is unchanged');
});

// --- B1 --------------------------------------------------------------------

test('cancellation after a prior payment does not erase the historical receipt', () => {
  const paid = order({
    id: 'booked', totalPaid: 700, remainingBalance: 1_300,
    paymentHistory: [{ id: 'pay_1', amount: 700, date: '2026-08-05', method: 'Cash', type: 'deposit' }],
  });
  const cancelled: Order = { ...paid, orderStatus: 'cancelled' };

  const before = calculateMonthlyCash([paid], [], 2026, 7);
  const after = calculateMonthlyCash([cancelled], [], 2026, 7);

  assert.equal(before.collections.length, 1);
  assert.equal(after.collections.length, 1, 'the receipt is still recorded in its month');
  assert.equal(after.collections[0].amount, 700);
  assert.equal(after.collections[0].date, '2026-08-05');
  assert.equal(after.orderCashNet, before.orderCashNet, 'cancelling does not rewrite the month');
  assert.equal(calculateSafeBalanceToDate([cancelled], [], asOf), calculateSafeBalanceToDate([paid], [], asOf));
});

test('cancellation after prior costs does not erase the historical cost', () => {
  const spent = order({ id: 'spent', totalPaid: 0, remainingBalance: 2_000, paymentStatus: 'unpaid', otherExpenses: 150 });
  const cancelled: Order = { ...spent, orderStatus: 'cancelled' };

  assert.equal(calculateMonthlyCash([cancelled], [], 2026, 7).bookedOrderOtherExpenses, 150);
  assert.equal(
    calculateSafeBalanceToDate([cancelled], [], asOf),
    calculateSafeBalanceToDate([spent], [], asOf),
    'money already spent on the booking stays spent',
  );
});

test('a retained deposit does not rewrite the original receipt', () => {
  const retained = order({
    id: 'retained', orderStatus: 'cancelled_deposit_retained', totalPaid: 600, remainingBalance: 1_400,
    paymentHistory: [{ id: 'pay_1', amount: 600, date: '2026-08-04', method: 'Cash', type: 'deposit' }],
  });

  const result = calculateMonthlyCash([retained], [], 2026, 7);

  assert.equal(result.retainedCancelledDeposits, 600);
  assert.equal(result.collections[0].amount, 600, 'the original amount is untouched');
  assert.equal(result.collections[0].date, '2026-08-04', 'the original date is untouched');
  assert.equal(result.collections[0].id, 'pay_1', 'the original entry is reused, not replaced');
  assert.equal(result.collections[0].isRetainedDeposit, true);
});

test('a refund is a separate dated movement, not an edit of the original payment', () => {
  const receipt = { id: 'pay_1', amount: 900, date: '2026-08-06', method: 'Cash', type: 'deposit' as const };
  const refund = refundPaymentEntry('refund_1', 900, '2026-09-11', 'Cash', 'Refund on cancellation');
  const refunded = order({
    id: 'refunded', orderStatus: 'cancelled', deposit: 900, totalPaid: 0, remainingBalance: 2_000, paymentStatus: 'unpaid',
    paymentHistory: [receipt, refund],
  });

  const august = calculateMonthlyCash([refunded], [], 2026, 7);
  const september = calculateMonthlyCash([refunded], [], 2026, 8);

  // August keeps the receipt exactly as it was reported.
  assert.equal(august.collections.length, 1);
  assert.equal(august.collections[0].amount, 900);
  assert.equal(august.collections[0].date, '2026-08-06');
  // The money leaves in September, on the refund's own date.
  assert.equal(september.collections.length, 1);
  assert.equal(september.collections[0].amount, -900);
  assert.equal(september.collections[0].date, '2026-09-11');
  assert.equal(september.collections[0].paymentType, 'refund');
  // Once both are in the past, they net to nothing.
  assert.equal(calculateSafeBalanceToDate([refunded], [], new Date(2026, 8, 30)), 0);
  // Before the refund date, the money was still held.
  assert.equal(calculateSafeBalanceToDate([refunded], [], new Date(2026, 8, 1)), 900);
});

// --- D2 --------------------------------------------------------------------

test('deleting an operational order does not remove its historical financial data', () => {
  const paid = order({
    id: 'paid', totalPaid: 800, remainingBalance: 1_200,
    paymentHistory: [{ id: 'pay_1', amount: 800, date: '2026-08-07', method: 'Cash', type: 'deposit' }],
  });
  assert.deepEqual(orderRetentionMetadata(paid), { financiallyRetained: true });

  const deleted: Order = { ...paid, deletedAt: '2026-09-01T00:00:00.000Z', financiallyRetained: true };
  const accounting = financialHistoryOrders([], [deleted]);

  assert.equal(accounting.length, 1, 'accounting still sees the deleted order');
  assert.equal(calculateMonthlyCash(accounting, [], 2026, 7).collections[0].amount, 800);
  assert.equal(calculateSafeBalanceToDate(accounting, [], asOf), 800);

  // An order that never touched money disappears completely, as before.
  const empty = order({ id: 'empty', totalPaid: 0, deposit: 0, remainingBalance: 2_000, paymentStatus: 'unpaid' });
  assert.equal(isFinanciallyActiveOrder(empty), false);
  assert.deepEqual(orderRetentionMetadata(empty), {});
  assert.equal(financialHistoryOrders([], [{ ...empty, deletedAt: '2026-09-01T00:00:00.000Z' }]).length, 0);
});

test('voiding an expense preserves the original month and dates the reversal', () => {
  const expense: CompanyFinanceEntry = {
    id: 'exp_1', type: 'expense', category: 'إيجار', amount: 250, date: '2026-08-09',
    createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z',
  };
  const voidedOn = new Date(2026, 8, 12);
  const reversal = expenseReversalEntry(expense, 'exp_reversal', voidedOn);
  const metadata = expenseVoidMetadata('exp_reversal', voidedOn);

  assert.equal(reversal.isReversal, true);
  assert.equal(reversal.reversalOfId, 'exp_1');
  assert.equal(reversal.amount, 250);
  assert.equal(reversal.date, '2026-09-12', 'the reversal is dated when the void happened');
  assert.ok(metadata.voidedAt, 'the original is marked, not deleted');

  const ledger = [{ ...expense, ...metadata }, reversal];
  // August still reports the expense it was reported with.
  assert.equal(calculateMonthlyCash([], ledger, 2026, 7).operatingExpenses, 250);
  // September carries the reversal, so the running balance nets to zero.
  assert.equal(calculateMonthlyCash([], ledger, 2026, 8).operatingExpenses, -250);
  assert.equal(calculateSafeBalanceToDate([], ledger, new Date(2026, 8, 30)), 0);
  assert.equal(calculateSafeBalanceToDate([], ledger, new Date(2026, 8, 1)), -250);
});
