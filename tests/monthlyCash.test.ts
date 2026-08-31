import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMonthlyCash, calculateSafeBalanceToDate } from '../src/utils/monthlyCash';
import type { Order } from '../src/types';

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

test('records an upcoming order other expense in its booking month', () => {
  const futureCollectionOrder = order({
    id: 'future-collection', bookingDate: '2026-07-22', createdAt: '2026-07-22', totalPaid: 400, otherExpenses: 100,
    paymentHistory: [{ id: 'august-payment', amount: 400, date: '2026-08-10', method: 'cash' }],
  });

  const july = calculateMonthlyCash([futureCollectionOrder], [], 2026, 6);
  const august = calculateMonthlyCash([futureCollectionOrder], [], 2026, 7);

  assert.equal(july.upcomingOrderOtherExpenses, 100);
  assert.equal(july.orderCashBalanceToDate, -100);
  assert.equal(august.upcomingOrderOtherExpenses, 0);
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

  assert.equal(result.completedOrdersNetProfit, 700);
  assert.equal(result.netMonthlyCash, 1_150); // 700 + 300 + 200 - 50
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

test('calculates the current safe balance from collections, capital, and recognised costs only', () => {
  const orders = [
    order({ id: 'completed', orderStatus: 'completed', eventDate: '2026-08-20', weddingDate: '2026-08-20', totalPaid: 1_000, paymentHistory: [{ id: 'paid', amount: 1_000, date: '2026-08-15', method: 'cash' }], workerCost: 200, transportationCost: 50, otherExpenses: 25 }),
    order({ id: 'upcoming', bookingDate: '2026-08-10', totalPaid: 400, paymentHistory: [{ id: 'deposit', amount: 400, date: '2026-08-10', method: 'cash' }], otherExpenses: 75 }),
  ];
  const finance = [
    { id: 'capital', type: 'capital' as const, category: 'رأس مال', amount: 300, date: '2026-08-05', createdAt: '' },
    { id: 'expense', type: 'expense' as const, category: 'إيجار', amount: 100, date: '2026-08-12', createdAt: '' },
  ];

  assert.equal(calculateSafeBalanceToDate(orders, finance, new Date(2026, 7, 10)), 625);
  assert.equal(calculateSafeBalanceToDate(orders, finance, new Date(2026, 7, 31)), 1_250);
});
