import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCustomerSourceBreakdown, buildMonthlySourceCashNet, buildMonthlyComparison, buildServiceProfitability } from '../src/utils/reportInsights';
import type { Expense, Order } from '../src/types';

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 'order-1', orderNumber: 'WED-1', customerId: 'customer-1', customerName: 'منى', customerPhone: '', bookingDate: '2026-01-01', weddingDate: '2026-02-12', eventDate: '2026-02-12', deliveryDate: '2026-02-12', eventLocation: '', totalPrice: 1_000, deposit: 200, totalPaid: 400, remainingBalance: 600, paymentStatus: 'partially_paid', paymentHistory: [], orderStatus: 'completed', reservedItems: [], attachments: [], createdAt: '', updatedAt: '', ...overrides,
});

test('builds monthly comparison using event-month revenue and recognised direct costs', () => {
  const comparison = buildMonthlyComparison([order({ workerCost: 100, transportationCost: 50, otherExpenses: 25 })], [{ id: 'expense', date: '2026-02-20', type: 'expense', category: 'تشغيل', amount: 75, createdAt: '' } as Expense], 2026);
  assert.deepEqual(comparison[1], { month: 1, orderCount: 1, revenue: 1_000, directCosts: 175, netProfit: 825, operatingExpenses: 75 });
});

test('includes planned worker and transportation costs for uncompleted monthly orders', () => {
  const comparison = buildMonthlyComparison([
    order({ orderStatus: 'confirmed', workerCost: 100, transportationCost: 50, otherExpenses: 25 }),
  ], [], 2026);
  assert.deepEqual(comparison[1], { month: 1, orderCount: 1, revenue: 1_000, directCosts: 175, netProfit: 825, operatingExpenses: 0 });
});

test('allocates a multi-service order equally across explicit service types', () => {
  const services = buildServiceProfitability([order({ supplierRentals: [
    { id: 'a', supplierId: 'a', supplierName: 'A', serviceType: 'إضاءة', itemDescription: '' },
    { id: 'b', supplierId: 'b', supplierName: 'B', serviceType: 'ورد', itemDescription: '' },
  ] })], 'ar');
  assert.deepEqual(services.map(({ service, revenue }) => ({ service, revenue })), [{ service: 'إضاءة', revenue: 500 }, { service: 'ورد', revenue: 500 }]);
});

test('groups revenue and actual collections by customer source', () => {
  const sources = buildCustomerSourceBreakdown([order({ orderSource: 'campaign' }), order({ id: 'organic', orderSource: 'organic', totalPrice: 500, totalPaid: 500 })]);
  assert.equal(sources.find((item) => item.source === 'campaign')?.revenue, 1_000);
  assert.equal(sources.find((item) => item.source === 'organic')?.collected, 500);
});

test('matches the safe cash rules by source, including retained deposits and future-order advances', () => {
  const orders = [
    order({ id: 'completed', orderSource: 'organic', totalPaid: 1_000, workerCost: 200, paymentHistory: [{ id: 'settlement', amount: 1_000, date: '2026-02-12', method: 'cash', type: 'settlement' }] }),
    order({
      id: 'retained', orderSource: 'campaign', orderStatus: 'cancelled_deposit_retained', totalPrice: 3_000, totalPaid: 700,
      bookingDate: '2026-02-05', eventDate: '2026-02-10', weddingDate: '2026-02-10',
      paymentHistory: [{ id: 'deposit', amount: 700, date: '2026-02-05', method: 'cash', type: 'deposit' }],
    }),
    order({
      id: 'future', orderSource: 'other', orderStatus: 'confirmed', totalPrice: 2_000, totalPaid: 500,
      bookingDate: '2026-02-12', eventDate: '2026-03-12', weddingDate: '2026-03-12', otherExpenses: 50,
      paymentHistory: [{ id: 'deposit', amount: 500, date: '2026-02-12', method: 'cash', type: 'deposit' }],
    }),
  ];

  assert.deepEqual(buildMonthlySourceCashNet(orders, 2026, 1), { organic: 800, campaign: 700, other: 450 });
});
