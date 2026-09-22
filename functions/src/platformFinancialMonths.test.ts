import assert from 'node:assert/strict';
import test from 'node:test';
import { orderFinancialMonths, platformFinancialMonths } from './platformFinancialMonths.js';

const months = (result: Array<{ month: string }>) => result.map((entry) => entry.month);

test('a month holding only a deposit is still calculated', () => {
  // Booked and paid in March, executed in June. March used to disappear.
  const order = {
    eventDate: '2026-06-12', bookingDate: '2026-03-04', createdAt: '2026-03-04',
    paymentHistory: [{ id: 'pay_1', amount: 1_000, date: '2026-03-04', type: 'deposit' }],
  };

  const result = platformFinancialMonths([order], ['2026-06'], []);

  assert.deepEqual(months(result), ['2026-06', '2026-03']);
  assert.equal(result.find((entry) => entry.month === '2026-03')?.orderCount, 0, 'a payment month reports no events, not nothing at all');
  assert.equal(result.find((entry) => entry.month === '2026-06')?.orderCount, 1);
});

test('a month holding only a refund is still calculated', () => {
  const order = {
    eventDate: '2026-06-12', bookingDate: '2026-06-01', createdAt: '2026-06-01', orderStatus: 'cancelled',
    paymentHistory: [
      { id: 'pay_1', amount: 900, date: '2026-06-01', type: 'deposit' },
      { id: 'refund_1', amount: 900, date: '2026-09-11', type: 'refund' },
    ],
  };

  const result = platformFinancialMonths([order], ['2026-06'], []);

  assert.ok(months(result).includes('2026-09'), 'the month the money left must be reported');
  assert.equal(result.find((entry) => entry.month === '2026-09')?.orderCount, 0);
});

test('a late settlement in a month with no event is included', () => {
  const order = {
    eventDate: '2026-06-12', bookingDate: '2026-05-20', createdAt: '2026-05-20',
    paymentHistory: [
      { id: 'pay_1', amount: 500, date: '2026-05-20', type: 'deposit' },
      { id: 'pay_2', amount: 1_500, date: '2026-08-30', type: 'settlement' },
    ],
  };

  const result = platformFinancialMonths([order], ['2026-06'], []);

  assert.deepEqual(months(result), ['2026-08', '2026-06', '2026-05']);
});

test('an expense-only or capital-only month is included', () => {
  const entries = [
    { date: '2026-11-03', type: 'expense' },
    { date: '2026-12-01', type: 'capital' },
    { date: '2026-10-01', type: 'expense', deletedAt: '2026-10-05T00:00:00.000Z' },
  ];

  const result = platformFinancialMonths([], [], entries);

  assert.deepEqual(months(result), ['2026-12', '2026-11'], 'the deleted entry contributes no period');
  assert.equal(result[0].orderCount, 0);
});

test('a booking-month cost with a later event contributes its own month', () => {
  const order = { eventDate: '2027-01-15', bookingDate: '2026-09-02', createdAt: '2026-09-02', otherExpenses: 250 };

  assert.deepEqual(orderFinancialMonths(order).sort(), ['2026-09', '2027-01']);

  // A booking with nothing spent adds no extra period on its own.
  const noCost = { eventDate: '2027-01-15', bookingDate: '2026-09-02', createdAt: '2026-09-02', otherExpenses: 0 };
  assert.deepEqual(orderFinancialMonths(noCost), ['2027-01']);
});

test('event months keep their original order counts and nothing is duplicated', () => {
  const orders = [
    { eventDate: '2026-06-12', paymentHistory: [{ id: 'a', amount: 100, date: '2026-06-12' }] },
    { eventDate: '2026-06-20', paymentHistory: [{ id: 'b', amount: 100, date: '2026-06-20' }] },
  ];

  const result = platformFinancialMonths(orders, ['2026-06', '2026-06'], [{ date: '2026-06-30' }]);

  assert.deepEqual(months(result), ['2026-06'], 'one period per month, however many sources mention it');
  assert.equal(result[0].orderCount, 2, 'the existing order-count meaning is unchanged');
});

test('zero-amount and unparseable dates contribute no period', () => {
  const order = {
    eventDate: '2026-06-12',
    paymentHistory: [
      { id: 'zero', amount: 0, date: '2026-04-01' },
      { id: 'bad', amount: 50, date: 'whenever' },
      { id: 'missing', amount: 50 },
    ],
  };

  assert.deepEqual(orderFinancialMonths(order), ['2026-06']);
  assert.deepEqual(months(platformFinancialMonths([{}], [], [{ date: '' }])), []);
});
