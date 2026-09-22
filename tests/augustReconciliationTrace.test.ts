import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyFinanceEntry, Order } from '../src/types';
import { expectedOrderProfitContribution, netOrderCashContribution } from '../src/utils/monthlyCash';
import { reconcileMonthlyCash } from '../src/utils/monthlyCashReconciliation';

/**
 * The August 2026 reconciliation reported Net Order Cash 37,275 against
 * Expected Profit 36,275 and attributed the whole 1,000 to one order.
 *
 * Both headline figures are the plain sum of the per-order helpers, so the
 * reconciliation is complete by construction: whatever produced the 1,000 did
 * so inside one order's pair of contributions. These tests reproduce every
 * shape that yields "expected 0, cash 1,000" in August and document why each
 * is the rule working rather than a fault. Cash and margin answer different
 * questions; the formulas are deliberately not made to agree.
 */

const AUG: [number, number] = [2026, 7];
const noEntries: CompanyFinanceEntry[] = [];

const order = (changes: Partial<Order>): Order => ({
  id: 'wed-749', orderNumber: 'WED-2026-749', customerId: 'c1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-07-02', weddingDate: '2026-07-20', eventDate: '2026-07-20', deliveryDate: '2026-07-20', eventLocation: '',
  totalPrice: 10_000, deposit: 0, totalPaid: 0, remainingBalance: 10_000, paymentStatus: 'unpaid',
  paymentHistory: [], orderStatus: 'confirmed', reservedItems: [], attachments: [],
  createdAt: '2026-07-02', updatedAt: '2026-07-02',
  ...changes,
});

/** One 1,000 contract payment banked in August, and no August cost. */
const augustThousand = [{ id: 'p-aug', amount: 1_000, date: '2026-08-14', method: 'Cash', type: 'settlement' as const }];

const trace = (subject: Order) => ({
  expected: expectedOrderProfitContribution(subject, ...AUG),
  cash: netOrderCashContribution(subject, [], ...AUG),
});

test('the reconciliation difference is exactly the sum of the per-order gaps', () => {
  // Two ordinary orders plus the 1,000 case: the headline gap is nothing more
  // than what the listed items say it is, so no hidden term can produce it.
  const subjects = [
    order({ id: 'a', orderNumber: 'ORD-A', eventDate: '2026-08-20', weddingDate: '2026-08-20', bookingDate: '2026-08-01' }),
    order({
      id: 'b', orderNumber: 'ORD-B', eventDate: '2026-08-10', weddingDate: '2026-08-10', bookingDate: '2026-08-01',
      totalPaid: 2_000, paymentHistory: [{ id: 'p-b', amount: 2_000, date: '2026-08-05', method: 'Cash', type: 'deposit' }],
    }),
    order({ totalPaid: 1_000, paymentHistory: augustThousand }),
  ];

  const reconciliation = reconcileMonthlyCash(subjects, noEntries, ...AUG);
  const summed = reconciliation.items.reduce((total, item) => total + item.difference, 0);
  assert.equal(reconciliation.difference, reconciliation.expectedProfit - reconciliation.netOrderCash);
  assert.equal(summed, reconciliation.difference, 'every unit of the gap is attributed to a listed order');
});

test('an order executed before August contributes no August margin, only August cash', () => {
  // The reported shape: the event ran in July, so July recognized the whole
  // contract margin. A settlement banked in August is money arriving, not a
  // second margin, so August expects 0 from it.
  const july = order({ totalPaid: 1_000, paymentHistory: augustThousand });
  const { expected, cash } = trace(july);

  assert.equal(expected, 0, 'branch (B): event month is earlier than the selected month');
  assert.equal(cash, 1_000, 'the cash really arrived in August');

  const reconciliation = reconcileMonthlyCash([july], noEntries, ...AUG);
  assert.equal(reconciliation.difference, -1_000, 'cash exceeds forecast by exactly the payment');
  assert.deepEqual(
    reconciliation.items.map((item) => [item.orderNumber, item.expectedContribution, item.cashContribution, item.reason]),
    [['WED-2026-749', 0, 1_000, 'collection-after-event-month']],
  );
});

test('an order with no event date at all can claim no month’s margin', () => {
  // `(eventDate || '').slice(0, 7) <= monthKey` is true for an empty date, so
  // the order falls into the same branch and forecasts nothing, in any month.
  const undated = order({
    eventDate: '', weddingDate: '', totalPaid: 1_000, paymentHistory: augustThousand,
  });
  const { expected, cash } = trace(undated);

  assert.equal(expected, 0);
  assert.equal(cash, 1_000);
  assert.equal(reconcileMonthlyCash([undated], noEntries, ...AUG).items[0].reason, 'missing-event-date',
    'reported as a missing event date, which is a record to fix rather than a formula to change');
});

test('a deleted order keeps the cash it really took and forecasts nothing', () => {
  const deleted = order({
    deletedAt: '2026-08-30T10:00:00.000Z', eventDate: '2026-08-20', weddingDate: '2026-08-20',
    totalPaid: 1_000, paymentHistory: augustThousand,
  });
  const { expected, cash } = trace(deleted);

  assert.equal(expected, 0, 'the work will not happen, so no margin is forecast');
  assert.equal(cash, 1_000, 'but the money it took is not un-received');
  assert.equal(reconcileMonthlyCash([deleted], noEntries, ...AUG).items[0].reason, 'deleted-order');
});

test('a plainly cancelled booking retains no profit while its cash stays in its month', () => {
  const cancelled = order({
    orderStatus: 'cancelled', eventDate: '2026-08-20', weddingDate: '2026-08-20',
    totalPaid: 1_000, paymentHistory: augustThousand,
  });
  const { expected, cash } = trace(cancelled);

  assert.equal(expected, 0, 'nothing is retained as profit');
  assert.equal(cash, 1_000);
  assert.equal(reconcileMonthlyCash([cancelled], noEntries, ...AUG).items[0].reason, 'cancelled-no-retention');
});

test('an advance beyond the contract price is customer credit, not August margin', () => {
  // The price was already collected in full earlier, so the August 1,000 is
  // money owed back rather than profit: the forecast caps at the price.
  const overpaid = order({
    eventDate: '2026-12-20', weddingDate: '2026-12-20', bookingDate: '2026-06-01', createdAt: '2026-06-01',
    totalPrice: 10_000, totalPaid: 11_000,
    paymentHistory: [
      { id: 'p-early', amount: 10_000, date: '2026-06-05', method: 'Cash', type: 'settlement' },
      ...augustThousand,
    ],
  });
  const { expected, cash } = trace(overpaid);

  assert.equal(expected, 0, 'contract headroom was already used up');
  assert.equal(cash, 1_000);
  assert.equal(reconcileMonthlyCash([overpaid], noEntries, ...AUG).items[0].reason, 'advance-for-future-event');
});

test('the same 1,000 collected for an August event is margin, not a gap', () => {
  // The control case: when August really owns the order, the 1,000 no longer
  // produces an unexplained difference - it is inside a full contract margin.
  const augustEvent = order({
    eventDate: '2026-08-20', weddingDate: '2026-08-20', bookingDate: '2026-08-01', createdAt: '2026-08-01',
    totalPrice: 1_000, totalPaid: 1_000, remainingBalance: 0, paymentStatus: 'fully_paid',
    paymentHistory: augustThousand,
  });
  const { expected, cash } = trace(augustEvent);

  assert.equal(expected, 1_000, 'branch (A): the whole contract margin belongs to the execution month');
  assert.equal(cash, 1_000);
  assert.equal(reconcileMonthlyCash([augustEvent], noEntries, ...AUG).difference, 0);
});
