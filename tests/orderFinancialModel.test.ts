import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyFinanceEntry, Order } from '../src/types';
import { orderFinancialPosition } from '../src/utils/orderPaymentState';
import { cancellationMetadata } from '../src/utils/financialRetention';
import {
  calculateFinancePeriodCash,
  calculateMonthlyCash,
  calculateSafeBalanceToDate,
  expectedOrderProfitContribution,
  netOrderCashContribution,
  retainedCancellationsMissingDate,
} from '../src/utils/monthlyCash';

const order = (changes: Partial<Order>): Order => ({
  id: 'order-1', orderNumber: 'ORD-1', customerId: 'c1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-08-02', weddingDate: '2026-08-20', eventDate: '2026-08-20', deliveryDate: '2026-08-20', eventLocation: '',
  totalPrice: 10_000, deposit: 0, totalPaid: 0, remainingBalance: 10_000, paymentStatus: 'unpaid',
  paymentHistory: [], orderStatus: 'confirmed', reservedItems: [], attachments: [], createdAt: '2026-08-02', updatedAt: '2026-08-02',
  ...changes,
});

const AUG = [2026, 7] as const;
const SEP = [2026, 8] as const;

// --- Scenario A / B: net order cash vs expected profit ----------------------

test('Scenario A: an incomplete order subtracts only its booking-time other expenses', () => {
  const incomplete = order({
    totalPrice: 10_000, totalPaid: 2_000, remainingBalance: 8_000, paymentStatus: 'partially_paid',
    otherExpenses: 300, workerCost: 500, transportationCost: 200,
    paymentHistory: [{ id: 'pay_1', amount: 2_000, date: '2026-08-02', method: 'Cash', type: 'deposit' }],
  });

  // 2,000 collected - 300 booked. Worker and transport are still a plan.
  assert.equal(netOrderCashContribution(incomplete, [], ...AUG), 1_700);
  assert.equal(expectedOrderProfitContribution(incomplete, ...AUG), 9_000); // 10,000 - 300 - 500 - 200
});

test('Scenario B: a completed order subtracts worker, transport and other expenses', () => {
  const completed = order({
    orderStatus: 'completed', fulfillmentRecognizedAt: '2026-08-20T18:00:00.000Z',
    totalPrice: 10_000, totalPaid: 10_000, remainingBalance: 0, paymentStatus: 'fully_paid',
    otherExpenses: 300, workerCost: 500, transportationCost: 200,
    paymentHistory: [{ id: 'pay_1', amount: 10_000, date: '2026-08-20', method: 'Cash', type: 'settlement' }],
  });

  assert.equal(netOrderCashContribution(completed, [], ...AUG), 9_000); // 10,000 - 300 - 500 - 200
  assert.equal(expectedOrderProfitContribution(completed, ...AUG), 9_000);
});

test('completion does not deduct the booking expenses a second time', () => {
  // Booked in August, executed in September.
  const carried = order({
    bookingDate: '2026-08-02', createdAt: '2026-08-02', eventDate: '2026-09-10', weddingDate: '2026-09-10',
    orderStatus: 'completed', fulfillmentRecognizedAt: '2026-09-10T18:00:00.000Z',
    totalPrice: 10_000, totalPaid: 10_000, remainingBalance: 0, paymentStatus: 'fully_paid',
    otherExpenses: 300, workerCost: 500, transportationCost: 200,
    paymentHistory: [
      { id: 'pay_1', amount: 2_000, date: '2026-08-02', method: 'Cash', type: 'deposit' },
      { id: 'pay_2', amount: 8_000, date: '2026-09-10', method: 'Cash', type: 'settlement' },
    ],
  });

  const august = netOrderCashContribution(carried, [], ...AUG);
  const september = netOrderCashContribution(carried, [], ...SEP);

  assert.equal(august, 1_700, 'August: 2,000 collected - 300 booked');
  assert.equal(september, 7_300, 'September: 8,000 collected - 700 fulfillment, and no second 300');
  assert.equal(august + september, 9_000, 'each cost is charged exactly once across the two months');
});

test('a refund reduces actual net order cash in the month the money went back', () => {
  const refunded = order({
    orderStatus: 'cancelled', deposit: 2_000, totalPaid: 0, remainingBalance: 10_000, paymentStatus: 'unpaid',
    paymentHistory: [
      { id: 'pay_1', amount: 2_000, date: '2026-08-02', method: 'Cash', type: 'deposit' },
      { id: 'refund_1', amount: 2_000, date: '2026-09-11', method: 'Cash', type: 'refund' },
    ],
  });

  assert.equal(netOrderCashContribution(refunded, [], ...AUG), 2_000, 'August keeps the receipt it reported');
  assert.equal(netOrderCashContribution(refunded, [], ...SEP), -2_000, 'September carries the outflow');
  assert.equal(expectedOrderProfitContribution(refunded, ...AUG), 0, 'a refund never touches contract margin');
});

test('a cancelled order preserves the cash it really took', () => {
  const cancelled = order({
    orderStatus: 'cancelled', otherExpenses: 300, deposit: 1_500, totalPaid: 1_500,
    paymentHistory: [{ id: 'pay_1', amount: 1_500, date: '2026-08-02', method: 'Cash', type: 'deposit' }],
  });

  assert.equal(netOrderCashContribution(cancelled, [], ...AUG), 1_200, '1,500 taken, 300 already spent on it');
  assert.equal(expectedOrderProfitContribution(cancelled, ...AUG), 0, 'but it will not happen, so no margin');
});

// --- expected profit -------------------------------------------------------

test('expected profit uses the full contract value, not the cash collected so far', () => {
  const barelyPaid = order({ totalPrice: 10_000, totalPaid: 1, otherExpenses: 300, workerCost: 500, transportationCost: 200 });
  assert.equal(expectedOrderProfitContribution(barelyPaid, ...AUG), 9_000);

  const unpaid = order({ totalPrice: 10_000, totalPaid: 0, otherExpenses: 300, workerCost: 500, transportationCost: 200 });
  assert.equal(expectedOrderProfitContribution(unpaid, ...AUG), 9_000, 'collection has no bearing on margin');
});

test('expected profit subtracts all three direct order costs and nothing else', () => {
  const withCosts = order({ totalPrice: 10_000, otherExpenses: 300, workerCost: 500, transportationCost: 200 });
  const withoutCosts = order({ totalPrice: 10_000, otherExpenses: 0, workerCost: 0, transportationCost: 0 });

  assert.equal(expectedOrderProfitContribution(withCosts, ...AUG), 9_000);
  assert.equal(expectedOrderProfitContribution(withoutCosts, ...AUG), 10_000);
  assert.equal(expectedOrderProfitContribution(withCosts, ...SEP), 0, 'only the month the event is scheduled in');
});

test('cancelled orders are excluded from expected profit, retained deposit or not', () => {
  for (const orderStatus of ['cancelled', 'cancelled_deposit_retained'] as const) {
    assert.equal(expectedOrderProfitContribution(order({ orderStatus, totalPrice: 10_000 }), ...AUG), 0);
  }
  // A completed order scheduled this month still counts.
  assert.equal(expectedOrderProfitContribution(order({ orderStatus: 'completed', totalPrice: 10_000 }), ...AUG), 10_000);
});

test('a company operating expense does not change expected order profit', () => {
  const scheduled = [order({ totalPrice: 10_000, otherExpenses: 300, workerCost: 500, transportationCost: 200 })];
  const salaries: CompanyFinanceEntry[] = [
    { id: 'salary', type: 'expense', category: 'مرتبات', amount: 8_000, date: '2026-08-10', createdAt: '' },
    { id: 'rent', type: 'expense', category: 'إيجار', amount: 4_000, date: '2026-08-01', createdAt: '' },
  ];

  assert.equal(calculateMonthlyCash(scheduled, [], ...AUG).expectedOrderProfit, 9_000);
  assert.equal(calculateMonthlyCash(scheduled, salaries, ...AUG).expectedOrderProfit, 9_000);
});

// --- the exactly-once rule --------------------------------------------------

test('an order-linked expense is an order cost, never also a general expense', () => {
  const linked: CompanyFinanceEntry[] = [
    { id: 'exp_linked', type: 'expense', category: 'شراء خامات', amount: 400, date: '2026-08-05', linkedOrderId: 'order-1', createdAt: '' },
    { id: 'exp_rent', type: 'expense', category: 'إيجار', amount: 1_000, date: '2026-08-05', createdAt: '' },
  ];
  const paid = order({
    totalPaid: 5_000, paymentHistory: [{ id: 'pay_1', amount: 5_000, date: '2026-08-02', method: 'Cash', type: 'deposit' }],
  });

  const summary = calculateMonthlyCash([paid], linked, ...AUG);

  assert.equal(summary.generalOperatingExpenses, 1_000, 'only the rent is a company operating cost');
  assert.equal(summary.netOrderCash, 4_600, '5,000 collected - the 400 spent on this order');
  // The 400 is subtracted once in total, not once here and once in the ledger.
  assert.equal(summary.netOrderCash - summary.generalOperatingExpenses, 3_600);
});

// --- treasury ---------------------------------------------------------------

const capital = (amount: number, date: string): CompanyFinanceEntry =>
  ({ id: `cap_${date}`, type: 'capital', category: 'رأس مال', amount, date, createdAt: '' });
const expense = (amount: number, date: string): CompanyFinanceEntry =>
  ({ id: `exp_${date}`, type: 'expense', category: 'مرتبات', amount, date, createdAt: '' });

test('Scenario C: remaining operating balance and total treasury balance', () => {
  // Opening 38,815 is whatever the previous month ended with; it is modelled
  // here as capital placed before the period so the opening carry is real.
  const entries = [capital(38_815, '2026-07-01'), expense(38_800, '2026-08-10')];
  const collected = order({
    totalPaid: 42_025, paymentHistory: [{ id: 'pay_1', amount: 42_025, date: '2026-08-15', method: 'Cash', type: 'deposit' }],
  });

  const result = calculateFinancePeriodCash([collected], entries, '2026-08', '2026-08');

  assert.equal(result.openingCarriedBalance, 38_815);
  assert.equal(result.capitalAdded, 0);
  assert.equal(result.generalOperatingExpenses, 38_800);
  assert.equal(result.netOrderCash, 42_025);
  assert.equal(result.remainingOperatingBalance, 15); // 38,815 + 0 - 38,800
  assert.equal(result.totalTreasuryBalance, 42_040); // 15 + 42,025
});

test('Scenario D: a capital injection raises the operating balance exactly once', () => {
  const entries = [capital(10_000, '2026-07-01'), capital(5_000, '2026-08-05'), expense(8_000, '2026-08-10')];
  const collected = order({
    totalPaid: 20_000, paymentHistory: [{ id: 'pay_1', amount: 20_000, date: '2026-08-15', method: 'Cash', type: 'deposit' }],
  });

  const result = calculateFinancePeriodCash([collected], entries, '2026-08', '2026-08');

  assert.equal(result.openingCarriedBalance, 10_000);
  assert.equal(result.capitalAdded, 5_000);
  assert.equal(result.remainingOperatingBalance, 7_000); // 10,000 + 5,000 - 8,000
  assert.equal(result.totalTreasuryBalance, 27_000); // 7,000 + 20,000
  // Counted once: adding it again to the total would give 32,000.
  assert.equal(result.remainingOperatingBalance + result.netOrderCash, result.totalTreasuryBalance);
});

test('a general expense reduces the operating balance and nothing else', () => {
  const base = [capital(10_000, '2026-07-01')];
  const withExpense = [...base, expense(3_000, '2026-08-10')];
  const collected = order({
    totalPaid: 1_000, paymentHistory: [{ id: 'pay_1', amount: 1_000, date: '2026-08-15', method: 'Cash', type: 'deposit' }],
  });

  const before = calculateFinancePeriodCash([collected], base, '2026-08', '2026-08');
  const after = calculateFinancePeriodCash([collected], withExpense, '2026-08', '2026-08');

  assert.equal(before.remainingOperatingBalance - after.remainingOperatingBalance, 3_000);
  assert.equal(after.netOrderCash, before.netOrderCash, 'order cash is untouched by company costs');
  assert.equal(before.totalTreasuryBalance - after.totalTreasuryBalance, 3_000);
});

test('total treasury balance is always remaining operating balance plus net order cash', () => {
  const entries = [capital(4_000, '2026-07-01'), capital(1_000, '2026-08-02'), expense(2_500, '2026-08-09')];
  const orders = [
    order({ totalPaid: 3_000, otherExpenses: 250, paymentHistory: [{ id: 'a', amount: 3_000, date: '2026-08-04', method: 'Cash', type: 'deposit' }] }),
    order({ id: 'order-2', orderStatus: 'cancelled', deposit: 500, totalPaid: 500, paymentHistory: [{ id: 'b', amount: 500, date: '2026-08-06', method: 'Cash', type: 'deposit' }] }),
  ];

  const result = calculateFinancePeriodCash(orders, entries, '2026-08', '2026-08');

  assert.equal(result.totalTreasuryBalance, result.remainingOperatingBalance + result.netOrderCash);
  assert.equal(
    result.totalTreasuryBalance,
    result.openingCarriedBalance + result.capitalAdded - result.generalOperatingExpenses + result.netOrderCash,
  );
});

test("this month's ending treasury becomes next month's opening carry, across a year boundary", () => {
  const entries = [capital(6_000, '2026-11-01'), expense(1_000, '2026-12-05'), expense(900, '2027-01-07')];
  const orders = [
    order({
      id: 'dec', bookingDate: '2026-12-03', createdAt: '2026-12-03', eventDate: '2026-12-20', weddingDate: '2026-12-20',
      totalPaid: 2_000, otherExpenses: 100,
      paymentHistory: [{ id: 'dec_pay', amount: 2_000, date: '2026-12-03', method: 'Cash', type: 'deposit' }],
    }),
    order({
      id: 'jan', bookingDate: '2027-01-04', createdAt: '2027-01-04', eventDate: '2027-01-25', weddingDate: '2027-01-25',
      totalPaid: 700, paymentHistory: [{ id: 'jan_pay', amount: 700, date: '2027-01-04', method: 'Cash', type: 'deposit' }],
    }),
  ];

  const december = calculateFinancePeriodCash(orders, entries, '2026-12', '2026-12');
  const january = calculateFinancePeriodCash(orders, entries, '2027-01', '2027-01');

  assert.equal(december.openingCarriedBalance, 6_000);
  assert.equal(december.remainingOperatingBalance, 5_000); // 6,000 - 1,000
  assert.equal(december.netOrderCash, 1_900); // 2,000 - 100
  assert.equal(december.totalTreasuryBalance, 6_900);

  // January opens with exactly what December ended with, over the year change.
  assert.equal(january.openingCarriedBalance, december.totalTreasuryBalance);
  assert.equal(january.remainingOperatingBalance, 6_000); // 6,900 - 900
  assert.equal(january.netOrderCash, 700);
  assert.equal(january.totalTreasuryBalance, 6_700);
});

test('Scenario E: an earlier receipt stays in its month while the refund lands in its own', () => {
  const entries: CompanyFinanceEntry[] = [];
  const refunded = [order({
    orderStatus: 'cancelled', deposit: 900, totalPaid: 0, paymentHistory: [
      { id: 'pay_1', amount: 900, date: '2026-08-06', method: 'Cash', type: 'deposit' },
      { id: 'refund_1', amount: 900, date: '2026-09-11', method: 'Cash', type: 'refund' },
    ],
  })];

  const august = calculateFinancePeriodCash(refunded, entries, '2026-08', '2026-08');
  const september = calculateFinancePeriodCash(refunded, entries, '2026-09', '2026-09');

  assert.equal(august.netOrderCash, 900, 'the original receipt is untouched');
  assert.equal(august.totalTreasuryBalance, 900);
  assert.equal(september.openingCarriedBalance, 900);
  assert.equal(september.netOrderCash, -900, 'the refund is its own dated movement');
  assert.equal(september.totalTreasuryBalance, 0);
});

test('a soft-deleted retained order forecasts no margin but keeps its actual cash', () => {
  // Deleted operationally, kept by Phase 2 because it carries posted payments.
  const deleted = order({
    id: 'deleted', eventDate: '2026-08-20', weddingDate: '2026-08-20', bookingDate: '2026-08-02',
    totalPrice: 12_000, otherExpenses: 200, workerCost: 1_000, transportationCost: 500,
    totalPaid: 3_000, remainingBalance: 9_000, paymentStatus: 'partially_paid',
    paymentHistory: [{ id: 'pay_1', amount: 3_000, date: '2026-08-02', method: 'Cash', type: 'deposit' }],
    deletedAt: '2026-08-05T00:00:00.000Z', financiallyRetained: true,
  });
  const live = { ...deleted, id: 'live', deletedAt: null, financiallyRetained: false };

  // The work will not happen, so it forecasts nothing - while an otherwise
  // identical live order still does.
  assert.equal(expectedOrderProfitContribution(deleted, ...AUG), 0);
  assert.equal(expectedOrderProfitContribution(live, ...AUG), 10_300); // 12,000 - 200 - 1,000 - 500

  // Its real cash is untouched: 3,000 collected less the 200 spent at booking.
  assert.equal(netOrderCashContribution(deleted, [], ...AUG), 2_800);
  assert.equal(netOrderCashContribution(deleted, [], ...AUG), netOrderCashContribution(live, [], ...AUG));

  const summary = calculateMonthlyCash([deleted], [], ...AUG);
  assert.equal(summary.expectedOrderProfit, 0);
  assert.equal(summary.netOrderCash, 2_800);
  assert.equal(calculateSafeBalanceToDate([deleted], [], new Date(2026, 7, 31)), 2_800, 'treasury keeps the money it really holds');

  // Archiving is operational tidying of real history, not cancellation, so an
  // archived order still forecasts its margin.
  const archived = { ...live, id: 'archived', archivedAt: '2027-03-01T00:00:00.000Z' };
  assert.equal(expectedOrderProfitContribution(archived, ...AUG), 10_300);
});

// --- Expected profit: executed margin plus advances for later months --------

const DEC = [2026, 11] as const;
const OCT = [2026, 9] as const;
const NOV = [2026, 10] as const;

test('an order executed this month contributes its full contract margin', () => {
  const executed = order({
    eventDate: '2026-09-15', weddingDate: '2026-09-15', bookingDate: '2026-09-01', createdAt: '2026-09-01',
    totalPrice: 10_000, otherExpenses: 300, workerCost: 500, transportationCost: 200,
    // Barely collected: the margin is owed to the month regardless.
    totalPaid: 1_000, paymentHistory: [{ id: 'p1', amount: 1_000, date: '2026-09-05', method: 'Cash', type: 'deposit' }],
  });

  assert.equal(expectedOrderProfitContribution(executed, ...SEP), 9_000); // 10,000 - 300 - 500 - 200
});

test('a payment taken this month for a later event counts, less this month booking cost', () => {
  const future = order({
    id: 'dec', bookingDate: '2026-09-15', createdAt: '2026-09-15',
    eventDate: '2026-12-20', weddingDate: '2026-12-20',
    totalPrice: 40_000, otherExpenses: 300, workerCost: 500, transportationCost: 200,
    totalPaid: 5_000, paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' }],
  });

  // 5,000 in, 300 spent at booking. Worker and transport are not owed yet.
  assert.equal(expectedOrderProfitContribution(future, ...SEP), 4_700);
  // December still earns the whole margin when the work happens.
  assert.equal(expectedOrderProfitContribution(future, ...DEC), 39_000); // 40,000 - 300 - 500 - 200
});

test('worker and transport are not deducted from a future order advance', () => {
  const heavyCosts = order({
    bookingDate: '2026-09-02', createdAt: '2026-09-02', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    totalPrice: 40_000, otherExpenses: 0, workerCost: 9_000, transportationCost: 6_000,
    totalPaid: 5_000, paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-10', method: 'Cash', type: 'deposit' }],
  });

  assert.equal(expectedOrderProfitContribution(heavyCosts, ...SEP), 5_000, 'the 15,000 of fulfillment cost is not owed yet');
});

test('a future order booking cost is deducted once, in the month it was spent', () => {
  const bookedInAugust = order({
    bookingDate: '2026-08-20', createdAt: '2026-08-20', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    totalPrice: 40_000, otherExpenses: 300,
    totalPaid: 5_000, paymentHistory: [
      { id: 'p1', amount: 2_000, date: '2026-08-20', method: 'Cash', type: 'deposit' },
      { id: 'p2', amount: 3_000, date: '2026-09-10', method: 'Cash', type: 'settlement' },
    ],
  });

  assert.equal(expectedOrderProfitContribution(bookedInAugust, ...AUG), 1_700, 'August: 2,000 in, 300 spent');
  assert.equal(expectedOrderProfitContribution(bookedInAugust, ...SEP), 3_000, 'September: the 300 is not deducted again');
});

test('a payment for a same-month event is not counted on top of its margin', () => {
  const sameMonth = order({
    eventDate: '2026-09-15', weddingDate: '2026-09-15', bookingDate: '2026-09-01', createdAt: '2026-09-01',
    totalPrice: 10_000, otherExpenses: 300, workerCost: 500, transportationCost: 200,
    totalPaid: 10_000, paymentHistory: [{ id: 'p1', amount: 10_000, date: '2026-09-05', method: 'Cash', type: 'settlement' }],
  });
  const unpaid = { ...sameMonth, totalPaid: 0, paymentHistory: [] };

  // Fully collected or not collected at all, the month is owed the same margin.
  assert.equal(expectedOrderProfitContribution(sameMonth, ...SEP), 9_000);
  assert.equal(expectedOrderProfitContribution(unpaid, ...SEP), 9_000);
});

test('a plain cancellation earns nothing, a retained one earns what it kept', () => {
  const advance = {
    bookingDate: '2026-09-02', createdAt: '2026-09-02', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    totalPrice: 40_000,
    totalPaid: 5_000,
    paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-10', method: 'Cash', type: 'deposit' as const }],
  };

  // A plain cancellation keeps nothing, so it earns nothing.
  assert.equal(expectedOrderProfitContribution(order({ ...advance, orderStatus: 'cancelled' }), ...SEP), 0);
  // Keeping the deposit is different: that money has been earned.
  assert.equal(
    expectedOrderProfitContribution(order({ ...advance, orderStatus: 'cancelled_deposit_retained' }), ...SEP),
    5_000,
  );
  assert.equal(
    expectedOrderProfitContribution(order({ ...advance, deletedAt: '2026-09-11T00:00:00.000Z', financiallyRetained: true }), ...SEP),
    0,
    'a deleted order forecasts nothing, in either section',
  );
  // The live equivalent does contribute, so the exclusions are what differ.
  assert.equal(expectedOrderProfitContribution(order(advance), ...SEP), 5_000);
});

test('a security deposit taken for a future order is not profit', () => {
  const withSecurity = order({
    bookingDate: '2026-09-02', createdAt: '2026-09-02', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    totalPrice: 40_000, totalPaid: 5_000, securityDeposit: 1_000,
    paymentHistory: [
      { id: 'p1', amount: 5_000, date: '2026-09-10', method: 'Cash', type: 'deposit' },
      { id: 's1', amount: 1_000, date: '2026-09-10', method: 'Cash', type: 'security_deposit' },
    ],
  });

  assert.equal(expectedOrderProfitContribution(withSecurity, ...SEP), 5_000, 'the held 1,000 belongs to the customer');
});

test('an overpayment on a future order does not inflate expected profit', () => {
  const overpaid = order({
    bookingDate: '2026-09-02', createdAt: '2026-09-02', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    totalPrice: 10_000, totalPaid: 12_000,
    paymentHistory: [{ id: 'p1', amount: 12_000, date: '2026-09-10', method: 'Cash', type: 'settlement' }],
  });

  // Only the 10,000 of contract value counts; the 2,000 is owed back.
  assert.equal(expectedOrderProfitContribution(overpaid, ...SEP), 10_000);

  // And a refund of that credit does not read as positive profit.
  const refunded = order({
    ...overpaid,
    paymentHistory: [
      { id: 'p1', amount: 12_000, date: '2026-09-10', method: 'Cash', type: 'settlement' },
      { id: 'r1', amount: 2_000, date: '2026-10-05', method: 'Cash', type: 'refund' },
    ],
  });
  assert.equal(expectedOrderProfitContribution(refunded, ...OCT), -2_000, 'October carries the outflow, never a gain');
});

test('the expected-profit month boundary is the calendar month on both sides', () => {
  const executedOn = (date: string) => order({ eventDate: date, weddingDate: date, totalPrice: 1_000 });
  assert.equal(expectedOrderProfitContribution(executedOn('2026-08-31'), ...SEP), 0);
  assert.equal(expectedOrderProfitContribution(executedOn('2026-09-01'), ...SEP), 1_000);
  assert.equal(expectedOrderProfitContribution(executedOn('2026-09-30'), ...SEP), 1_000);

  // 1 October is a later month, so a payment for it is an advance, not margin.
  const october = order({
    eventDate: '2026-10-01', weddingDate: '2026-10-01', bookingDate: '2026-10-01', createdAt: '2026-10-01',
    totalPrice: 1_000, totalPaid: 400,
    paymentHistory: [{ id: 'p1', amount: 400, date: '2026-09-30', method: 'Cash', type: 'deposit' }],
  });
  assert.equal(expectedOrderProfitContribution(october, ...SEP), 400, 'a 30 September payment lands in September');
  assert.equal(expectedOrderProfitContribution(october, ...OCT), 1_000, 'and October earns the margin');
});

// --- Section C: cancellation with the deposit retained ----------------------

test('a normal cancellation retains nothing and earns nothing', () => {
  const plain = order({
    orderStatus: 'cancelled', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 5_000,
    paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-10', method: 'Cash', type: 'deposit' }],
  });

  assert.equal(expectedOrderProfitContribution(plain, ...SEP), 0);
  // The cash it really took is untouched - that is Phase 2's business.
  assert.equal(netOrderCashContribution(plain, [], ...SEP), 5_000);
});

test('a cancellation with the deposit retained earns what it kept', () => {
  const retained = order({
    orderStatus: 'cancelled_deposit_retained', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 5_000,
    paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-10', method: 'Cash', type: 'deposit' }],
  });

  assert.equal(expectedOrderProfitContribution(retained, ...SEP), 5_000);
  // Recognized where the money landed, and nowhere else.
  assert.equal(expectedOrderProfitContribution(retained, ...AUG), 0);
  assert.equal(expectedOrderProfitContribution(retained, ...DEC), 0, 'the event month earns no margin: it will not happen');
});

test('recognizing a retained deposit adds no second helping of cash', () => {
  const retained = [order({
    orderStatus: 'cancelled_deposit_retained', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 5_000,
    paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-10', method: 'Cash', type: 'deposit' }],
  })];
  const active = [{ ...retained[0], orderStatus: 'confirmed' as const }];

  const summary = calculateMonthlyCash(retained, [], ...SEP);
  assert.equal(summary.expectedOrderProfit, 5_000);
  // Cash and treasury see the same 5,000 they always did - once.
  assert.equal(summary.netOrderCash, 5_000);
  assert.equal(summary.netOrderCash, calculateMonthlyCash(active, [], ...SEP).netOrderCash);
  const treasury = calculateFinancePeriodCash(retained, [], '2026-09', '2026-09');
  assert.equal(treasury.netOrderCash, 5_000);
  assert.equal(treasury.totalTreasuryBalance, 5_000, 'retention is recognition, not a new receipt');
  assert.equal(calculateSafeBalanceToDate(retained, [], new Date(2026, 8, 30)), 5_000);
});

test('a refund already issued reduces the retained profit, in its own month', () => {
  const partlyRefunded = order({
    orderStatus: 'cancelled_deposit_retained', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 2_000,
    paymentHistory: [
      { id: 'p1', amount: 5_000, date: '2026-09-10', method: 'Cash', type: 'deposit' },
      { id: 'r1', amount: 3_000, date: '2026-10-05', method: 'Cash', type: 'refund' },
    ],
  });

  assert.equal(expectedOrderProfitContribution(partlyRefunded, ...SEP), 5_000);
  assert.equal(expectedOrderProfitContribution(partlyRefunded, ...OCT), -3_000, 'giving 3,000 back un-earns it');
  // Across the two months only the 2,000 actually kept is ever earned.
  assert.equal(
    expectedOrderProfitContribution(partlyRefunded, ...SEP) + expectedOrderProfitContribution(partlyRefunded, ...OCT),
    2_000,
  );
});

test('a legacy security movement is not retained order-deposit profit', () => {
  const withSecurity = order({
    orderStatus: 'cancelled_deposit_retained', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 5_000, securityDeposit: 1_500,
    paymentHistory: [
      { id: 'p1', amount: 5_000, date: '2026-09-10', method: 'Cash', type: 'deposit' },
      { id: 's1', amount: 1_500, date: '2026-09-10', method: 'Cash', type: 'security_deposit' },
    ],
  });

  assert.equal(expectedOrderProfitContribution(withSecurity, ...SEP), 5_000, 'the legacy 1,500 counts for nothing');
  assert.equal(orderFinancialPosition(withSecurity).totalPaid, 5_000, 'and it is not paid towards the order');
});

test('a soft-deleted retained cancellation forecasts nothing', () => {
  const deleted = order({
    orderStatus: 'cancelled_deposit_retained', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 5_000,
    paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-10', method: 'Cash', type: 'deposit' }],
    deletedAt: '2026-09-20T00:00:00.000Z', financiallyRetained: true,
  });

  assert.equal(expectedOrderProfitContribution(deleted, ...SEP), 0);
  // Its historical cash is preserved, as Phase 2 requires.
  assert.equal(netOrderCashContribution(deleted, [], ...SEP), 5_000);
});

test('an advance and a later retained cancellation never duplicate the same money', () => {
  const history = [{ id: 'p1', amount: 5_000, date: '2026-09-10', method: 'Cash', type: 'deposit' as const }];
  const base = {
    eventDate: '2026-12-20', weddingDate: '2026-12-20', bookingDate: '2026-09-02', createdAt: '2026-09-02',
    totalPrice: 40_000, deposit: 5_000, totalPaid: 5_000, paymentHistory: history,
  };
  const active = order({ ...base });
  const afterCancellation = order({ ...base, orderStatus: 'cancelled_deposit_retained' });

  // While active the 5,000 is an advance; once retained it is earned. Either
  // way September recognizes it once, and no other month recognizes it at all.
  assert.equal(expectedOrderProfitContribution(active, ...SEP), 5_000);
  assert.equal(expectedOrderProfitContribution(afterCancellation, ...SEP), 5_000);
  for (const [y, m] of [AUG, OCT, DEC]) {
    assert.equal(expectedOrderProfitContribution(afterCancellation, y, m), 0, 'recognized in September only');
  }
  // And the cash is identical before and after the cancellation.
  assert.equal(
    netOrderCashContribution(afterCancellation, [], ...SEP),
    netOrderCashContribution(active, [], ...SEP),
  );
});

test('a same-month order is never counted through more than one section', () => {
  const executedAndPaid = order({
    eventDate: '2026-09-15', weddingDate: '2026-09-15', bookingDate: '2026-09-01', createdAt: '2026-09-01',
    totalPrice: 10_000, otherExpenses: 300, workerCost: 500, transportationCost: 200,
    totalPaid: 10_000, paymentHistory: [{ id: 'p1', amount: 10_000, date: '2026-09-05', method: 'Cash', type: 'settlement' }],
  });

  // Margin only: the 10,000 collected is not added on top of it.
  assert.equal(expectedOrderProfitContribution(executedAndPaid, ...SEP), 9_000);

  // The same order cancelled with its deposit kept moves wholly into section
  // C - its margin is gone and only the retained cash is earned.
  const retainedInstead = { ...executedAndPaid, orderStatus: 'cancelled_deposit_retained' as const };
  assert.equal(expectedOrderProfitContribution(retainedInstead, ...SEP), 10_000);
});

// --- Retained cancellation recognized on the receipt date -------------------

test('cash and the retained profit both land in the month the money arrived', () => {
  // Your example: 5,000 taken on 15 September, cancelled with the deposit
  // kept on 10 October.
  const retained = [order({
    orderStatus: 'cancelled_deposit_retained',
    eventDate: '2026-12-20', weddingDate: '2026-12-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02',
    deposit: 5_000, totalPaid: 5_000,
    paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' }],
    cancelledAt: '2026-10-10T09:30:00.000Z',
  })];

  // Cash is where the money actually arrived, and nowhere else.
  assert.equal(calculateMonthlyCash(retained, [], ...SEP).netOrderCash, 5_000);
  assert.equal(calculateMonthlyCash(retained, [], ...OCT).netOrderCash, 0, 'cancelling creates no cash');

  // Profit is recognized where the money actually arrived, so it agrees with
  // the cash in that month instead of appearing on its own in a later one.
  assert.equal(expectedOrderProfitContribution(retained[0], ...SEP), 5_000);
  assert.equal(expectedOrderProfitContribution(retained[0], ...OCT), 0, 'cancelling recognizes nothing');

  // Treasury sees the 5,000 once, in September, and October adds nothing.
  const september = calculateFinancePeriodCash(retained, [], '2026-09', '2026-09');
  const october = calculateFinancePeriodCash(retained, [], '2026-10', '2026-10');
  assert.equal(september.totalTreasuryBalance, 5_000);
  assert.equal(october.netOrderCash, 0);
  assert.equal(october.totalTreasuryBalance, 5_000, 'carried forward, not received again');
});

test('a plain cancellation produces no retained profit whenever it happened', () => {
  const plain = order({
    orderStatus: 'cancelled', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 5_000,
    paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' }],
    cancelledAt: '2026-10-10T09:30:00.000Z',
  });

  for (const [y, m] of [SEP, OCT, DEC]) assert.equal(expectedOrderProfitContribution(plain, y, m), 0);
  assert.equal(netOrderCashContribution(plain, [], ...SEP), 5_000, 'its real cash is untouched');
});

test('a refund made before the cancellation reduces what was retained', () => {
  const partlyReturned = order({
    orderStatus: 'cancelled_deposit_retained', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 2_000,
    paymentHistory: [
      { id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' },
      { id: 'r1', amount: 3_000, date: '2026-09-28', method: 'Cash', type: 'refund' },
    ],
    cancelledAt: '2026-10-10T09:30:00.000Z',
  });

  // Only the 2,000 actually kept is ever recognized: the receipt and the
  // refund both fall in September, so September nets them.
  assert.equal(expectedOrderProfitContribution(partlyReturned, ...SEP), 2_000);
  assert.equal(expectedOrderProfitContribution(partlyReturned, ...OCT), 0);
  // The cash movements stay on their own dates: 5,000 in, 3,000 back out.
  assert.equal(netOrderCashContribution(partlyReturned, [], ...SEP), 2_000);
});

test('security-deposit money is never recognized as retained profit', () => {
  const withSecurity = order({
    orderStatus: 'cancelled_deposit_retained', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 5_000, securityDeposit: 1_500,
    paymentHistory: [
      { id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' },
      { id: 's1', amount: 1_500, date: '2026-09-15', method: 'Cash', type: 'security_deposit' },
    ],
    cancelledAt: '2026-10-10T09:30:00.000Z',
  });

  assert.equal(expectedOrderProfitContribution(withSecurity, ...SEP), 5_000, 'the legacy 1,500 counts for nothing');
  assert.equal(orderFinancialPosition(withSecurity).totalPaid, 5_000, 'and it is not paid towards the order');
});

test('a legacy retained cancellation with no date keeps its previous behaviour', () => {
  const legacy = order({
    orderStatus: 'cancelled_deposit_retained', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 5_000,
    paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' }],
  });

  // Where the cash landed, like every other retained cancellation. A missing
  // cancellation date changes nothing about the figure.
  assert.equal(expectedOrderProfitContribution(legacy, ...SEP), 5_000);
  assert.equal(expectedOrderProfitContribution(legacy, ...OCT), 0);
  // And it is listed so the ambiguity can be resolved deliberately.
  assert.deepEqual(retainedCancellationsMissingDate([legacy]).map((item) => item.id), ['order-1']);
  assert.deepEqual(retainedCancellationsMissingDate([{ ...legacy, cancelledAt: '2026-10-10T00:00:00.000Z' }]), []);
});

// --- when the date is stamped ----------------------------------------------

test('cancelling a live booking records the event with its real date', () => {
  const stamped = new Date('2026-10-10T09:30:00.000Z');

  assert.deepEqual(
    cancellationMetadata({ cancelledAt: null, orderStatus: 'confirmed' }, 'cancelled_deposit_retained', stamped),
    {
      cancelledAt: stamped.toISOString(),
      cancellationHistory: [{ kind: 'cancelled_deposit_retained', at: stamped.toISOString() }],
    },
  );
});

test('an unrelated edit leaves the lifecycle history exactly as it was', () => {
  const at = '2026-10-10T09:30:00.000Z';
  const cancelled = {
    cancelledAt: at,
    orderStatus: 'cancelled_deposit_retained' as const,
    cancellationHistory: [{ kind: 'cancelled_deposit_retained' as const, at }],
  };

  // Re-saving the same status, which the order form does on every save.
  assert.deepEqual(cancellationMetadata(cancelled, 'cancelled_deposit_retained'), {});
  // An edit that does not touch the status at all.
  assert.deepEqual(cancellationMetadata(cancelled, undefined), {});
});

test('an unrelated edit to a legacy cancelled order does not stamp today', () => {
  const today = new Date('2027-01-15T10:00:00.000Z');

  // Cancelled long before any of this existed. Saving an address change must
  // not claim it was cancelled today.
  for (const orderStatus of ['cancelled', 'cancelled_deposit_retained'] as const) {
    assert.deepEqual(cancellationMetadata({ cancelledAt: undefined, orderStatus }, orderStatus, today), {});
    assert.deepEqual(cancellationMetadata({ cancelledAt: null, orderStatus }, orderStatus, today), {});
    assert.deepEqual(cancellationMetadata({ cancelledAt: undefined, orderStatus }, undefined, today), {});
  }

  // Deciding to keep the deposit on a legacy record is a real decision, so it
  // is dated - but only that decision. The booking's own cancellation date is
  // still missing, because nobody ever recorded it.
  const decided = cancellationMetadata({ cancelledAt: undefined, orderStatus: 'cancelled' }, 'cancelled_deposit_retained', today);
  assert.deepEqual(decided, { cancellationHistory: [{ kind: 'cancelled_deposit_retained', at: today.toISOString() }] });
  assert.equal('cancelledAt' in decided, false, 'no cancellation date is invented for it');
});

test('a legacy cancelled order keeps the fallback and stays reported until dated', () => {
  const legacy = order({
    orderStatus: 'cancelled_deposit_retained', eventDate: '2026-12-20', weddingDate: '2026-12-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 5_000,
    paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' }],
  });

  assert.equal(expectedOrderProfitContribution(legacy, ...SEP), 5_000);
  assert.equal(expectedOrderProfitContribution(legacy, ...OCT), 0);
  assert.deepEqual(retainedCancellationsMissingDate([legacy]).map((item) => item.id), ['order-1']);
  // Once it carries a real lifecycle it is no longer ambiguous.
  assert.deepEqual(
    retainedCancellationsMissingDate([{ ...legacy, cancellationHistory: [{ kind: 'cancelled_deposit_retained', at: '2026-10-10T00:00:00.000Z' }] }]),
    [],
  );
});

// --- cancel, reinstate, cancel again ----------------------------------------

const lifecycleOrder = (changes: Partial<Order> = {}) => order({
  orderStatus: 'cancelled_deposit_retained',
  eventDate: '2027-03-20', weddingDate: '2027-03-20',
  bookingDate: '2026-09-02', createdAt: '2026-09-02',
  totalPrice: 40_000, deposit: 5_000, totalPaid: 5_000,
  paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' }],
  cancellationHistory: [
    { kind: 'cancelled_deposit_retained', at: '2026-10-10T09:30:00.000Z' },
    { kind: 'reinstated', at: '2026-11-05T11:00:00.000Z' },
    { kind: 'cancelled_deposit_retained', at: '2026-12-12T16:00:00.000Z' },
  ],
  cancelledAt: '2026-12-12T16:00:00.000Z',
  ...changes,
});

test('the September recognition is unmoved by the whole cancellation lifecycle', () => {
  const full = lifecycleOrder();

  assert.equal(expectedOrderProfitContribution(full, ...SEP), 5_000, 'recognized where the money arrived');
  for (const [y, m] of [OCT, NOV, DEC]) {
    assert.equal(expectedOrderProfitContribution(full, y, m), 0, 'a lifecycle event recognizes nothing');
  }

  // Only one 5,000 is ever earned across the whole lifecycle.
  assert.equal([SEP, OCT, NOV, DEC].reduce((t, [y, m]) => t + expectedOrderProfitContribution(full, y, m), 0), 5_000);
});

test('each stage of the lifecycle leaves the earlier months untouched', () => {
  const history = lifecycleOrder().cancellationHistory as Order['cancellationHistory'];
  const afterCancel = lifecycleOrder({ cancellationHistory: history!.slice(0, 1), cancelledAt: '2026-10-10T09:30:00.000Z' });
  const afterReinstate = lifecycleOrder({
    orderStatus: 'confirmed', cancellationHistory: history!.slice(0, 2), cancelledAt: null,
  });
  const afterRecancel = lifecycleOrder();

  // September reads 5,000 while the booking is cancelled, and October never
  // reads anything: no lifecycle event moves the figure.
  for (const state of [afterCancel, afterRecancel]) {
    assert.equal(expectedOrderProfitContribution(state, ...SEP), 5_000);
    assert.equal(expectedOrderProfitContribution(state, ...OCT), 0);
    assert.equal(expectedOrderProfitContribution(state, ...NOV), 0);
  }
  // Reinstated and live, it is an ordinary booking again: it forecasts its
  // March margin and its September receipt is an advance, not retained profit.
  assert.equal(expectedOrderProfitContribution(afterReinstate, ...SEP), 5_000, 'counted as an advance instead');
  assert.equal(expectedOrderProfitContribution(afterReinstate, 2027, 2), 40_000);
});

test('neither cancellation creates cash, and the receipt stays in September', () => {
  const full = [lifecycleOrder()];

  assert.equal(calculateMonthlyCash(full, [], ...SEP).netOrderCash, 5_000);
  for (const [y, m] of [OCT, NOV, DEC]) {
    assert.equal(calculateMonthlyCash(full, [], y, m).netOrderCash, 0, 'a lifecycle event is not a receipt');
  }
  assert.equal(calculateSafeBalanceToDate(full, [], new Date(2026, 11, 31)), 5_000, 'the safe holds one 5,000, not three');
  assert.equal(lifecycleOrder().paymentHistory[0].date, '2026-09-15');
});

test('a refund after either cancellation is recognized in its real refund month', () => {
  // Returned in January, after the second cancellation.
  const refundedLate = lifecycleOrder({
    totalPaid: 4_000,
    paymentHistory: [
      { id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' },
      { id: 'r1', amount: 1_000, date: '2027-01-08', method: 'Cash', type: 'refund' },
    ],
  });

  assert.equal(expectedOrderProfitContribution(refundedLate, ...SEP), 5_000, 'September holds the receipt');
  assert.equal(expectedOrderProfitContribution(refundedLate, ...OCT), 0);
  assert.equal(expectedOrderProfitContribution(refundedLate, ...DEC), 0);
  assert.equal(expectedOrderProfitContribution(refundedLate, 2027, 0), -1_000, 'January carries the reduction');
  assert.equal(calculateMonthlyCash([refundedLate], [], 2027, 0).netOrderCash, -1_000, 'and so does the cash');

  // Returned between the two cancellations: the December recognition is based
  // on what was actually still held by then.
  const refundedBetween = lifecycleOrder({
    totalPaid: 3_000,
    paymentHistory: [
      { id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' },
      { id: 'r1', amount: 2_000, date: '2026-11-20', method: 'Cash', type: 'refund' },
    ],
  });
  assert.equal(expectedOrderProfitContribution(refundedBetween, ...SEP), 5_000, 'September holds the receipt');
  assert.equal(expectedOrderProfitContribution(refundedBetween, ...NOV), -2_000, 'November holds the refund');
  assert.equal(expectedOrderProfitContribution(refundedBetween, ...DEC), 0, 'and December recognizes nothing');
});

test('a booking that ends plainly cancelled earns nothing in any month', () => {
  const downgraded = lifecycleOrder({
    orderStatus: 'cancelled',
    cancellationHistory: [
      { kind: 'cancelled_deposit_retained', at: '2026-10-10T09:30:00.000Z' },
      { kind: 'cancelled', at: '2026-12-12T16:00:00.000Z' },
    ],
  });

  for (const [y, m] of [SEP, OCT, NOV, DEC]) {
    assert.equal(expectedOrderProfitContribution(downgraded, y, m), 0, 'nothing is kept, so nothing is earned');
  }
  assert.equal(netOrderCashContribution(downgraded, [], ...SEP), 5_000, 'its real cash is untouched');
});

// --- changing the decision about the deposit --------------------------------

const decisionOrder = (events: NonNullable<Order['cancellationHistory']>, orderStatus: Order['orderStatus'], changes: Partial<Order> = {}) => order({
  orderStatus,
  eventDate: '2027-03-20', weddingDate: '2027-03-20',
  bookingDate: '2026-09-02', createdAt: '2026-09-02',
  totalPrice: 40_000, deposit: 5_000, totalPaid: 5_000,
  paymentHistory: [{ id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' }],
  cancelledAt: '2026-10-10T09:30:00.000Z',
  cancellationHistory: events,
  ...changes,
});

const CANCELLED_OCT = { kind: 'cancelled' as const, at: '2026-10-10T09:30:00.000Z' };
const RETAINED_NOV = { kind: 'cancelled_deposit_retained' as const, at: '2026-11-20T14:00:00.000Z' };
const CANCELLED_DEC = { kind: 'cancelled' as const, at: '2026-12-05T10:00:00.000Z' };

test('deciding to keep the deposit recognizes it in the month it was received', () => {
  const decided = decisionOrder([CANCELLED_OCT, RETAINED_NOV], 'cancelled_deposit_retained');

  assert.equal(expectedOrderProfitContribution(decided, ...SEP), 5_000, 'the month the money arrived');
  assert.equal(expectedOrderProfitContribution(decided, ...OCT), 0);
  assert.equal(expectedOrderProfitContribution(decided, ...NOV), 0, 'the decision itself recognizes nothing');
});

test('ending up plainly cancelled leaves no retained profit anywhere', () => {
  const reversed = decisionOrder([CANCELLED_OCT, RETAINED_NOV, CANCELLED_DEC], 'cancelled');

  for (const [y, m] of [SEP, OCT, NOV, DEC]) assert.equal(expectedOrderProfitContribution(reversed, y, m), 0);
  assert.equal([SEP, OCT, NOV, DEC].reduce((t, [y, m]) => t + expectedOrderProfitContribution(reversed, y, m), 0), 0);
});

test('switching back again is recognized once more, leaving earlier months alone', () => {
  const backAgain = decisionOrder(
    [CANCELLED_OCT, RETAINED_NOV, CANCELLED_DEC, { kind: 'cancelled_deposit_retained', at: '2027-01-15T10:00:00.000Z' }],
    'cancelled_deposit_retained',
  );

  assert.equal(expectedOrderProfitContribution(backAgain, ...SEP), 5_000, 'still the receipt month');
  for (const [y, m] of [OCT, NOV, DEC, [2027, 0] as const]) {
    assert.equal(expectedOrderProfitContribution(backAgain, y, m), 0);
  }
  // Only one 5,000 is earned in the end, however many times the decision moved.
  assert.equal(
    [SEP, OCT, NOV, DEC, [2027, 0] as const].reduce((t, [y, m]) => t + expectedOrderProfitContribution(backAgain, y, m), 0),
    5_000,
  );
});

test('a decision change records exactly one event, and a re-save records none', () => {
  const at = '2026-10-10T09:30:00.000Z';
  const cancelled = { cancelledAt: at, orderStatus: 'cancelled' as const, cancellationHistory: [CANCELLED_OCT] };
  const decidedOn = new Date('2026-11-20T14:00:00.000Z');

  const change = cancellationMetadata(cancelled, 'cancelled_deposit_retained', decidedOn);
  assert.deepEqual(change, { cancellationHistory: [CANCELLED_OCT, { kind: 'cancelled_deposit_retained', at: decidedOn.toISOString() }] });
  assert.equal('cancelledAt' in change, false, 'the booking was not cancelled again, only the decision changed');

  // Saving the same status again adds nothing, so the history cannot grow on
  // every edit.
  const afterChange = { ...cancelled, orderStatus: 'cancelled_deposit_retained' as const, cancellationHistory: change.cancellationHistory! };
  assert.deepEqual(cancellationMetadata(afterChange, 'cancelled_deposit_retained'), {});
  assert.deepEqual(cancellationMetadata(afterChange, undefined), {});
});

test('a decision change moves no cash and leaves treasury alone', () => {
  const decided = [decisionOrder([CANCELLED_OCT, RETAINED_NOV], 'cancelled_deposit_retained')];

  assert.equal(calculateMonthlyCash(decided, [], ...SEP).netOrderCash, 5_000, 'the receipt is where it always was');
  for (const [y, m] of [OCT, NOV, DEC]) {
    assert.equal(calculateMonthlyCash(decided, [], y, m).netOrderCash, 0, 'recognition is not a receipt');
  }
  assert.equal(calculateSafeBalanceToDate(decided, [], new Date(2026, 11, 31)), 5_000);
  assert.equal(decisionOrder([CANCELLED_OCT, RETAINED_NOV], 'cancelled_deposit_retained').paymentHistory[0].date, '2026-09-15');
});

test('a legacy record that ends up giving the money back retains no profit', () => {
  const legacyReversed = decisionOrder(
    [{ kind: 'cancelled', at: '2026-11-20T14:00:00.000Z' }],
    'cancelled',
    { cancelledAt: null },
  );

  for (const [y, m] of [SEP, OCT, NOV, DEC]) assert.equal(expectedOrderProfitContribution(legacyReversed, y, m), 0);
  assert.equal(netOrderCashContribution(legacyReversed, [], ...SEP), 5_000, 'the cash it took is untouched');
});

// --- a refund between two cancellation events -------------------------------

const JAN27 = [2027, 0] as const;
const FEB27 = [2027, 1] as const;
const MAR27 = [2027, 2] as const;

/** Paid in September, retained in October, 1,000 returned in November, retained again in December. */
const refundBetweenEvents = () => order({
  orderStatus: 'cancelled_deposit_retained',
  eventDate: '2027-06-20', weddingDate: '2027-06-20',
  bookingDate: '2026-09-02', createdAt: '2026-09-02',
  totalPrice: 40_000, deposit: 5_000, totalPaid: 4_000,
  paymentHistory: [
    { id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' },
    { id: 'r1', amount: 1_000, date: '2026-11-18', method: 'Cash', type: 'refund' },
  ],
  cancelledAt: '2026-12-12T16:00:00.000Z',
  cancellationHistory: [
    { kind: 'cancelled_deposit_retained', at: '2026-10-10T09:30:00.000Z' },
    { kind: 'cancelled_deposit_retained', at: '2026-12-12T16:00:00.000Z' },
  ],
});

test('a refund between two cancellation events is reported in the refund month', () => {
  const between = refundBetweenEvents();

  assert.equal(expectedOrderProfitContribution(between, ...NOV), -1_000, 'November is where the money went back');
});

test('the earlier cancellation month is not rewritten by the refund', () => {
  const between = refundBetweenEvents();

  assert.equal(expectedOrderProfitContribution(between, ...SEP), 5_000, 'September holds the receipt');
  assert.equal(expectedOrderProfitContribution(between, ...OCT), 0, 'a cancellation recognizes nothing');
});

test('the later cancellation recognizes only what is still held, and never the refund again', () => {
  const between = refundBetweenEvents();

  // 4,000 is still held and 4,000 has already been recognized, so December has
  // nothing left to recognize - it must not restate the 1,000.
  assert.equal(expectedOrderProfitContribution(between, ...DEC), 0);
  assert.equal(
    [SEP, OCT, NOV, DEC].reduce((t, [y, m]) => t + expectedOrderProfitContribution(between, y, m), 0),
    4_000,
    'only the 4,000 actually kept is ever earned',
  );
});

test('a refund between events moves treasury only on its own date', () => {
  const between = [refundBetweenEvents()];

  assert.equal(calculateMonthlyCash(between, [], ...SEP).netOrderCash, 5_000);
  assert.equal(calculateMonthlyCash(between, [], ...OCT).netOrderCash, 0, 'a cancellation creates no cash');
  assert.equal(calculateMonthlyCash(between, [], ...NOV).netOrderCash, -1_000);
  assert.equal(calculateMonthlyCash(between, [], ...DEC).netOrderCash, 0);

  assert.equal(calculateSafeBalanceToDate(between, [], new Date(2026, 9, 31)), 5_000);
  assert.equal(calculateSafeBalanceToDate(between, [], new Date(2026, 11, 31)), 4_000);
  assert.equal(refundBetweenEvents().paymentHistory[0].date, '2026-09-15', 'the receipt is never moved');
});

test('the same holds when the receipt and the refund cross a year boundary', () => {
  const acrossYears = order({
    orderStatus: 'cancelled_deposit_retained',
    eventDate: '2027-08-20', weddingDate: '2027-08-20',
    bookingDate: '2026-11-02', createdAt: '2026-11-02',
    totalPrice: 40_000, deposit: 5_000, totalPaid: 3_500,
    paymentHistory: [
      { id: 'p1', amount: 5_000, date: '2026-11-10', method: 'Cash', type: 'deposit' },
      { id: 'r1', amount: 1_500, date: '2027-01-20', method: 'Cash', type: 'refund' },
    ],
    cancelledAt: '2027-03-05T10:00:00.000Z',
    cancellationHistory: [
      { kind: 'cancelled_deposit_retained', at: '2026-12-08T10:00:00.000Z' },
      { kind: 'cancelled_deposit_retained', at: '2027-03-05T10:00:00.000Z' },
    ],
  });

  assert.equal(expectedOrderProfitContribution(acrossYears, ...NOV), 5_000, 'the receipt month earns it');
  assert.equal(expectedOrderProfitContribution(acrossYears, ...DEC), 0, 'the December cancellation recognizes nothing');
  assert.equal(expectedOrderProfitContribution(acrossYears, ...JAN27), -1_500, 'the January refund lands in January');
  assert.equal(expectedOrderProfitContribution(acrossYears, ...FEB27), 0);
  assert.equal(expectedOrderProfitContribution(acrossYears, ...MAR27), 0, 'nothing left to recognize in March');
  assert.equal(
    [NOV, DEC, JAN27, FEB27, MAR27].reduce((t, [y, m]) => t + expectedOrderProfitContribution(acrossYears, y, m), 0),
    3_500,
  );

  // Cash crosses the year on its own dates only.
  assert.equal(calculateMonthlyCash([acrossYears], [], ...NOV).netOrderCash, 5_000);
  assert.equal(calculateMonthlyCash([acrossYears], [], ...JAN27).netOrderCash, -1_500);
  assert.equal(calculateSafeBalanceToDate([acrossYears], [], new Date(2027, 2, 31)), 3_500);
});

test('a refund is recognized in its own month whatever the lifecycle was doing', () => {
  // Retained in October, reinstated in November, refunded later that month,
  // retained again in December: the money moved twice and each movement is
  // recognized on its own date, whatever the booking's state was at the time.
  const whileLive = order({
    orderStatus: 'cancelled_deposit_retained',
    eventDate: '2027-06-20', weddingDate: '2027-06-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02',
    totalPrice: 40_000, deposit: 5_000, totalPaid: 3_000,
    paymentHistory: [
      { id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' },
      { id: 'r1', amount: 2_000, date: '2026-11-20', method: 'Cash', type: 'refund' },
    ],
    cancelledAt: '2026-12-12T16:00:00.000Z',
    cancellationHistory: [
      { kind: 'cancelled_deposit_retained', at: '2026-10-10T09:30:00.000Z' },
      { kind: 'reinstated', at: '2026-11-05T11:00:00.000Z' },
      { kind: 'cancelled_deposit_retained', at: '2026-12-12T16:00:00.000Z' },
    ],
  });

  assert.equal(expectedOrderProfitContribution(whileLive, ...SEP), 5_000, 'the receipt');
  assert.equal(expectedOrderProfitContribution(whileLive, ...OCT), 0);
  assert.equal(expectedOrderProfitContribution(whileLive, ...NOV), -2_000, 'the refund, on its own date');
  assert.equal(expectedOrderProfitContribution(whileLive, ...DEC), 0);
  assert.equal([SEP, OCT, NOV, DEC].reduce((t, [y, m]) => t + expectedOrderProfitContribution(whileLive, y, m), 0), 3_000);
});

// --- a late refund lands in its own month -----------------------------------

const withLateRefund = () => order({
  orderStatus: 'cancelled_deposit_retained', eventDate: '2027-01-20', weddingDate: '2027-01-20',
  bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 4_000,
  paymentHistory: [
    { id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' },
    { id: 'r1', amount: 1_000, date: '2026-12-05', method: 'Cash', type: 'refund' },
  ],
  cancelledAt: '2026-10-10T09:30:00.000Z',
});

test('a December refund does not rewrite the September retained profit', () => {
  const late = withLateRefund();

  assert.equal(expectedOrderProfitContribution(late, ...SEP), 5_000, 'September holds the receipt');
  assert.equal(expectedOrderProfitContribution(late, ...OCT), 0, 'the cancellation recognizes nothing');
  assert.equal(expectedOrderProfitContribution(late, ...DEC), -1_000, 'the reduction belongs to December');

  // Across the order's life only the 4,000 actually kept is ever earned.
  assert.equal(
    [SEP, OCT, NOV, DEC].reduce((total, [y, m]) => total + expectedOrderProfitContribution(late, y, m), 0),
    4_000,
  );
  assert.equal(expectedOrderProfitContribution(late, ...NOV), 0, 'a month with no movement earns nothing');
});

test('treasury cash moves only on the real receipt and refund dates', () => {
  const late = [withLateRefund()];

  assert.equal(calculateMonthlyCash(late, [], ...SEP).netOrderCash, 5_000);
  assert.equal(calculateMonthlyCash(late, [], ...OCT).netOrderCash, 0, 'cancelling creates no cash');
  assert.equal(calculateMonthlyCash(late, [], ...NOV).netOrderCash, 0);
  assert.equal(calculateMonthlyCash(late, [], ...DEC).netOrderCash, -1_000);

  assert.equal(calculateSafeBalanceToDate(late, [], new Date(2026, 8, 30)), 5_000);
  assert.equal(calculateSafeBalanceToDate(late, [], new Date(2026, 9, 31)), 5_000, 'October adds nothing');
  assert.equal(calculateSafeBalanceToDate(late, [], new Date(2026, 11, 31)), 4_000);
  // The original receipt is never moved or edited.
  assert.equal(withLateRefund().paymentHistory[0].date, '2026-09-15');
});

test('a refund in the cancellation month is counted once, not twice', () => {
  const sameMonth = order({
    orderStatus: 'cancelled_deposit_retained', eventDate: '2027-01-20', weddingDate: '2027-01-20',
    bookingDate: '2026-09-02', createdAt: '2026-09-02', deposit: 5_000, totalPaid: 3_000,
    paymentHistory: [
      { id: 'p1', amount: 5_000, date: '2026-09-15', method: 'Cash', type: 'deposit' },
      { id: 'r1', amount: 2_000, date: '2026-10-20', method: 'Cash', type: 'refund' },
    ],
    cancelledAt: '2026-10-10T09:30:00.000Z',
  });

  // The receipt is September's and the refund is October's, each recognized
  // once, on its own date.
  assert.equal(expectedOrderProfitContribution(sameMonth, ...SEP), 5_000);
  assert.equal(expectedOrderProfitContribution(sameMonth, ...OCT), -2_000);
  assert.equal(expectedOrderProfitContribution(sameMonth, ...DEC), 0);
  assert.equal([SEP, OCT, NOV, DEC].reduce((t, [y, m]) => t + expectedOrderProfitContribution(sameMonth, y, m), 0), 3_000);
});
