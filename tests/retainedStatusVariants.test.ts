import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyFinanceEntry, Order } from '../src/types';
import {
  calculateFinancePeriodCash,
  calculateMonthlyCash,
  calculateSafeBalanceToDate,
  expectedOrderProfitContribution,
  isRetainedCancellation,
  netOrderCashContribution,
  orderCashCollections,
} from '../src/utils/monthlyCash';

/**
 * One retained cancellation, stored with the spellings that legacy records,
 * imports and hand edits actually carry.
 *
 * Every retained rule reads the status through `isRetainedCancellation`, so a
 * variant record must land in exactly the same buckets as the canonical one.
 * These tests compare whole results rather than single fields: if any rule
 * ever goes back to a strict comparison, the record splits between buckets and
 * one of these deep comparisons fails.
 */

const AUG: [number, number] = [2026, 7];
const noEntries: CompanyFinanceEntry[] = [];

const CANONICAL = 'cancelled_deposit_retained';
const VARIANTS = [
  'cancelled_deposit_retained ',
  '  cancelled_deposit_retained',
  'CANCELLED_DEPOSIT_RETAINED',
  'Cancelled_Deposit_Retained',
  'cancelled-deposit-retained',
  'cancelled deposit retained',
];

const retained = (status: string): Order => ({
  id: 'ord-retained', orderNumber: 'WED-2026-749', customerId: 'c1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-08-01', weddingDate: '2026-08-20', eventDate: '2026-08-20', deliveryDate: '2026-08-20', eventLocation: '',
  totalPrice: 4_000, deposit: 1_000, totalPaid: 1_000, remainingBalance: 3_000, paymentStatus: 'partially_paid',
  paymentHistory: [{ id: 'p1', amount: 1_000, date: '2026-08-10', method: 'Cash', type: 'deposit' }],
  orderStatus: status as Order['orderStatus'], reservedItems: [], attachments: [],
  cancelledAt: '2026-08-20T00:00:00.000Z',
  createdAt: '2026-08-01', updatedAt: '2026-08-01',
});

const summaryOf = (status: string) => calculateMonthlyCash([retained(status)], noEntries, ...AUG);

test('the predicate recognises every supported spelling, and nothing else', () => {
  assert.equal(isRetainedCancellation({ orderStatus: CANONICAL as Order['orderStatus'] }), true);
  for (const status of VARIANTS) {
    assert.equal(isRetainedCancellation({ orderStatus: status as Order['orderStatus'] }), true, JSON.stringify(status));
  }
  for (const other of ['cancelled', 'completed', 'confirmed', 'returned', '', 'deposit_retained']) {
    assert.equal(isRetainedCancellation({ orderStatus: other as Order['orderStatus'] }), false, JSON.stringify(other));
  }
});

test('a variant spelling lands in the retained-deposit collection bucket', () => {
  const canonical = orderCashCollections(retained(CANONICAL));
  assert.equal(canonical[0].isRetainedDeposit, true);

  for (const status of VARIANTS) {
    const collections = orderCashCollections(retained(status));
    assert.deepEqual(collections, canonical, `collections must match for ${JSON.stringify(status)}`);
    assert.equal(collections[0].isRetainedDeposit, true, 'the money is retained, not an ordinary advance');
  }
});

test('a variant spelling is never classified as an upcoming active order', () => {
  const canonical = summaryOf(CANONICAL);
  assert.equal(canonical.retainedCancelledDeposits, 1_000, 'the retained bucket holds it');
  assert.equal(canonical.advancesFromUpcomingOrders, 0, 'and the upcoming bucket does not');

  for (const status of VARIANTS) {
    const summary = summaryOf(status);
    assert.equal(summary.retainedCancelledDeposits, 1_000, JSON.stringify(status));
    assert.equal(summary.advancesFromUpcomingOrders, 0, `${JSON.stringify(status)} is not an upcoming advance`);
    assert.equal(summary.upcomingOrderDepositsPaid, 0);
  }
});

test('a variant spelling contributes nothing to expected settlement payments', () => {
  // The order's 3,000 outstanding balance is never going to be settled: the
  // booking was cancelled and its money kept.
  assert.equal(summaryOf(CANONICAL).expectedSettlementPayments, 0);
  for (const status of VARIANTS) {
    assert.equal(summaryOf(status).expectedSettlementPayments, 0, JSON.stringify(status));
  }
});

test('a variant spelling produces the same net-monthly-cash breakdown', () => {
  const canonical = summaryOf(CANONICAL).netMonthlyCashBreakdown;
  assert.deepEqual(canonical.map((item) => item.kind), ['retained-deposit']);

  for (const status of VARIANTS) {
    assert.deepEqual(summaryOf(status).netMonthlyCashBreakdown, canonical, JSON.stringify(status));
  }
});

test('every spelling produces a byte-for-byte identical monthly summary', () => {
  const canonical = summaryOf(CANONICAL);
  for (const status of VARIANTS) {
    assert.deepEqual(summaryOf(status), canonical, `the whole summary must match for ${JSON.stringify(status)}`);
  }
});

test('the totals themselves are unchanged by the spelling', () => {
  const canonicalOrder = retained(CANONICAL);
  const canonical = {
    netOrderCash: netOrderCashContribution(canonicalOrder, [], ...AUG),
    expectedProfit: expectedOrderProfitContribution(canonicalOrder, ...AUG),
    safeBalance: calculateSafeBalanceToDate([canonicalOrder], noEntries, new Date(2026, 7, 31)),
    treasury: calculateFinancePeriodCash([canonicalOrder], noEntries, '2026-08', '2026-08'),
  };

  // The figures this patch must not move.
  assert.equal(canonical.netOrderCash, 1_000);
  assert.equal(canonical.expectedProfit, 1_000);
  assert.equal(canonical.safeBalance, 1_000);
  assert.equal(canonical.treasury.totalTreasuryBalance, 1_000);

  for (const status of VARIANTS) {
    const subject = retained(status);
    assert.equal(netOrderCashContribution(subject, [], ...AUG), canonical.netOrderCash, JSON.stringify(status));
    assert.equal(expectedOrderProfitContribution(subject, ...AUG), canonical.expectedProfit, JSON.stringify(status));
    assert.equal(calculateSafeBalanceToDate([subject], noEntries, new Date(2026, 7, 31)), canonical.safeBalance);
    assert.deepEqual(calculateFinancePeriodCash([subject], noEntries, '2026-08', '2026-08'), canonical.treasury);
  }
});

test('an ordinary active order is still an upcoming advance, not retained', () => {
  // The guard against over-matching: a normal booking keeps its own bucket.
  const active: Order = { ...retained('confirmed'), cancelledAt: undefined, eventDate: '2026-11-20', weddingDate: '2026-11-20' };
  const summary = calculateMonthlyCash([active], noEntries, ...AUG);

  assert.equal(summary.retainedCancelledDeposits, 0);
  assert.equal(summary.advancesFromUpcomingOrders, 1_000);
  assert.equal(orderCashCollections(active)[0].isRetainedDeposit, false);
});
