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
  // A stored total no entry explains is a fault in the record itself, so it
  // is reported globally; the balance mismatch belongs to the month.
  assert.deepEqual(reconciliation.issues.map(issue => issue.kind), ['remaining-balance']);
  assert.deepEqual(reconciliation.globalIssues.map(issue => issue.kind), ['payment-history']);
});

// --- the monthly list holds only this month's records ------------------------

const AUG: [number, number] = [2026, 7];

test('an unrelated month’s order is not listed in the August review', () => {
  const october = order({
    id: 'oct', orderNumber: 'ORD-OCT',
    bookingDate: '2026-10-01', createdAt: '2026-10-01', eventDate: '2026-10-20', weddingDate: '2026-10-20',
    totalPrice: 2_800, totalPaid: 1_000, remainingBalance: 1_800, paymentStatus: 'fully_paid',
    paymentHistory: [{ id: 'p-oct', amount: 1_000, date: '2026-10-02', method: 'cash', type: 'deposit' }],
  });

  const august = reconcileMonthlyCash([october], [], ...AUG);
  assert.deepEqual(august.issues, [], 'nothing about October belongs to the August review');

  // The same record is reported in the month it actually belongs to.
  const octoberReview = reconcileMonthlyCash([october], [], 2026, 9);
  assert.deepEqual(octoberReview.issues.map(issue => issue.kind), ['payment-status']);
  assert.equal(octoberReview.issues[0].scope, 'month');
});

test('a payment issue is classified by the month the money moved', () => {
  // The event is in October, but the payment landed in August, so August is
  // where the mismatched payment record is raised - not the event month.
  const paidInAugust = order({
    id: 'pay-aug', orderNumber: 'ORD-PAY',
    bookingDate: '2026-08-01', createdAt: '2026-08-01', eventDate: '2026-10-20', weddingDate: '2026-10-20',
    totalPrice: 2_800, totalPaid: 1_000, remainingBalance: 1_800, paymentStatus: 'fully_paid',
    paymentHistory: [{ id: 'p1', amount: 1_000, date: '2026-08-14', method: 'cash', type: 'deposit' }],
  });

  assert.deepEqual(reconcileMonthlyCash([paidInAugust], [], ...AUG).issues.map(issue => issue.kind), ['payment-status']);
  assert.deepEqual(reconcileMonthlyCash([paidInAugust], [], 2026, 8).issues, [], 'September saw none of it');
});

test('a cancellation lifecycle issue is classified by the lifecycle-event month', () => {
  // Booked and paid in June, executed in October, cancelled in August: only
  // the August review has anything to say about it.
  const cancelledInAugust = order({
    id: 'life', orderNumber: 'ORD-LIFE', orderStatus: 'cancelled_deposit_retained',
    bookingDate: '2026-06-01', createdAt: '2026-06-01', eventDate: '2026-10-20', weddingDate: '2026-10-20',
    totalPrice: 2_800, totalPaid: 1_000, remainingBalance: 1_800, paymentStatus: 'fully_paid',
    cancelledAt: '2026-08-09T09:00:00.000Z',
    cancellationHistory: [{ kind: 'cancelled_deposit_retained', at: '2026-08-09T09:00:00.000Z' }],
    paymentHistory: [{ id: 'p1', amount: 1_000, date: '2026-06-04', method: 'cash', type: 'deposit' }],
  });

  assert.deepEqual(reconcileMonthlyCash([cancelledInAugust], [], ...AUG).issues.map(issue => issue.kind), ['payment-status']);
  assert.deepEqual(reconcileMonthlyCash([cancelledInAugust], [], 2026, 8).issues, [], 'September is not its month');
  assert.deepEqual(reconcileMonthlyCash([cancelledInAugust], [], 2026, 5).issues.map(issue => issue.kind), ['payment-status'],
    'June holds the payment, so it is raised there too');
});

test('a global data fault stays visible in every month and changes no total', () => {
  const malformed = order({
    id: 'broken', orderNumber: 'ORD-BROKEN',
    bookingDate: '2026-10-01', createdAt: '2026-10-01', eventDate: '2026-10-20', weddingDate: '2026-10-20',
    totalPrice: 2_000, totalPaid: 900, remainingBalance: 1_100,
    paymentHistory: [{ id: 'p1', amount: 400, date: '2026-10-02', method: 'cash', type: 'deposit' }],
  });
  const augustOrder = order({
    id: 'aug', orderNumber: 'ORD-AUG', totalPrice: 2_000, totalPaid: 2_000, remainingBalance: 0, paymentStatus: 'fully_paid',
    paymentHistory: [{ id: 'p2', amount: 2_000, date: '2026-08-05', method: 'cash', type: 'deposit' }],
  });

  const withFault = reconcileMonthlyCash([augustOrder, malformed], [], ...AUG);
  const withoutFault = reconcileMonthlyCash([augustOrder], [], ...AUG);

  // Visible, and labelled as global rather than as August's business.
  assert.deepEqual(withFault.globalIssues.map(issue => issue.kind), ['payment-history']);
  assert.ok(withFault.globalIssues.every(issue => issue.scope === 'global'));
  assert.deepEqual(withFault.issues, [], 'and it is kept out of the monthly list');

  // It is reported just the same when a different month is selected.
  assert.deepEqual(reconcileMonthlyCash([augustOrder, malformed], [], 2026, 8).globalIssues.map(issue => issue.kind), ['payment-history']);

  // And it moves none of August's numbers.
  assert.equal(withFault.netOrderCash, withoutFault.netOrderCash);
  assert.equal(withFault.expectedProfit, withoutFault.expectedProfit);
  assert.equal(withFault.difference, withoutFault.difference);
});

test('explains the exact action when a fully-paid label conflicts with an unpaid balance', () => {
  const reconciliation = reconcileMonthlyCash([
    order({ totalPrice: 2_800, totalPaid: 1_000, remainingBalance: 1_800, paymentStatus: 'fully_paid', paymentHistory: [{ id: 'deposit', amount: 1_000, date: '2026-08-02', method: 'cash' }] }),
  ], [], 2026, 7);
  const issue = reconciliation.issues.find(item => item.kind === 'payment-status');
  assert.match(issue?.messageAr || '', /دفعة سداد بقيمة 1,800/);
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
