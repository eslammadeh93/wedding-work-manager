import assert from 'node:assert/strict';
import test from 'node:test';
import { FinancialValidationError, assertValidExpense, assertValidOrderFinancials } from '../src/utils/financialValidation';

const rejects = (run: () => void) => assert.throws(run, (error: unknown) => error instanceof FinancialValidationError);

test('invalid order amounts are rejected', () => {
  rejects(() => assertValidOrderFinancials({ totalPrice: Number.NaN }));
  rejects(() => assertValidOrderFinancials({ totalPrice: Number.POSITIVE_INFINITY }));
  rejects(() => assertValidOrderFinancials({ deposit: -1 }));
  rejects(() => assertValidOrderFinancials({ totalPaid: -0.5 }));
  rejects(() => assertValidOrderFinancials({ workerCost: 'many' as unknown as number }));
});

test('malformed order dates are rejected while empty optional dates are kept', () => {
  rejects(() => assertValidOrderFinancials({ eventDate: '2026-13-45' }));
  rejects(() => assertValidOrderFinancials({ bookingDate: 'soon' }));
  assert.doesNotThrow(() => assertValidOrderFinancials({ returnDate: '', eventDate: '2026-10-01' }));
});

test('inconsistent derived financial state is rejected', () => {
  rejects(() => assertValidOrderFinancials({ totalPrice: 5_000, totalPaid: 1_000, remainingBalance: 9_999 }));
  rejects(() => assertValidOrderFinancials({ totalPrice: 5_000, totalPaid: 5_000, paymentStatus: 'unpaid' }));
  assert.doesNotThrow(() => assertValidOrderFinancials({ totalPrice: 5_000, totalPaid: 1_000, remainingBalance: 4_000, paymentStatus: 'partially_paid' }));
  assert.doesNotThrow(() => assertValidOrderFinancials({ totalPrice: 5_000, totalPaid: 6_000, remainingBalance: 0, paymentStatus: 'fully_paid' }));
});

test('zero-value and duplicate payment entries are rejected', () => {
  rejects(() => assertValidOrderFinancials({ paymentHistory: [{ id: 'pay_1', amount: 0, date: '2026-09-01', method: 'Cash', type: 'deposit' }] }));
  rejects(() => assertValidOrderFinancials({ paymentHistory: [{ id: 'pay_1', amount: -5, date: '2026-09-01', method: 'Cash' }] }));
  rejects(() => assertValidOrderFinancials({ paymentHistory: [{ id: 'pay_1', amount: 5, date: 'not-a-date', method: 'Cash' }] }));
  rejects(() => assertValidOrderFinancials({
    paymentHistory: [
      { id: 'pay_1', amount: 5, date: '2026-09-01', method: 'Cash' },
      { id: 'pay_1', amount: 7, date: '2026-09-02', method: 'Cash' },
    ],
  }));
  assert.doesNotThrow(() => assertValidOrderFinancials({ paymentHistory: [{ id: 'pay_1', amount: 5, date: '2026-09-01', method: 'Cash' }] }));
});

test('invalid expense values and linked orders are rejected', () => {
  rejects(() => assertValidExpense({ amount: 0 }));
  rejects(() => assertValidExpense({ amount: -100 }));
  rejects(() => assertValidExpense({ amount: Number.NaN }));
  rejects(() => assertValidExpense({ amount: 10, date: '01/09/2026' }));
  rejects(() => assertValidExpense({ amount: 10, date: '2026-09-01', linkedOrderId: 'ord_other' }, (id) => id === 'ord_mine'));
  assert.doesNotThrow(() => assertValidExpense({ amount: 10, date: '2026-09-01', linkedOrderId: 'ord_mine' }, (id) => id === 'ord_mine'));
  assert.doesNotThrow(() => assertValidExpense({ amount: 10, date: '2026-09-01' }));
});
