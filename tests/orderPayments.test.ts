import assert from 'node:assert/strict';
import test from 'node:test';
import { completedOrderFulfillmentCosts, recordedOrderPayment } from '../src/utils/orderPayments';

test('uses the canonical paid total after settling an order in full', () => {
  const paid = recordedOrderPayment({
    deposit: 1_000,
    totalPaid: 2_000,
    paymentHistory: [
      { id: 'pay_init', amount: 1_000, date: '2026-08-01', method: 'Cash' },
      { id: 'pay_settlement', amount: 1_000, date: '2026-08-08', method: 'Cash' },
    ],
  });

  assert.equal(paid, 2_000);
});

test('falls back safely for legacy orders without a stored paid total', () => {
  assert.equal(recordedOrderPayment({ deposit: 500, totalPaid: Number.NaN, paymentHistory: [{ id: 'pay_init', amount: 500, date: '', method: 'Cash' }] }), 500);
});

test('recognizes worker and transportation costs only after completion', () => {
  const costs = { workerCost: 600, transportationCost: 150 };
  assert.equal(completedOrderFulfillmentCosts({ ...costs, orderStatus: 'confirmed' }), 0);
  assert.equal(completedOrderFulfillmentCosts({ ...costs, orderStatus: 'completed' }), 750);
});
