import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FinancialValidationError,
  assertValidExpense,
  assertValidOrderFinancials,
  isWholeEgp,
  legacyFractionalFinancialFields,
} from '../src/utils/financialValidation';

const rejects = (run: () => void, because: string) =>
  assert.throws(run, (error: unknown) => error instanceof FinancialValidationError, because);

test('whole pounds are accepted, and zero where the field allows it', () => {
  for (const value of [0, 1, 1_500, 25_000, 1_000_000]) assert.equal(isWholeEgp(value), true, `${value}`);

  assert.doesNotThrow(() => assertValidOrderFinancials({
    totalPrice: 10_000, deposit: 1_500, totalPaid: 1_500, remainingBalance: 8_500,
    paymentStatus: 'partially_paid', securityDeposit: 1_000,
    workerCost: 0, transportationCost: 250, otherExpenses: 300,
  }));
  assert.doesNotThrow(() => assertValidExpense({ amount: 25_000, date: '2026-08-01' }));
});

test('a fractional payment is rejected, never rounded', () => {
  rejects(() => assertValidOrderFinancials({
    paymentHistory: [{ id: 'p1', amount: 1_500.5, date: '2026-08-01', method: 'Cash' }],
  }), 'a half-pound payment');

  // The point is refusal, not correction: nothing turns 1,500.50 into 1,501.
  try {
    assertValidOrderFinancials({ paymentHistory: [{ id: 'p1', amount: 1_500.5, date: '2026-08-01', method: 'Cash' }] });
    assert.fail('should have thrown');
  } catch (error) {
    assert.match((error as Error).message, /الجنيه الصحيح/);
  }
});

test('a fractional expense is rejected', () => {
  rejects(() => assertValidExpense({ amount: 0.25, date: '2026-08-01' }), 'quarter pound');
  rejects(() => assertValidExpense({ amount: 1_500.5, date: '2026-08-01' }), 'half pound');
});

test('a fractional order price, cost or security deposit is rejected', () => {
  for (const write of [
    { totalPrice: 10_000.5 },
    { deposit: 1_500.25 },
    { workerCost: 500.5 },
    { transportationCost: 200.75 },
    { otherExpenses: 300.5 },
    { securityDeposit: 1_000.5 },
    { totalPaid: 2_000.5 },
    { remainingBalance: 7_999.5 },
  ]) {
    rejects(() => assertValidOrderFinancials(write), JSON.stringify(write));
  }
});

test('NaN, Infinity and numeric strings are rejected everywhere', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1500' as unknown as number]) {
    rejects(() => assertValidOrderFinancials({ totalPrice: bad }), String(bad));
    rejects(() => assertValidExpense({ amount: bad }), String(bad));
  }
  assert.equal(isWholeEgp('1500'), false, 'a numeric string is not a number');
  assert.equal(isWholeEgp(Number.NaN), false);
  assert.equal(isWholeEgp(Number.POSITIVE_INFINITY), false);
  rejects(() => assertValidOrderFinancials({
    paymentHistory: [{ id: 'p1', amount: Number.NaN, date: '2026-08-01', method: 'Cash' }],
  }), 'NaN payment');
});

test('an unrelated edit does not round or block a legacy fractional record', () => {
  const legacy = { totalPrice: 10_000.5, deposit: 1_500.25, totalPaid: 1_500.25, workerCost: 500.5 };

  // The same figures passing through untouched are tolerated, so changing the
  // customer's address does not fail and nothing is silently re-rounded.
  assert.doesNotThrow(() => assertValidOrderFinancials({ ...legacy }, legacy));

  // Touching one of them, however, has to produce a whole-pound value.
  rejects(() => assertValidOrderFinancials({ ...legacy, deposit: 1_600.75 }, legacy), 'a new fractional deposit');
  assert.doesNotThrow(() => assertValidOrderFinancials({ ...legacy, deposit: 1_600 }, legacy));

  // A legacy fractional expense behaves the same way.
  const legacyExpense = { amount: 250.5, date: '2026-08-01' };
  assert.doesNotThrow(() => assertValidExpense({ ...legacyExpense }, undefined, legacyExpense));
  rejects(() => assertValidExpense({ amount: 260.5, date: '2026-08-01' }, undefined, legacyExpense), 'a new fractional amount');
});

test('legacy fractional records are reported rather than quietly corrected', () => {
  const flagged = legacyFractionalFinancialFields({
    totalPrice: 10_000.5, deposit: 1_500, workerCost: 500.25, otherExpenses: 300,
    paymentHistory: [
      { id: 'p1', amount: 1_500, date: '2026-08-01' },
      { id: 'p2', amount: 200.5, date: '2026-08-02' },
    ],
  });

  assert.deepEqual(flagged, ['totalPrice', 'workerCost', 'paymentHistory:p2']);
  // A clean record reports nothing at all.
  assert.deepEqual(legacyFractionalFinancialFields({ totalPrice: 10_000, deposit: 1_500, paymentHistory: [] }), []);
  assert.deepEqual(legacyFractionalFinancialFields(undefined), []);
});

test('an unchanged legacy payment entry passes, but editing it must be whole', () => {
  const stored = [{ id: 'p1', amount: 1_500.5, date: '2026-08-01', method: 'Cash' }];

  assert.doesNotThrow(() => assertValidOrderFinancials({ paymentHistory: [...stored] }, { paymentHistory: stored }));
  rejects(
    () => assertValidOrderFinancials(
      { paymentHistory: [{ ...stored[0], amount: 1_600.5 }] },
      { paymentHistory: stored },
    ),
    'a re-entered fractional amount',
  );
  // Adding a new whole-pound payment alongside the legacy one is fine.
  assert.doesNotThrow(() => assertValidOrderFinancials(
    { paymentHistory: [...stored, { id: 'p2', amount: 500, date: '2026-08-05', method: 'Cash' }] },
    { paymentHistory: stored },
  ));
});
