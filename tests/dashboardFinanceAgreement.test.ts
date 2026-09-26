import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyFinanceEntry, Order } from '../src/types';
import { calculateFinancePeriodCash, calculateMonthlyCash } from '../src/utils/monthlyCash';
import { initialOrderPaymentState } from '../src/utils/orderPaymentState';

/**
 * The dashboard, Finance and Reports each show money for the same month. They
 * must show the same money.
 *
 * The dashboard used to derive its own figures - everything an order had ever
 * been paid, bucketed by the month the order was created - so the three
 * screens answered different questions and disagreed. These tests reproduce
 * exactly what each screen now computes and assert the numbers match.
 */

const order = (changes: Partial<Order>): Order => ({
  id: 'order-1', orderNumber: 'ORD-1', customerId: 'c1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-08-02', weddingDate: '2026-08-20', eventDate: '2026-08-20', deliveryDate: '2026-08-20', eventLocation: '',
  totalPrice: 10_000, deposit: 0, totalPaid: 0, remainingBalance: 10_000, paymentStatus: 'unpaid',
  paymentHistory: [], orderStatus: 'confirmed', reservedItems: [], attachments: [], createdAt: '2026-08-02', updatedAt: '2026-08-02',
  ...changes,
});

const YEAR = 2026;
const MONTH = 7; // August

/** What DashboardModule renders in its three money cards. */
const dashboardCards = (orders: Order[], entries: CompanyFinanceEntry[]) => {
  const summary = calculateMonthlyCash(orders, entries, YEAR, MONTH);
  const collected = summary.collections.reduce((total, collection) => total + collection.amount, 0);
  return {
    netOrderCash: summary.netOrderCash,
    recognizedOrderCosts: collected - summary.netOrderCash,
    expectedOrderProfit: summary.expectedOrderProfit,
  };
};

/** What ExpensesModule (Finance) renders for the same single month. */
const financeCards = (orders: Order[], entries: CompanyFinanceEntry[]) =>
  calculateFinancePeriodCash(orders, entries, '2026-08', '2026-08');

/** What ReportsModule renders for the same month. */
const reportCards = (orders: Order[], entries: CompanyFinanceEntry[]) =>
  calculateMonthlyCash(orders, entries, YEAR, MONTH);

const assertAgreement = (orders: Order[], entries: CompanyFinanceEntry[], label: string) => {
  const dashboard = dashboardCards(orders, entries);
  const finance = financeCards(orders, entries);
  const reports = reportCards(orders, entries);

  assert.equal(dashboard.netOrderCash, finance.netOrderCash, `${label}: dashboard and Finance net order cash`);
  assert.equal(dashboard.netOrderCash, reports.netOrderCash, `${label}: dashboard and Reports net order cash`);
  assert.equal(dashboard.expectedOrderProfit, reports.expectedOrderProfit, `${label}: dashboard and Reports expected profit`);
  // The two dashboard cash cards are two halves of one figure.
  const collected = reports.collections.reduce((total, collection) => total + collection.amount, 0);
  assert.equal(collected - dashboard.recognizedOrderCosts, dashboard.netOrderCash, `${label}: cost card is consistent with the cash card`);
  return dashboard;
};

test('creating an incomplete order counts its opening deposit once in monthly cash', () => {
  for (const deposit of [0, 2_000, 5_000, 10_000]) {
    const paymentHistory: Order['paymentHistory'] = deposit > 0
      ? [{ id: 'initial', amount: deposit, date: '2026-08-02', method: 'Cash', type: 'deposit' }]
      : [];
    const financial = initialOrderPaymentState({ totalPrice: 10_000, deposit, paymentHistory });
    const created = order({ deposit, paymentHistory, ...financial });
    const summary = calculateMonthlyCash([created], [], YEAR, MONTH);

    assert.equal(created.totalPaid, deposit);
    assert.equal(created.remainingBalance, 10_000 - deposit);
    assert.equal(created.paymentStatus, deposit === 10_000 ? 'fully_paid' : deposit > 0 ? 'partially_paid' : 'unpaid');
    assert.equal(summary.netMonthlyCash, deposit, 'Reports headline includes only money received');
    assert.equal(summary.netMonthlyCashBreakdown.reduce((sum, item) => sum + item.amount, 0), deposit);
    assert.equal(summary.collections.some((entry) => entry.isLegacyEstimate), false);
    assert.equal(assertAgreement([created], [], 'new booking').netOrderCash, deposit);
  }
});

test('an incomplete order agrees across dashboard, Finance and Reports', () => {
  const incomplete = [order({
    totalPaid: 2_000, remainingBalance: 8_000, paymentStatus: 'partially_paid',
    otherExpenses: 300, workerCost: 500, transportationCost: 200,
    paymentHistory: [{ id: 'pay_1', amount: 2_000, date: '2026-08-02', method: 'Cash', type: 'deposit' }],
  })];

  const cards = assertAgreement(incomplete, [], 'incomplete');
  assert.equal(cards.netOrderCash, 1_700); // 2,000 - 300, worker and transport not yet recognized
  assert.equal(cards.expectedOrderProfit, 9_000); // 10,000 - 300 - 500 - 200
});

test('a completed order agrees across dashboard, Finance and Reports', () => {
  const completed = [order({
    orderStatus: 'completed', fulfillmentRecognizedAt: '2026-08-20T18:00:00.000Z',
    totalPaid: 10_000, remainingBalance: 0, paymentStatus: 'fully_paid',
    otherExpenses: 300, workerCost: 500, transportationCost: 200,
    paymentHistory: [{ id: 'pay_1', amount: 10_000, date: '2026-08-20', method: 'Cash', type: 'settlement' }],
  })];

  const cards = assertAgreement(completed, [], 'completed');
  assert.equal(cards.netOrderCash, 9_000);
  assert.equal(cards.recognizedOrderCosts, 1_000); // 300 + 500 + 200
  assert.equal(cards.expectedOrderProfit, 9_000);
});

test('a refund agrees across the screens, in the month the money went back', () => {
  const refunded = [order({
    orderStatus: 'cancelled', deposit: 2_000, totalPaid: 0,
    paymentHistory: [
      { id: 'pay_1', amount: 2_000, date: '2026-07-02', method: 'Cash', type: 'deposit' },
      { id: 'refund_1', amount: 2_000, date: '2026-08-11', method: 'Cash', type: 'refund' },
    ],
  })];

  const cards = assertAgreement(refunded, [], 'refund');
  assert.equal(cards.netOrderCash, -2_000, 'August carries the outflow');
  assert.equal(cards.expectedOrderProfit, 0, 'a refund never becomes margin');

  // July, where the money came in, is untouched by all three screens.
  const july = calculateMonthlyCash(refunded, [], YEAR, 6);
  assert.equal(july.netOrderCash, 2_000);
  assert.equal(calculateFinancePeriodCash(refunded, [], '2026-07', '2026-07').netOrderCash, 2_000);
});

test('a cancelled order agrees across the screens and keeps its real cash', () => {
  const cancelled = [order({
    orderStatus: 'cancelled', otherExpenses: 300, deposit: 1_500, totalPaid: 1_500,
    paymentHistory: [{ id: 'pay_1', amount: 1_500, date: '2026-08-02', method: 'Cash', type: 'deposit' }],
  })];

  const cards = assertAgreement(cancelled, [], 'cancelled');
  assert.equal(cards.netOrderCash, 1_200); // 1,500 taken, 300 already spent
  assert.equal(cards.expectedOrderProfit, 0, 'it will not happen, so no margin');
});

test('an order-linked expense agrees across the screens and is counted once', () => {
  const linked: CompanyFinanceEntry[] = [
    { id: 'exp_linked', type: 'expense', category: 'شراء خامات', amount: 400, date: '2026-08-05', linkedOrderId: 'order-1', createdAt: '' },
    { id: 'exp_rent', type: 'expense', category: 'إيجار', amount: 1_000, date: '2026-08-05', createdAt: '' },
  ];
  const paid = [order({
    totalPaid: 5_000, remainingBalance: 5_000, paymentStatus: 'partially_paid',
    paymentHistory: [{ id: 'pay_1', amount: 5_000, date: '2026-08-02', method: 'Cash', type: 'deposit' }],
  })];

  const cards = assertAgreement(paid, linked, 'order-linked expense');
  assert.equal(cards.netOrderCash, 4_600); // 5,000 - the 400 spent on this order
  assert.equal(cards.recognizedOrderCosts, 400);
  // The rent is the company's, not the order's, and appears only once.
  assert.equal(financeCards(paid, linked).generalOperatingExpenses, 1_000);
});

test('a month mixing every case still agrees across all three screens', () => {
  const entries: CompanyFinanceEntry[] = [
    { id: 'exp_linked', type: 'expense', category: 'شراء خامات', amount: 250, date: '2026-08-07', linkedOrderId: 'order-1', createdAt: '' },
    { id: 'exp_rent', type: 'expense', category: 'إيجار', amount: 900, date: '2026-08-03', createdAt: '' },
    { id: 'cap', type: 'capital', category: 'رأس مال', amount: 3_000, date: '2026-08-01', createdAt: '' },
  ];
  const mixed = [
    order({ totalPaid: 2_000, otherExpenses: 300, workerCost: 500, transportationCost: 200, paymentHistory: [{ id: 'p1', amount: 2_000, date: '2026-08-02', method: 'Cash', type: 'deposit' }] }),
    order({
      id: 'order-2', orderStatus: 'completed', fulfillmentRecognizedAt: '2026-08-20T18:00:00.000Z',
      totalPaid: 4_000, otherExpenses: 100, workerCost: 300, transportationCost: 50,
      paymentHistory: [{ id: 'p2', amount: 4_000, date: '2026-08-20', method: 'Cash', type: 'settlement' }],
    }),
    order({
      id: 'order-3', orderStatus: 'cancelled', deposit: 800, totalPaid: 0,
      paymentHistory: [
        { id: 'p3', amount: 800, date: '2026-08-04', method: 'Cash', type: 'deposit' },
        { id: 'r3', amount: 800, date: '2026-08-25', method: 'Cash', type: 'refund' },
      ],
    }),
  ];

  const cards = assertAgreement(mixed, entries, 'mixed month');

  // Cash: 2,000 - 300 booked - 250 linked, then 4,000 - 350 fulfillment
  // - 100 booked, then 800 in and 800 straight back out.
  assert.equal(cards.netOrderCash, 1_450 + 3_550 + 0);
  // Margin: only the two live orders scheduled this month.
  assert.equal(cards.expectedOrderProfit, 9_000 + 9_550);

  // And the treasury identity still holds over the same month.
  const finance = financeCards(mixed, entries);
  assert.equal(finance.totalTreasuryBalance, finance.remainingOperatingBalance + finance.netOrderCash);
  assert.equal(finance.generalOperatingExpenses, 900, 'the linked 250 is an order cost, not rent');
});
