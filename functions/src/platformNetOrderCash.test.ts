import assert from 'node:assert/strict';
import test from 'node:test';
import {
  platformMonthlyAccounts,
  platformNetOrderCashContribution,
  type PlatformCashOrder,
} from './platformRetainedCancellation.js';

/**
 * Parity with the app's Net Order Cash.
 *
 * Each fixture states the canonical result the app's `netOrderCashContribution`
 * produces - collections on their own dates, less `otherExpenses` at booking,
 * less worker and transport once fulfillment is recognized (charged to the
 * execution month), less order-linked entries on their own dates - and asserts
 * the platform publishes the same number. The expected values are written out
 * rather than computed, so a drift on either side fails here.
 */

const platformDate = (value: unknown) => {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
};

const order = (changes: Partial<PlatformCashOrder> = {}): PlatformCashOrder => ({
  id: 'ord-1', orderNumber: 'WED-2026-001', customerName: 'عميل', orderStatus: 'confirmed',
  totalPrice: 10_000, deposit: 0, totalPaid: 0,
  bookingDate: '2026-07-01', eventDate: '2026-09-20', weddingDate: '2026-09-20', createdAt: '2026-07-01',
  workerCost: 0, transportationCost: 0, otherExpenses: 0, paymentMethod: 'Cash',
  paymentHistory: [], fulfillmentRecognizedAt: '',
  ...changes,
});

/** Net order cash for one order, and for the published monthly figure. */
const contribution = (subject: PlatformCashOrder, month: string, expenses: Array<Record<string, unknown>> = []) =>
  platformNetOrderCashContribution(subject, expenses.filter(entry => entry.linkedOrderId), month, platformDate);

const published = (subjects: PlatformCashOrder[], month: string, expenses: Array<Record<string, unknown>> = []) =>
  platformMonthlyAccounts(subjects, expenses, month, platformDate).netMonthlyCash;

/** Asserts the per-order helper and the published total agree with the app. */
const parity = (subject: PlatformCashOrder, month: string, expected: number, expenses: Array<Record<string, unknown>> = []) => {
  assert.equal(contribution(subject, month, expenses), expected, `per-order net order cash for ${month}`);
  assert.equal(published([subject], month, expenses), expected, `published netMonthlyCash for ${month}`);
};

// 1. an incomplete future order that took a payment this month
test('an incomplete future order counts only the cash it took', () => {
  const upcoming = order({
    totalPaid: 3_000,
    paymentHistory: [{ id: 'p1', amount: 3_000, date: '2026-08-12', type: 'deposit' }],
    workerCost: 900, transportationCost: 400,
  });

  // App: 3,000 collected in August; worker and transport are not owed yet.
  parity(upcoming, '2026-08', 3_000);
  parity(upcoming, '2026-09', 0, []);
});

// 2. an incomplete order whose booking expenses were spent at registration
test('booking expenses are deducted in the booking month only', () => {
  const booked = order({
    otherExpenses: 500,
    totalPaid: 3_000,
    paymentHistory: [{ id: 'p1', amount: 3_000, date: '2026-08-12', type: 'deposit' }],
  });

  // App: July carries the 500 spent at booking, August the 3,000 collected.
  parity(booked, '2026-07', -500);
  parity(booked, '2026-08', 3_000);
});

// 3. a recognised order pays its worker and transport in the execution month
test('worker and transport are charged in the execution month once recognised', () => {
  const completed = order({
    orderStatus: 'completed',
    otherExpenses: 500, workerCost: 900, transportationCost: 400,
    totalPaid: 10_000,
    paymentHistory: [
      { id: 'p1', amount: 3_000, date: '2026-07-05', type: 'deposit' },
      { id: 'p2', amount: 7_000, date: '2026-09-20', type: 'settlement' },
    ],
  });

  // App: July 3,000 − 500 booking = 2,500; September 7,000 − 1,300 = 5,700.
  parity(completed, '2026-07', 2_500);
  parity(completed, '2026-09', 5_700);
  parity(completed, '2026-08', 0);
});

// 4. recognition belongs to the execution month, not the current status
test('a later status change does not rewrite the month that recognised the costs', () => {
  // Completed in September, then returned in November. The stamp keeps the
  // costs in September; the app must not un-spend them.
  const returnedLater = order({
    orderStatus: 'returned', fulfillmentRecognizedAt: '2026-09-20',
    workerCost: 900, transportationCost: 400,
    totalPaid: 10_000,
    paymentHistory: [{ id: 'p1', amount: 10_000, date: '2026-09-20', type: 'settlement' }],
  });

  // App: September 10,000 − 1,300 = 8,700, and November is untouched.
  parity(returnedLater, '2026-09', 8_700);
  parity(returnedLater, '2026-11', 0);

  // Without the stamp and without `completed`, the costs are not yet spent.
  const notRecognised = order({
    orderStatus: 'returned', workerCost: 900, transportationCost: 400,
    totalPaid: 10_000,
    paymentHistory: [{ id: 'p1', amount: 10_000, date: '2026-09-20', type: 'settlement' }],
  });
  parity(notRecognised, '2026-09', 10_000);
});

// 5. an expense booked against the order
test('an order-linked expense is deducted on its own date, and never twice', () => {
  const linked = [
    { id: 'e1', type: 'expense', category: 'نقل', amount: 800, date: '2026-08-18', linkedOrderId: 'ord-1' },
  ];
  const subject = order({
    totalPaid: 3_000,
    paymentHistory: [{ id: 'p1', amount: 3_000, date: '2026-08-12', type: 'deposit' }],
  });

  // App: 3,000 collected less the 800 booked against this order.
  parity(subject, '2026-08', 2_200, linked);

  // And it is not charged a second time as company overhead.
  const accounts = platformMonthlyAccounts([subject], linked, '2026-08', platformDate);
  assert.equal(accounts.operatingExpenses, 0, 'a linked entry is never general overhead');

  // A dated reversal cancels it from the month the void happened.
  const voided = [...linked, { id: 'e2', type: 'expense', category: 'نقل', amount: 800, date: '2026-09-02', linkedOrderId: 'ord-1', isReversal: true }];
  parity(subject, '2026-09', 800, voided);
});

// 6. a refund
test('a refund is negative cash in the month the money went back', () => {
  const refunded = order({
    totalPaid: 2_600,
    paymentHistory: [
      { id: 'p1', amount: 3_000, date: '2026-08-12', type: 'deposit' },
      { id: 'r1', amount: 400, date: '2026-10-06', type: 'refund' },
    ],
  });

  parity(refunded, '2026-08', 3_000);
  parity(refunded, '2026-10', -400);
});

// 7. a plainly cancelled booking
test('a cancelled booking keeps its real cash on its real dates', () => {
  const cancelled = order({
    orderStatus: 'cancelled', otherExpenses: 500,
    totalPaid: 3_000,
    paymentHistory: [{ id: 'p1', amount: 3_000, date: '2026-08-12', type: 'deposit' }],
  });

  // App: the booking cost stays spent in July, the receipt stays in August.
  parity(cancelled, '2026-07', -500);
  parity(cancelled, '2026-08', 3_000);
});

// 8. a retained cancellation
test('a retained cancellation has the same cash timing as any other order', () => {
  const retained = order({
    orderStatus: 'cancelled_deposit_retained',
    totalPaid: 3_000,
    paymentHistory: [{ id: 'p1', amount: 3_000, date: '2026-08-12', type: 'deposit' }],
  });

  parity(retained, '2026-08', 3_000);
  parity(retained, '2026-09', 0, []);

  // The status changes how the money is classified as profit, never when the
  // cash is counted: a variant spelling reports the same cash too.
  for (const status of ['CANCELLED_DEPOSIT_RETAINED', 'cancelled-deposit-retained', 'cancelled_deposit_retained ']) {
    parity({ ...retained, orderStatus: status }, '2026-08', 3_000);
  }
});

// 9. security entries
test('security entries are ignored by net order cash entirely', () => {
  const withSecurity = order({
    totalPaid: 3_000,
    paymentHistory: [
      { id: 'p1', amount: 3_000, date: '2026-08-12', type: 'deposit' },
      { id: 's1', amount: 2_000, date: '2026-08-13', type: 'security_deposit' },
      { id: 's2', amount: 500, date: '2026-09-04', type: 'security_refund' },
    ],
  });

  parity(withSecurity, '2026-08', 3_000);
  parity(withSecurity, '2026-09', 0);
});

// 10. payments spread across months
test('each payment counts in its own month, and nothing is counted twice', () => {
  const spread = order({
    orderStatus: 'completed',
    otherExpenses: 300, workerCost: 700, transportationCost: 200,
    totalPaid: 10_000,
    paymentHistory: [
      { id: 'p1', amount: 2_000, date: '2026-07-10', type: 'deposit' },
      { id: 'p2', amount: 3_000, date: '2026-08-15', type: 'settlement' },
      { id: 'p3', amount: 5_000, date: '2026-09-25', type: 'settlement' },
    ],
  });
  const linked = [{ id: 'e1', type: 'expense', category: 'نقل', amount: 400, date: '2026-08-20', linkedOrderId: 'ord-1' }];

  // App: July 2,000 − 300 = 1,700; August 3,000 − 400 = 2,600;
  // September 5,000 − 900 = 4,100.
  parity(spread, '2026-07', 1_700, linked);
  parity(spread, '2026-08', 2_600, linked);
  parity(spread, '2026-09', 4_100, linked);

  // Across the order's life: 10,000 collected less 300 + 900 + 400 of costs.
  const total = ['2026-07', '2026-08', '2026-09'].reduce((sum, month) => sum + contribution(spread, month, linked), 0);
  assert.equal(total, 8_400, 'every amount is counted exactly once');
});

test('capital is never part of net order cash', () => {
  const capital = [{ id: 'c1', type: 'capital', category: 'رأس مال', amount: 50_000, date: '2026-08-02' }];
  const subject = order({
    totalPaid: 3_000,
    paymentHistory: [{ id: 'p1', amount: 3_000, date: '2026-08-12', type: 'deposit' }],
  });

  assert.equal(published([subject], '2026-08', capital), 3_000, 'money put into the business is treasury, not order cash');
});

test('several orders sum into the published monthly figure', () => {
  const linked = [{ id: 'e1', type: 'expense', category: 'نقل', amount: 400, date: '2026-08-20', linkedOrderId: 'ord-2' }];
  const first = order({
    id: 'ord-1', totalPaid: 3_000,
    paymentHistory: [{ id: 'p1', amount: 3_000, date: '2026-08-12', type: 'deposit' }],
  });
  const second = order({
    id: 'ord-2', orderNumber: 'WED-2026-002', orderStatus: 'cancelled', bookingDate: '2026-08-01', createdAt: '2026-08-01',
    otherExpenses: 600, totalPaid: 1_000,
    paymentHistory: [{ id: 'p2', amount: 1_000, date: '2026-08-05', type: 'deposit' }],
  });

  // App: (3,000) + (1,000 − 600 booking − 400 linked) = 3,000.
  assert.equal(published([first, second], '2026-08', linked), 3_000);
});
