import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCustomerSourceBreakdown, buildMonthlyComparison, buildServiceProfitability } from '../src/utils/reportInsights';
import type { Expense, Order } from '../src/types';

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 'order-1', orderNumber: 'WED-1', customerId: 'customer-1', customerName: 'منى', customerPhone: '', bookingDate: '2026-01-01', weddingDate: '2026-02-12', eventDate: '2026-02-12', deliveryDate: '2026-02-12', eventLocation: '', totalPrice: 1_000, deposit: 200, totalPaid: 400, remainingBalance: 600, paymentStatus: 'partially_paid', paymentHistory: [], orderStatus: 'completed', reservedItems: [], attachments: [], createdAt: '', updatedAt: '', ...overrides,
});

test('builds monthly comparison using event-month revenue and recognised direct costs', () => {
  const comparison = buildMonthlyComparison([order({ workerCost: 100, transportationCost: 50, otherExpenses: 25 })], [{ id: 'expense', date: '2026-02-20', type: 'expense', category: 'تشغيل', amount: 75, createdAt: '' } as Expense], 2026);
  assert.deepEqual(comparison[1], { month: 1, orderCount: 1, revenue: 1_000, directCosts: 175, netProfit: 825, operatingExpenses: 75 });
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
