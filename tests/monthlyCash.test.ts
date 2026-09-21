import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFinancePeriodCash, calculateMonthlyCash, calculateSafeBalanceToDate } from '../src/utils/monthlyCash';
import { reconcileMonthlyCash } from '../src/utils/monthlyCashReconciliation';
import { buildMonthlySourceCashNet } from '../src/utils/reportInsights';
import type { CompanyFinanceEntry, Order } from '../src/types';

const order = (changes: Partial<Order>): Order => ({
  id: 'order-1', orderNumber: 'ORD-1', customerId: 'customer-1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-08-02', weddingDate: '2026-08-20', deliveryDate: '2026-08-20', eventLocation: '',
  totalPrice: 2000, deposit: 500, totalPaid: 500, remainingBalance: 1500, paymentStatus: 'partially_paid',
  paymentHistory: [], orderStatus: 'confirmed', reservedItems: [], attachments: [], createdAt: '2026-08-02', updatedAt: '2026-08-02',
  ...changes,
});

test('separates completed collections, future-order advances, and monthly outflows', () => {
  const result = calculateMonthlyCash([
    order({ id: 'completed', orderStatus: 'completed', totalPaid: 1000, paymentHistory: [{ id: 'one', amount: 1000, date: '2026-08-15', method: 'cash' }], workerCost: 200, transportationCost: 50, otherExpenses: 25 }),
    order({ id: 'future', totalPaid: 400, otherExpenses: 75, paymentHistory: [{ id: 'two', amount: 400, date: '2026-08-10', method: 'cash' }] }),
  ], [
    { id: 'capital', type: 'capital', category: 'رأس مال', amount: 300, date: '2026-08-05', createdAt: '' },
    { id: 'expense', type: 'expense', category: 'إيجار', amount: 100, date: '2026-08-12', createdAt: '' },
  ], 2026, 7);

  assert.equal(result.collectedFromCompletedOrders, 1000);
  assert.equal(result.advancesFromUpcomingOrders, 400);
  assert.equal(result.completedOrderCosts, 275);
  assert.equal(result.upcomingOrderOtherExpenses, 75);
  assert.equal(result.completedOrdersNetProfit, 725);
  assert.equal(result.completedOrdersNetProfitWithRetainedDeposits, 725);
  assert.equal(result.upcomingOrderAdvancesNet, 325);
  assert.equal(result.orderCashNet, 1050);
  assert.equal(result.orderCashBalanceToDate, 1050);
  assert.equal(result.cashMovement, 1250);
  assert.equal(result.expectedSafeBalance, 1250);
});

test('uses booking date for legacy payments without history', () => {
  const result = calculateMonthlyCash([order({ totalPaid: 500, paymentHistory: [] })], [], 2026, 7);
  assert.equal(result.advancesFromUpcomingOrders, 500);
});

test('records other expenses in the booking month even when collection and execution are later', () => {
  const futureCollectionOrder = order({
    id: 'future-collection', bookingDate: '2026-07-22', createdAt: '2026-07-22', totalPaid: 400, otherExpenses: 100,
    paymentHistory: [{ id: 'august-payment', amount: 400, date: '2026-08-10', method: 'cash' }],
  });

  const july = calculateMonthlyCash([futureCollectionOrder], [], 2026, 6);
  const august = calculateMonthlyCash([futureCollectionOrder], [], 2026, 7);

  assert.equal(july.upcomingOrderOtherExpenses, 100);
  assert.equal(july.netMonthlyCash, -100);
  assert.equal(july.orderCashBalanceToDate, -100);
  assert.equal(august.upcomingOrderOtherExpenses, 0);
  assert.equal(august.netMonthlyCash, 400);
  assert.equal(august.orderCashBalanceToDate, 300);
});

test('separates monthly deposits and settlements while deducting booking and completion costs', () => {
  const result = calculateMonthlyCash([
    order({ id: 'upcoming', bookingDate: '2026-08-02', totalPaid: 500, otherExpenses: 100, paymentHistory: [{ id: 'deposit', amount: 500, date: '2026-08-02', method: 'cash', type: 'deposit' }] }),
    order({ id: 'completed', bookingDate: '2026-07-15', eventDate: '2026-08-20', weddingDate: '2026-08-20', orderStatus: 'completed', totalPaid: 1000, workerCost: 200, transportationCost: 50, paymentHistory: [{ id: 'settlement', amount: 1000, date: '2026-08-20', method: 'cash', type: 'settlement' }] }),
    order({ id: 'retained', bookingDate: '2026-08-04', orderStatus: 'cancelled_deposit_retained', totalPaid: 300, paymentHistory: [{ id: 'retained-deposit', amount: 300, date: '2026-08-04', method: 'cash', type: 'deposit' }] }),
  ], [], 2026, 7);

  assert.equal(result.totalDepositsPaid, 800);
  assert.equal(result.totalSettlementPayments, 1000);
  assert.equal(result.expectedSettlementPayments, 2500);
  assert.equal(result.grossMonthlyIncome, 1800);
  assert.equal(result.bookedOrderOtherExpenses, 100);
  assert.equal(result.completedWorkerTransportCosts, 250);
  assert.equal(result.totalMonthlyOrderExpenses, 100);
  assert.equal(result.netMonthlyCash, 1450);
  assert.equal(result.netMonthlyOrderProfit, 3950);
  assert.equal(result.completedOrdersNetProfit, 750);
  assert.equal(result.completedOrdersNetProfitWithRetainedDeposits, 1050);
  assert.equal(result.upcomingOrderDepositsPaid, 500);
  assert.equal(result.upcomingOrderDepositsNet, 400);
});

test('keeps a retained cancelled deposit in finance, separate from upcoming order advances', () => {
  const result = calculateMonthlyCash([
    order({ id: 'retained', orderStatus: 'cancelled_deposit_retained', totalPaid: 500, paymentHistory: [] }),
    order({ id: 'cancelled', orderStatus: 'cancelled', totalPaid: 500, paymentHistory: [] }),
  ], [], 2026, 7);

  assert.equal(result.retainedCancelledDeposits, 500);
  assert.equal(result.completedOrdersNetProfit, 0);
  assert.equal(result.completedOrdersNetProfitWithRetainedDeposits, 500);
  assert.equal(result.advancesFromUpcomingOrders, 0);
  assert.equal(result.orderCashNet, 500);
  assert.equal(result.orderCashBalanceToDate, 500);
  assert.equal(result.collections[0]?.isRetainedDeposit, true);
});

test('headline net uses completed profit and subtracts only uncompleted-order other expenses', () => {
  const result = calculateMonthlyCash([
    order({
      id: 'completed-prior-booking', bookingDate: '2026-07-22', eventDate: '2026-08-20', weddingDate: '2026-08-20',
      orderStatus: 'completed', totalPaid: 1_000, workerCost: 200, otherExpenses: 100,
      paymentHistory: [{ id: 'completed-paid', amount: 1_000, date: '2026-08-20', method: 'cash' }],
    }),
    order({ id: 'upcoming', totalPaid: 300, otherExpenses: 50, paymentHistory: [{ id: 'upcoming-deposit', amount: 300, date: '2026-08-10', method: 'cash' }] }),
    order({ id: 'retained', bookingDate: '2026-08-04', orderStatus: 'cancelled_deposit_retained', totalPaid: 200, paymentHistory: [{ id: 'retained-deposit', amount: 200, date: '2026-08-04', method: 'cash' }] }),
  ], [], 2026, 7);

  assert.equal(result.completedOrdersNetProfit, 800); // July's other expenses stay in July.
  assert.equal(result.netMonthlyCash, 1_250); // 800 + 300 + 200 - 50
});

test('expected monthly profit includes deposits for bookings executing in a later month', () => {
  const result = calculateMonthlyCash([
    order({
      id: 'this-month', totalPrice: 1_000, workerCost: 100,
      eventDate: '2026-08-20', weddingDate: '2026-08-20',
    }),
    order({
      id: 'future-booking', bookingDate: '2026-08-10', createdAt: '2026-08-10',
      eventDate: '2026-09-20', weddingDate: '2026-09-20', totalPaid: 500,
      paymentHistory: [{ id: 'future-deposit', amount: 500, date: '2026-08-10', method: 'cash', type: 'deposit' }],
    }),
    order({
      id: 'retained', orderStatus: 'cancelled_deposit_retained', totalPaid: 200,
      paymentHistory: [{ id: 'retained-deposit', amount: 200, date: '2026-08-12', method: 'cash', type: 'deposit' }],
    }),
  ], [], 2026, 7);

  assert.equal(result.netMonthlyOrderProfit, 1_600); // 900 + 500 + 200
});

test('keeps a future order deposit in its booking month after the order is later completed', () => {
  const result = calculateMonthlyCash([
    order({
      id: 'completed-later', bookingDate: '2026-08-29', createdAt: '2026-08-29',
      eventDate: '2026-09-02', weddingDate: '2026-09-02', orderStatus: 'completed',
      totalPrice: 2_800, totalPaid: 2_800, workerCost: 1_000, transportationCost: 500,
      paymentHistory: [
        { id: 'deposit', amount: 1_000, date: '2026-08-29', method: 'cash', type: 'deposit' },
        { id: 'settlement', amount: 1_800, date: '2026-09-02', method: 'cash', type: 'settlement' },
      ],
    }),
  ], [], 2026, 7);

  assert.equal(result.advancesFromUpcomingOrders, 1_000);
  assert.equal(result.netMonthlyCash, 1_000);
  assert.equal(result.netMonthlyOrderProfit, 1_000);
});

test('does not count an old deposit again when its order is completed in a later month', () => {
  const completedLater = order({
    id: 'completed-later', orderNumber: 'ORD-OLD-DEPOSIT', bookingDate: '2026-08-29', createdAt: '2026-08-29',
    eventDate: '2026-09-02', weddingDate: '2026-09-02', orderStatus: 'completed',
    totalPrice: 2_800, totalPaid: 2_800, workerCost: 1_000, transportationCost: 500,
    paymentHistory: [
      { id: 'deposit', amount: 1_000, date: '2026-08-29', method: 'cash', type: 'deposit' },
      { id: 'settlement', amount: 1_800, date: '2026-09-02', method: 'cash', type: 'settlement' },
    ],
  });

  const september = calculateMonthlyCash([completedLater], [], 2026, 8);

  assert.equal(september.collectedFromCompletedOrders, 1_800);
  assert.equal(september.completedOrdersNetProfit, 300); // 1,800 collected in September - 1,500 execution costs
  assert.equal(september.netMonthlyCash, 300);
  assert.deepEqual(september.netMonthlyCashBreakdown, [{
    id: 'completed-later-completed', orderId: 'completed-later', orderNumber: 'ORD-OLD-DEPOSIT', customerName: completedLater.customerName,
    kind: 'completed-order', amount: 300, collectedThisMonth: 1_800, completedOrderCosts: 1_500,
  }]);
});

test('calculates the current safe balance from collections, capital, and recognised costs only', () => {
  const orders = [
    order({ id: 'completed', orderStatus: 'completed', eventDate: '2026-08-20', weddingDate: '2026-08-20', totalPaid: 1_000, paymentHistory: [{ id: 'paid', amount: 1_000, date: '2026-08-15', method: 'cash' }], workerCost: 200, transportationCost: 50, otherExpenses: 25 }),
    order({ id: 'upcoming', bookingDate: '2026-08-10', totalPaid: 400, paymentHistory: [{ id: 'deposit', amount: 400, date: '2026-08-10', method: 'cash' }], otherExpenses: 75 }),
  ];
  const finance = [
    { id: 'capital', type: 'capital' as const, category: 'رأس مال', amount: 300, date: '2026-08-05', createdAt: '' },
    { id: 'expense', type: 'expense' as const, category: 'إيجار', amount: 100, date: '2026-08-12', createdAt: '' },
  ];

  assert.equal(calculateSafeBalanceToDate(orders, finance, new Date(2026, 7, 10)), 600);
  assert.equal(calculateSafeBalanceToDate(orders, finance, new Date(2026, 7, 31)), 1_250);
});

test('booking expenses stay deducted once through future execution and completion', () => {
  const booked = order({
    bookingDate: '2026-09-21', createdAt: '2026-09-21',
    eventDate: '2026-10-01', weddingDate: '2026-10-01',
    totalPrice: 2_000, deposit: 1_000, totalPaid: 1_000, remainingBalance: 1_000,
    otherExpenses: 200, workerCost: 300, transportationCost: 100, orderSource: 'campaign',
    paymentHistory: [{ id: 'deposit', amount: 1_000, date: '2026-09-21', method: 'cash', type: 'deposit' }],
  });
  const completed = order({ ...booked, orderStatus: 'completed', totalPaid: 2_000, remainingBalance: 0,
    paymentHistory: [...booked.paymentHistory, { id: 'settlement', amount: 1_000, date: '2026-10-01', method: 'cash', type: 'settlement' }],
  });

  for (const state of [booked, completed]) {
    const september = calculateMonthlyCash([state], [], 2026, 8);
    assert.equal(september.netMonthlyCash, 800);
    assert.equal(september.completedOrderCosts, 0);
    assert.equal(september.upcomingOrderOtherExpenses, 200);
    assert.equal(september.orderCashBalanceToDate, 800);
    assert.equal(september.expectedSafeBalance, 800);
    assert.equal(calculateSafeBalanceToDate([state], [], new Date(2026, 8, 20)), 0);
    assert.equal(calculateSafeBalanceToDate([state], [], new Date(2026, 8, 21)), 800);
    const october = calculateMonthlyCash([state], [], 2026, 9);
    assert.equal(october.upcomingOrderOtherExpenses, 0);
    assert.equal(october.netMonthlyCash, state === booked ? 0 : 600);
    assert.equal(october.completedOrderCosts, state === booked ? 0 : 400);
    assert.equal(october.expectedSafeBalance, september.netMonthlyCash + october.netMonthlyCash);
    assert.equal(october.orderCashBalanceToDate, october.expectedSafeBalance);

    for (const month of [8, 9]) {
      const summary = calculateMonthlyCash([state], [], 2026, month);
      assert.equal(summary.netMonthlyCashBreakdown.reduce((sum, item) => sum + item.amount, 0), summary.netMonthlyCash);
      assert.equal(buildMonthlySourceCashNet([state], 2026, month).campaign, summary.netMonthlyCash);
      const reconciliation = reconcileMonthlyCash([state], [], 2026, month);
      assert.equal(reconciliation.items.reduce((sum, item) => sum + item.difference, 0), reconciliation.difference);
    }
  }
});

test('same-month booking and completion deduct other expenses only once', () => {
  const sameMonth = order({ otherExpenses: 200, workerCost: 300, transportationCost: 100, totalPaid: 1_000,
    paymentHistory: [{ id: 'paid', amount: 1_000, date: '2026-08-02', method: 'cash', type: 'deposit' }],
  });
  const pending = calculateMonthlyCash([sameMonth], [], 2026, 7);
  assert.equal(pending.netMonthlyCash, 800);
  assert.equal(pending.completedOrderCosts, 0);
  const completed = calculateMonthlyCash([{ ...sameMonth, orderStatus: 'completed' }], [], 2026, 7);
  assert.equal(completed.netMonthlyCash, 400);
  assert.equal(completed.completedOrderCosts, 600);
  assert.equal(completed.upcomingOrderOtherExpenses, 0);
  assert.equal(completed.expectedSafeBalance, 400);
  assert.equal(completed.netMonthlyCashBreakdown.reduce((sum, item) => sum + item.amount, 0), 400);
});

test('legacy booking date falls back to creation date across the year boundary', () => {
  const legacy = order({ bookingDate: undefined, createdAt: '2026-12-20T10:00:00Z',
    eventDate: '2027-01-10', weddingDate: '2027-01-10', otherExpenses: 100,
    totalPaid: 0, deposit: 0, workerCost: 200, transportationCost: 50,
  });
  for (const orderStatus of ['confirmed', 'completed'] as const) {
    const state = { ...legacy, orderStatus };
    assert.equal(calculateMonthlyCash([state], [], 2026, 11).netMonthlyCash, -100);
    assert.equal(calculateSafeBalanceToDate([state], [], new Date(2026, 11, 31)), -100);
    const january = calculateMonthlyCash([state], [], 2027, 0);
    assert.equal(january.netMonthlyCash, orderStatus === 'completed' ? -250 : 0);
    assert.equal(january.orderCashBalanceToDate, orderStatus === 'completed' ? -350 : -100);
  }
});

const carryFinance: CompanyFinanceEntry[] = [
  { id: 'opening-capital', type: 'capital', category: 'رأس مال', amount: 1_000, date: '2026-08-01', createdAt: '' },
  { id: 'new-capital', type: 'capital', category: 'رأس مال', amount: 500, date: '2026-09-05', createdAt: '' },
  { id: 'salary', type: 'expense', category: 'مرتبات', amount: 300, date: '2026-09-10', createdAt: '' },
  { id: 'rent', type: 'expense', category: 'إيجار', amount: 100, date: '2026-09-15', createdAt: '' },
];
const carryOrder = order({
  bookingDate: '2026-09-01', createdAt: '2026-09-01', eventDate: '2026-10-01', weddingDate: '2026-10-01',
  totalPaid: 1_000, deposit: 1_000, otherExpenses: 200, workerCost: 300, transportationCost: 100,
  paymentHistory: [{ id: 'deposit', amount: 1_000, date: '2026-09-01', method: 'cash', type: 'deposit' }],
});

test('general expenses reduce only carried funds while capital and net order cash stay separate', () => {
  const result = calculateFinancePeriodCash([carryOrder], carryFinance, '2026-09', '2026-09');
  assert.deepEqual(result, {
    openingBalance: 1_000, capitalAdded: 500, generalExpenses: 400, netOrderCash: 800,
    remainingCarriedBalance: 600, totalSafeBalance: 1_900,
  });
  assert.equal(result.netOrderCash, calculateMonthlyCash([carryOrder], carryFinance, 2026, 8).netMonthlyCash);
  assert.equal(result.totalSafeBalance, calculateSafeBalanceToDate([carryOrder], carryFinance, new Date(2026, 8, 30)));

  const beforeExpenses = calculateFinancePeriodCash([carryOrder], carryFinance.filter(entry => entry.type === 'capital'), '2026-09', '2026-09');
  assert.equal(beforeExpenses.remainingCarriedBalance, 1_000);
  assert.equal(beforeExpenses.netOrderCash, result.netOrderCash);
  assert.equal(beforeExpenses.capitalAdded, result.capitalAdded);
});

test('editing and deleting a general expense recalculates the remaining carry and total once', () => {
  const edited = carryFinance.map(entry => entry.id === 'salary' ? { ...entry, amount: 600 } : entry);
  const afterEdit = calculateFinancePeriodCash([carryOrder], edited, '2026-09', '2026-09');
  assert.equal(afterEdit.remainingCarriedBalance, 300);
  assert.equal(afterEdit.totalSafeBalance, 1_600);
  assert.equal(afterEdit.netOrderCash, 800);
  assert.equal(afterEdit.capitalAdded, 500);
  const afterDelete = calculateFinancePeriodCash([carryOrder], edited.filter(entry => entry.id !== 'salary'), '2026-09', '2026-09');
  assert.equal(afterDelete.remainingCarriedBalance, 900);
  assert.equal(afterDelete.totalSafeBalance, 2_200);
});

test('a carried deficit stays visible without reducing the new capital or order cash buckets', () => {
  const overspent = carryFinance.map(entry => entry.id === 'salary' ? { ...entry, amount: 1_200 } : entry);
  const result = calculateFinancePeriodCash([carryOrder], overspent, '2026-09', '2026-09');
  assert.equal(result.remainingCarriedBalance, -300);
  assert.equal(result.capitalAdded, 500);
  assert.equal(result.netOrderCash, 800);
  assert.equal(result.totalSafeBalance, 1_000);
  const noCarry = calculateFinancePeriodCash([carryOrder], carryFinance.filter(entry => entry.id !== 'opening-capital'), '2026-09', '2026-09');
  assert.equal(noCarry.openingBalance, 0);
  assert.equal(noCarry.remainingCarriedBalance, -400);
  assert.equal(noCarry.totalSafeBalance, 900);
});

test('next month carries the previous total and recognizes only that month expenses and completion costs', () => {
  const completed = { ...carryOrder, orderStatus: 'completed' as const, totalPaid: 2_000,
    paymentHistory: [...carryOrder.paymentHistory, { id: 'settlement', amount: 1_000, date: '2026-10-01', method: 'cash', type: 'settlement' as const }],
  };
  const finance = [...carryFinance, { id: 'october-salary', type: 'expense' as const, category: 'مرتبات', amount: 500, date: '2026-10-10', createdAt: '' }];
  const result = calculateFinancePeriodCash([completed], finance, '2026-10', '2026-10');
  assert.equal(result.openingBalance, 1_900);
  assert.equal(result.generalExpenses, 500);
  assert.equal(result.remainingCarriedBalance, 1_400);
  assert.equal(result.netOrderCash, 600);
  assert.equal(result.capitalAdded, 0);
  assert.equal(result.totalSafeBalance, 2_000);
});

test('range, year and all-period summaries use the opening and movements of the whole selected period', () => {
  const range = calculateFinancePeriodCash([carryOrder], carryFinance, '2026-08', '2026-09');
  const year = calculateFinancePeriodCash([carryOrder], carryFinance, '2026-01', '2026-12');
  const all = calculateFinancePeriodCash([carryOrder], carryFinance, '', '9999-12');
  for (const result of [range, year, all]) {
    assert.equal(result.openingBalance, 0);
    assert.equal(result.capitalAdded, 1_500);
    assert.equal(result.generalExpenses, 400);
    assert.equal(result.netOrderCash, 800);
    assert.equal(result.remainingCarriedBalance, -400);
    assert.equal(result.totalSafeBalance, 1_900);
  }
});
