import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPlatformRetainedCancellation,
  platformCashCollections,
  platformMonthlyAccounts,
  type PlatformCashOrder,
} from './platformRetainedCancellation.js';

/**
 * The platform aggregation must publish the same retained-cancellation figures
 * the app does: the kept money is profit in the month it was received, and a
 * legacy status spelling is read the same as the canonical one.
 */

const platformDate = (value: unknown) => {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
};

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

const order = (changes: Partial<PlatformCashOrder> = {}): PlatformCashOrder => ({
  id: 'wed-749', orderNumber: 'WED-2026-749', customerName: 'عميل', orderStatus: CANONICAL,
  totalPrice: 4_000, deposit: 1_000, totalPaid: 1_000,
  bookingDate: '', eventDate: '', weddingDate: '', createdAt: '2026-07-01',
  workerCost: 0, transportationCost: 0, otherExpenses: 0, paymentMethod: 'Cash', fulfillmentRecognizedAt: '',
  paymentHistory: [{ id: 'p1', amount: 1_000, date: '2026-07-14', type: 'deposit' }],
  ...changes,
});

const accounts = (subject: PlatformCashOrder, month: string) => platformMonthlyAccounts([subject], [], month, platformDate);

// --- the tolerant predicate --------------------------------------------------

test('the canonical retained status is recognised', () => {
  assert.equal(isPlatformRetainedCancellation(CANONICAL), true);
});

test('a trailing-space variant is recognised', () => {
  assert.equal(isPlatformRetainedCancellation('cancelled_deposit_retained '), true);
  assert.equal(isPlatformRetainedCancellation('  cancelled_deposit_retained  '), true);
});

test('an uppercase variant is recognised', () => {
  assert.equal(isPlatformRetainedCancellation('CANCELLED_DEPOSIT_RETAINED'), true);
  assert.equal(isPlatformRetainedCancellation('Cancelled_Deposit_Retained'), true);
});

test('a hyphen or space variant is recognised', () => {
  assert.equal(isPlatformRetainedCancellation('cancelled-deposit-retained'), true);
  assert.equal(isPlatformRetainedCancellation('cancelled deposit retained'), true);
});

test('nothing else is recognised as retained', () => {
  for (const other of ['cancelled', 'completed', 'confirmed', 'returned', '', undefined, null, 'deposit_retained']) {
    assert.equal(isPlatformRetainedCancellation(other), false, String(other));
  }
});

// --- retained profit follows the money ---------------------------------------

test('a payment in July is retained profit in July, whatever month it was cancelled', () => {
  // Paid 14 July, cancelled with the money kept in September.
  const subject = order({ paymentHistory: [{ id: 'p1', amount: 1_000, date: '2026-07-14', type: 'deposit' }] });

  assert.equal(accounts(subject, '2026-07').retainedCancelledDeposits, 1_000, 'July holds the money');
  assert.equal(accounts(subject, '2026-07').netMonthlyOrderProfit, 1_000);
  assert.equal(accounts(subject, '2026-09').retainedCancelledDeposits, 0, 'the cancellation recognises nothing');
  assert.equal(accounts(subject, '2026-09').netMonthlyOrderProfit, 0);
  assert.equal(accounts(subject, '2026-09').netMonthlyCash, 0, 'and creates no cash');
});

test('a refund is a negative adjustment in the month it went back', () => {
  const refunded = order({
    totalPaid: 600,
    paymentHistory: [
      { id: 'p1', amount: 1_000, date: '2026-07-14', type: 'deposit' },
      { id: 'r1', amount: 400, date: '2026-10-06', type: 'refund' },
    ],
  });

  assert.equal(accounts(refunded, '2026-07').retainedCancelledDeposits, 1_000, 'July keeps what it reported');
  assert.equal(accounts(refunded, '2026-10').retainedCancelledDeposits, -400, 'October carries the reversal');
  assert.equal(accounts(refunded, '2026-10').netMonthlyOrderProfit, -400);
  assert.equal(accounts(refunded, '2026-10').netMonthlyCash, -400, 'and the cash leaves with it');
});

test('payments in different months are each recognised in their own month', () => {
  const split = order({
    totalPaid: 3_000,
    paymentHistory: [
      { id: 'p1', amount: 1_000, date: '2026-08-05', type: 'deposit' },
      { id: 'p2', amount: 2_000, date: '2026-09-18', type: 'settlement' },
    ],
  });

  assert.equal(accounts(split, '2026-08').retainedCancelledDeposits, 1_000);
  assert.equal(accounts(split, '2026-09').retainedCancelledDeposits, 2_000);
});

test('a missing event date does not suppress retained profit', () => {
  for (const eventDate of ['', '2026-01-10', '2027-05-01']) {
    const subject = order({ eventDate, weddingDate: eventDate });
    assert.equal(accounts(subject, '2026-07').retainedCancelledDeposits, 1_000, `event date ${JSON.stringify(eventDate)}`);
    assert.equal(accounts(subject, '2026-07').netMonthlyOrderProfit, 1_000, 'and it is not given an event margin either');
  }
});

test('a plainly cancelled order retains nothing', () => {
  const plain = order({ orderStatus: 'cancelled' });

  assert.equal(accounts(plain, '2026-07').retainedCancelledDeposits, 0);
  assert.equal(accounts(plain, '2026-07').netMonthlyOrderProfit, 0);
});

test('legacy security movements contribute nothing', () => {
  const withSecurity = order({
    paymentHistory: [
      { id: 'p1', amount: 1_000, date: '2026-07-14', type: 'deposit' },
      { id: 's1', amount: 2_000, date: '2026-07-15', type: 'security_deposit' },
      { id: 's2', amount: 500, date: '2026-08-04', type: 'security_refund' },
    ],
  });

  assert.equal(accounts(withSecurity, '2026-07').retainedCancelledDeposits, 1_000, 'the 2,000 security is invisible');
  assert.equal(accounts(withSecurity, '2026-07').grossMonthlyIncome, 1_000, 'and it is not income');
  assert.equal(accounts(withSecurity, '2026-08').retainedCancelledDeposits, 0, 'nor is its refund');
  assert.deepEqual(
    platformCashCollections(withSecurity, platformDate).map(entry => entry.amount),
    [1_000],
    'security entries never become collections',
  );
});

test('a cancellation on its own creates neither profit nor cash', () => {
  const noMoney = order({ deposit: 0, totalPaid: 0, paymentHistory: [] });

  for (const month of ['2026-07', '2026-08', '2026-09']) {
    assert.equal(accounts(noMoney, month).retainedCancelledDeposits, 0, month);
    assert.equal(accounts(noMoney, month).netMonthlyCash, 0, month);
  }
});

// --- every spelling publishes the same numbers -------------------------------

test('canonical and legacy spellings produce identical platform analytics', () => {
  const months = ['2026-07', '2026-08', '2026-09', '2026-10'];
  const shape = (status: string) => {
    const subject = order({
      orderStatus: status,
      totalPaid: 600,
      paymentHistory: [
        { id: 'p1', amount: 1_000, date: '2026-07-14', type: 'deposit' },
        { id: 'r1', amount: 400, date: '2026-10-06', type: 'refund' },
      ],
    });
    return months.map(month => accounts(subject, month));
  };

  const canonical = shape(CANONICAL);
  for (const status of SPELLINGS) {
    assert.deepEqual(shape(status), canonical, `${JSON.stringify(status)} must publish the canonical figures`);
  }

  // And the figures are the ones the app publishes for the same record.
  assert.equal(canonical[0].retainedCancelledDeposits, 1_000, 'July');
  assert.equal(canonical[3].retainedCancelledDeposits, -400, 'October');
});

test('a variant spelling is never counted as an upcoming active order', () => {
  for (const status of SPELLINGS) {
    const subject = order({ orderStatus: status, eventDate: '2026-11-20', weddingDate: '2026-11-20' });
    const july = accounts(subject, '2026-07');
    assert.equal(july.retainedCancelledDeposits, 1_000, JSON.stringify(status));

    // Its outstanding balance is never expected to be settled, and its
    // contract margin is never forecast for the execution month.
    assert.equal(accounts(subject, '2026-11').expectedSettlementPayments, 0, JSON.stringify(status));
    assert.equal(accounts(subject, '2026-11').netMonthlyOrderProfit, 0, JSON.stringify(status));
  }
});

test('an ordinary active order is unaffected by the retained rule', () => {
  const active = order({
    orderStatus: 'confirmed', eventDate: '2026-11-20', weddingDate: '2026-11-20', bookingDate: '2026-07-01',
    totalPrice: 4_000, totalPaid: 1_000,
  });

  const july = accounts(active, '2026-07');
  assert.equal(july.retainedCancelledDeposits, 0, 'not retained');
  assert.equal(july.grossMonthlyIncome, 1_000, 'its deposit is ordinary income');
  assert.equal(accounts(active, '2026-11').expectedSettlementPayments, 3_000, 'and its balance is still expected');
  assert.equal(accounts(active, '2026-11').netMonthlyOrderProfit, 4_000, 'with its full contract margin');
});

// --- a plainly cancelled booking keeps its real cash -------------------------

/**
 * Cancelling a booking does not un-receive the money it took. The platform
 * used to drop these orders out of the collection path entirely, which deleted
 * real cash from the company's figures; the app has always kept it.
 */
const cancelledOrder = (changes: Partial<PlatformCashOrder> = {}): PlatformCashOrder => order({
  orderStatus: 'cancelled',
  paymentHistory: [{ id: 'p1', amount: 1_000, date: '2026-07-14', type: 'deposit' }],
  ...changes,
});

test('a cancelled order keeps its July payment in July cash', () => {
  const subject = cancelledOrder();
  const july = accounts(subject, '2026-07');

  assert.equal(july.grossMonthlyIncome, 1_000, 'the money really arrived');
  assert.equal(july.netMonthlyCash, 1_000, 'and it is not deleted from the month');
});

test('a cancelled order forecasts and retains no profit', () => {
  const subject = cancelledOrder({ eventDate: '2026-11-20', weddingDate: '2026-11-20' });

  assert.equal(accounts(subject, '2026-07').retainedCancelledDeposits, 0, 'nothing is retained');
  assert.equal(accounts(subject, '2026-07').netMonthlyOrderProfit, 0);
  assert.equal(accounts(subject, '2026-11').netMonthlyOrderProfit, 0, 'no contract margin in its event month');
  assert.equal(accounts(subject, '2026-11').expectedSettlementPayments, 0, 'and no settlement is expected');
});

test('a later refund on a cancelled order is negative cash in its refund month', () => {
  const refunded = cancelledOrder({
    totalPaid: 600,
    paymentHistory: [
      { id: 'p1', amount: 1_000, date: '2026-07-14', type: 'deposit' },
      { id: 'r1', amount: 400, date: '2026-10-06', type: 'refund' },
    ],
  });

  assert.equal(accounts(refunded, '2026-07').netMonthlyCash, 1_000, 'July keeps what it took');
  assert.equal(accounts(refunded, '2026-10').netMonthlyCash, -400, 'October carries the money going back');
  assert.equal(accounts(refunded, '2026-10').netMonthlyOrderProfit, 0, 'and it is still no profit either way');
});

test('cancelling on its own moves no cash for a plainly cancelled order', () => {
  const noMoney = cancelledOrder({ deposit: 0, totalPaid: 0, paymentHistory: [] });

  for (const month of ['2026-07', '2026-08', '2026-09']) {
    assert.equal(accounts(noMoney, month).netMonthlyCash, 0, month);
    assert.equal(accounts(noMoney, month).grossMonthlyIncome, 0, month);
  }
});

test('security movements on a cancelled order still count for nothing', () => {
  const withSecurity = cancelledOrder({
    paymentHistory: [
      { id: 'p1', amount: 1_000, date: '2026-07-14', type: 'deposit' },
      { id: 's1', amount: 2_000, date: '2026-07-15', type: 'security_deposit' },
      { id: 's2', amount: 500, date: '2026-08-04', type: 'security_refund' },
    ],
  });

  assert.equal(accounts(withSecurity, '2026-07').netMonthlyCash, 1_000, 'the 2,000 security is invisible');
  assert.equal(accounts(withSecurity, '2026-07').grossMonthlyIncome, 1_000);
  assert.equal(accounts(withSecurity, '2026-08').netMonthlyCash, 0, 'and so is its refund');
});

test('platform cash matches the app for the same cancelled fixture', () => {
  // The app's `netOrderCashContribution` for this record is +1,000 in July and
  // -400 in October, with zero expected profit in every month. These are the
  // same figures, computed independently here.
  const subject = cancelledOrder({
    totalPaid: 600,
    bookingDate: '2026-07-01',
    paymentHistory: [
      { id: 'p1', amount: 1_000, date: '2026-07-14', type: 'deposit' },
      { id: 'r1', amount: 400, date: '2026-10-06', type: 'refund' },
    ],
  });

  const appNetOrderCash: Record<string, number> = { '2026-07': 1_000, '2026-08': 0, '2026-09': 0, '2026-10': -400 };
  for (const [month, expected] of Object.entries(appNetOrderCash)) {
    assert.equal(accounts(subject, month).netMonthlyCash, expected, `net cash for ${month}`);
    assert.equal(accounts(subject, month).netMonthlyOrderProfit, 0, `no profit in ${month}`);
  }
});
