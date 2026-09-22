import assert from 'node:assert/strict';
import test from 'node:test';
import type { Order, PaymentEntry } from '../src/types';
import { appendPaymentEntry, canonicalRecordedPaid, resolveOrderPaymentState, unexplainedLegacyPaid } from '../src/utils/orderPaymentState';
import { recordedOrderPayment } from '../src/utils/orderPayments';

const depositEntry = (amount: number, date = '2026-08-01'): PaymentEntry => ({ id: 'pay_init', amount, date, method: 'Cash', type: 'deposit', notes: 'Initial Deposit Payment' });
const settlementEntry = (amount: number, date = '2026-09-10'): PaymentEntry => ({ id: 'pay_settlement', amount, date, method: 'InstaPay', type: 'settlement' });

test('deposit correction upwards updates the deposit payment entry and the paid total', () => {
  const stored = { deposit: 1_000, totalPaid: 1_000, totalPrice: 5_000, paymentHistory: [depositEntry(1_000)] };

  const resolved = resolveOrderPaymentState(stored, { deposit: 1_500, totalPrice: 5_000 });

  assert.equal(resolved.totalPaid, 1_500);
  assert.equal(resolved.remainingBalance, 3_500);
  assert.equal(resolved.paymentStatus, 'partially_paid');
  assert.deepEqual(resolved.paymentHistory?.map((entry) => entry.amount), [1_500]);
  // The correction edits the existing entry instead of adding a second one.
  assert.equal(resolved.paymentHistory?.length, 1);
  assert.equal(resolved.paymentHistory?.[0].date, '2026-08-01');
});

test('deposit correction downwards reduces the same entry and never leaves a zero-value payment', () => {
  const stored = { deposit: 1_000, totalPaid: 1_600, totalPrice: 5_000, paymentHistory: [depositEntry(1_000), settlementEntry(600)] };

  const lowered = resolveOrderPaymentState(stored, { deposit: 400, totalPrice: 5_000 });
  assert.equal(lowered.totalPaid, 1_000);
  assert.deepEqual(lowered.paymentHistory?.map((entry) => entry.amount), [400, 600]);

  const cleared = resolveOrderPaymentState(stored, { deposit: 0, totalPrice: 5_000 });
  assert.equal(cleared.totalPaid, 600);
  assert.deepEqual(cleared.paymentHistory?.map((entry) => entry.id), ['pay_settlement']);
  assert.equal(cleared.paymentHistory?.some((entry) => entry.amount === 0), false);
});

test('legacy record with incomplete payment history does not silently lose paid money', () => {
  // Written before payment history existed: 2,500 collected, nothing itemised.
  const legacy = { deposit: 1_000, totalPaid: 2_500, totalPrice: 6_000, paymentHistory: [] as PaymentEntry[] };

  assert.equal(unexplainedLegacyPaid(legacy), 2_500, 'nothing in this record is itemised, so all of it is carried forward');
  assert.equal(canonicalRecordedPaid(legacy), 2_500);
  assert.equal(recordedOrderPayment(legacy), 2_500);

  // An unrelated edit keeps every collected pound.
  const untouched = resolveOrderPaymentState(legacy, { totalPrice: 6_000 });
  assert.equal(untouched.totalPaid, 2_500);
  assert.equal(untouched.paymentHistory, undefined);

  // A deposit correction moves the total by the correction only, and does not
  // invent a collection entry whose date nobody knows.
  const corrected = resolveOrderPaymentState(legacy, { deposit: 1_200, totalPrice: 6_000 });
  assert.equal(corrected.totalPaid, 2_700);
  assert.equal(corrected.paymentHistory, undefined);

  // Recording a real settlement adds to the legacy amount rather than replacing it.
  const settled = resolveOrderPaymentState(legacy, { paymentHistory: [settlementEntry(500)], totalPrice: 6_000 });
  assert.equal(settled.totalPaid, 3_000);
});

test('an unrelated order edit preserves the payment data untouched', () => {
  const stored = { deposit: 1_000, totalPaid: 1_600, totalPrice: 5_000, paymentHistory: [depositEntry(1_000), settlementEntry(600)] };

  const resolved = resolveOrderPaymentState(stored, { totalPrice: 5_000 });

  assert.equal(resolved.paymentHistory, undefined, 'an ordinary edit must not rewrite payment history');
  assert.equal(resolved.totalPaid, 1_600);
  assert.equal(resolved.remainingBalance, 3_400);
});

test('an order edit can never reduce a previously recorded paid amount', () => {
  const stored = { deposit: 1_000, totalPaid: 400, totalPrice: 5_000, paymentHistory: [depositEntry(1_000)] };

  // The stored total contradicts the recorded payments; the canonical value
  // sides with the money that was actually recorded.
  assert.equal(resolveOrderPaymentState(stored, { totalPrice: 5_000 }).totalPaid, 1_000);
});

test('a retried payment with the same id is a no-op instead of a duplicate collection', () => {
  const history = [depositEntry(1_000), settlementEntry(600)];
  assert.equal(appendPaymentEntry(history, settlementEntry(600)), null);
  assert.equal(appendPaymentEntry(history, { ...settlementEntry(600), id: 'pay_other' })?.length, 3);
});

test('a settlement keeps the receipt date it was recorded with, not the event date', () => {
  const stored: Pick<Order, 'deposit' | 'totalPaid' | 'totalPrice' | 'paymentHistory'> = {
    deposit: 1_000, totalPaid: 1_000, totalPrice: 3_000, paymentHistory: [depositEntry(1_000)],
  };
  const received = settlementEntry(2_000, '2026-09-21');

  const resolved = resolveOrderPaymentState(stored, { paymentHistory: [...stored.paymentHistory, received], totalPrice: 3_000 });

  assert.equal(resolved.paymentHistory?.[1].date, '2026-09-21');
  assert.equal(resolved.totalPaid, 3_000);
  assert.equal(resolved.paymentStatus, 'fully_paid');
  assert.equal(resolved.remainingBalance, 0);
});
