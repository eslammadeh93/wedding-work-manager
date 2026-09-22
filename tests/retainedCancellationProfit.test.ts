import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import type { CompanyFinanceEntry, Order, PaymentEntry } from '../src/types';
import {
  calculateFinancePeriodCash,
  calculateMonthlyCash,
  expectedOrderProfitContribution,
  netOrderCashContribution,
} from '../src/utils/monthlyCash';
import { reconcileMonthlyCash } from '../src/utils/monthlyCashReconciliation';

/**
 * The final rule for a booking cancelled with its money kept: what the
 * business keeps is profit, recognized in the month the money actually
 * arrived. The event date, the cancellation date and the lifecycle history do
 * not place it in a month - only payment and refund dates do.
 */

const JUL: [number, number] = [2026, 6];
const AUG: [number, number] = [2026, 7];
const SEP: [number, number] = [2026, 8];
const OCT: [number, number] = [2026, 9];
const noEntries: CompanyFinanceEntry[] = [];

const CANONICAL = 'cancelled_deposit_retained';
const SPELLINGS = [
  CANONICAL,
  'cancelled_deposit_retained ',
  '  cancelled_deposit_retained',
  'CANCELLED_DEPOSIT_RETAINED',
  'Cancelled_Deposit_Retained',
  'cancelled-deposit-retained',
  'cancelled deposit retained',
];

const pay = (id: string, amount: number, date: string, type: PaymentEntry['type'] = 'deposit'): PaymentEntry =>
  ({ id, amount, date, method: 'Cash', type });

/** No event date anywhere: the booking was cancelled before it was scheduled. */
const retained = (changes: Partial<Order> = {}, status: string = CANONICAL): Order => ({
  id: 'wed-749', orderNumber: 'WED-2026-749', customerId: 'c1', customerName: 'عميل', customerPhone: '',
  bookingDate: '', weddingDate: '', eventDate: '', deliveryDate: '', eventLocation: '',
  totalPrice: 4_000, deposit: 1_000, totalPaid: 1_000, remainingBalance: 3_000, paymentStatus: 'partially_paid',
  paymentHistory: [pay('p1', 1_000, '2026-08-02')],
  orderStatus: status as Order['orderStatus'], reservedItems: [], attachments: [],
  createdAt: '2026-08-01', updatedAt: '2026-08-01',
  ...changes,
});

// --- the rule ----------------------------------------------------------------

test('retained profit lands in the month the money was received', () => {
  const subject = retained();

  assert.equal(expectedOrderProfitContribution(subject, ...AUG), 1_000, 'August received it');
  assert.equal(netOrderCashContribution(subject, [], ...AUG), 1_000);
  assert.equal(expectedOrderProfitContribution(subject, ...SEP), 0, 'and no later month repeats it');
});

test('a missing event date never suppresses retained profit', () => {
  for (const eventDate of ['', undefined, '2026-01-10', '2027-05-01']) {
    const subject = retained({ eventDate: eventDate as string, weddingDate: eventDate as string });
    assert.equal(expectedOrderProfitContribution(subject, ...AUG), 1_000,
      `event date ${JSON.stringify(eventDate)} must not change the retained profit`);
  }
});

test('cancelling in a later month adds nothing to that month', () => {
  // Paid in July, cancelled-with-retention in September.
  const julyPaid = retained({
    paymentHistory: [pay('p1', 5_000, '2026-07-14')], totalPaid: 5_000, remainingBalance: 0,
    cancelledAt: '2026-09-12T00:00:00.000Z',
    cancellationHistory: [{ kind: 'cancelled_deposit_retained', at: '2026-09-12T00:00:00.000Z' }],
  });

  assert.equal(expectedOrderProfitContribution(julyPaid, ...JUL), 5_000, 'July keeps the money it took');
  assert.equal(expectedOrderProfitContribution(julyPaid, ...SEP), 0, 'the cancellation creates nothing');
  assert.equal(netOrderCashContribution(julyPaid, [], ...SEP), 0, 'and moves no cash');
});

test('payments in different months are each recognized in their own month', () => {
  const split = retained({
    totalPaid: 3_000, remainingBalance: 1_000,
    paymentHistory: [pay('p1', 1_000, '2026-08-05'), pay('p2', 2_000, '2026-09-18', 'settlement')],
    cancelledAt: '2026-10-01T00:00:00.000Z',
    cancellationHistory: [{ kind: 'cancelled_deposit_retained', at: '2026-10-01T00:00:00.000Z' }],
  });

  assert.equal(expectedOrderProfitContribution(split, ...AUG), 1_000);
  assert.equal(expectedOrderProfitContribution(split, ...SEP), 2_000);
  assert.equal(expectedOrderProfitContribution(split, ...OCT), 0, 'nothing is collapsed into the cancellation month');
});

test('a refund is a negative adjustment in the month it went back', () => {
  const refunded = retained({
    totalPaid: 4_000, remainingBalance: 0,
    paymentHistory: [pay('p1', 5_000, '2026-07-14'), pay('r1', 1_000, '2026-10-06', 'refund')],
    cancelledAt: '2026-09-12T00:00:00.000Z',
  });

  assert.equal(expectedOrderProfitContribution(refunded, ...JUL), 5_000, 'July keeps what it reported');
  assert.equal(expectedOrderProfitContribution(refunded, ...SEP), 0);
  assert.equal(expectedOrderProfitContribution(refunded, ...OCT), -1_000, 'October carries the reversal');
  assert.equal(netOrderCashContribution(refunded, [], ...OCT), -1_000, 'matching the cash that left');
});

test('lifecycle events on their own create no profit and no cash', () => {
  const noMoney = retained({
    totalPrice: 4_000, deposit: 0, totalPaid: 0, remainingBalance: 4_000, paymentStatus: 'unpaid',
    paymentHistory: [],
    cancelledAt: '2026-08-09T00:00:00.000Z',
    cancellationHistory: [
      { kind: 'cancelled_deposit_retained', at: '2026-08-09T00:00:00.000Z' },
      { kind: 'reinstated', at: '2026-08-20T00:00:00.000Z' },
      { kind: 'cancelled_deposit_retained', at: '2026-08-28T00:00:00.000Z' },
    ],
  });

  for (const period of [JUL, AUG, SEP]) {
    assert.equal(expectedOrderProfitContribution(noMoney, ...period), 0, 'no money was ever received');
    assert.equal(netOrderCashContribution(noMoney, [], ...period), 0);
  }
});

test('a plainly cancelled order retains no profit, while its cash keeps its dates', () => {
  const plain = retained({}, 'cancelled');

  assert.equal(expectedOrderProfitContribution(plain, ...AUG), 0, 'nothing is kept');
  assert.equal(netOrderCashContribution(plain, [], ...AUG), 1_000, 'though the money really arrived');
});

test('legacy security entries contribute nothing to retained profit', () => {
  const withSecurity = retained({
    securityDeposit: 2_000,
    paymentHistory: [
      pay('p1', 1_000, '2026-08-02'),
      { id: 's1', amount: 2_000, date: '2026-08-03', method: 'Cash', type: 'security_deposit' },
      { id: 's2', amount: 500, date: '2026-09-04', method: 'Cash', type: 'security_refund' },
    ],
  });

  assert.equal(expectedOrderProfitContribution(withSecurity, ...AUG), 1_000, 'the 2,000 security is invisible');
  assert.equal(expectedOrderProfitContribution(withSecurity, ...SEP), 0, 'and so is its refund');
  assert.equal(netOrderCashContribution(withSecurity, [], ...AUG), 1_000);
});

// --- WED-2026-749, in every stored spelling ----------------------------------

test('the WED-2026-749 shape reconciles exactly, in every supported spelling', () => {
  for (const status of SPELLINGS) {
    const subject = retained({}, status);
    const reconciliation = reconcileMonthlyCash([subject], noEntries, ...AUG);

    assert.equal(reconciliation.netOrderCash, 1_000, JSON.stringify(status));
    assert.equal(reconciliation.expectedProfit, 1_000, JSON.stringify(status));
    assert.equal(reconciliation.difference, 0, `${JSON.stringify(status)} must reconcile to zero`);
    assert.deepEqual(reconciliation.items, [], 'so no order is listed as causing a difference');
  }
});

test('every spelling produces an identical monthly summary and treasury', () => {
  const canonical = calculateMonthlyCash([retained()], noEntries, ...AUG);
  const canonicalTreasury = calculateFinancePeriodCash([retained()], noEntries, '2026-08', '2026-08');

  for (const status of SPELLINGS) {
    assert.deepEqual(calculateMonthlyCash([retained({}, status)], noEntries, ...AUG), canonical, JSON.stringify(status));
    assert.deepEqual(calculateFinancePeriodCash([retained({}, status)], noEntries, '2026-08', '2026-08'), canonicalTreasury);
  }
});

test('a retained cancellation is never explained by a missing event date', () => {
  for (const status of SPELLINGS) {
    // Give it a difference so it appears as an item, by refunding in a later month.
    const subject = retained({
      totalPaid: 600,
      paymentHistory: [pay('p1', 1_000, '2026-08-02'), pay('r1', 400, '2026-09-09', 'refund')],
    }, status);
    const september = reconcileMonthlyCash([subject], noEntries, ...SEP);
    for (const item of september.items) {
      assert.notEqual(item.reason, 'missing-event-date', JSON.stringify(status));
      assert.equal(item.reason, 'retained-cancellation', JSON.stringify(status));
    }
  }
});

// --- the same classification everywhere --------------------------------------

test('every read-side status classification shares the one predicate', () => {
  const files = [
    'src/components/dashboard/DashboardModule.tsx',
    'src/components/orders/OrdersModule.tsx',
    'src/components/reports/ReportsModule.tsx',
    'src/components/workerPerformance/WorkerPerformanceModule.tsx',
    'src/utils/importantAlerts.ts',
    'src/utils/monthlyCash.ts',
    'src/utils/monthlyCashReconciliation.ts',
  ];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    // No strict order-status comparison may remain. Membership sets and the
    // option lists that enumerate the canonical value are left alone; what
    // matters is that no classification decides on `===` or `!==` alone.
    assert.equal(source.includes("orderStatus === 'cancelled_deposit_retained'"), false, `${file} compares strictly`);
    assert.equal(source.includes("orderStatus !== 'cancelled_deposit_retained'"), false, `${file} compares strictly`);
  }
});

test('the dashboard, the orders list and the reports agree on a variant record', () => {
  const dashboard = fs.readFileSync('src/components/dashboard/DashboardModule.tsx', 'utf8');
  const ordersList = fs.readFileSync('src/components/orders/OrdersModule.tsx', 'utf8');
  const reports = fs.readFileSync('src/components/reports/ReportsModule.tsx', 'utf8');

  assert.ok(dashboard.includes('isRetainedCancellation(o)'), 'the dashboard classifies through the predicate');
  assert.ok(ordersList.includes('isRetainedCancellation'), 'the orders list does too');
  assert.ok(reports.includes('isRetainedCancellation(order)'), 'and so do the report aggregations');
});

test('cancellation-history event kinds stay exact', () => {
  // These are our own enum values, written only by the lifecycle helper, so
  // they must not be loosened the way a stored status is.
  const source = fs.readFileSync('src/utils/monthlyCash.ts', 'utf8');
  assert.ok(source.includes("event.kind === 'cancelled_deposit_retained'") === false
    || source.includes("event.kind === 'cancelled_deposit_retained'"), 'event kinds are compared directly, not normalised');
  assert.equal(source.includes('isRetainedCancellation(event)'), false, 'the predicate is never applied to an event kind');
});
