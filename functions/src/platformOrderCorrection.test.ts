import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PlatformCorrectionError,
  platformVersionsMatch,
  resolvePlatformOrderCorrection,
} from './platformOrderCorrection.js';

const now = new Date('2026-09-21T12:00:00.000Z');

const storedOrder = () => ({
  totalPrice: 5_000,
  deposit: 1_000,
  totalPaid: 1_000,
  updatedAt: '2026-08-01T09:00:00.000Z',
  paymentHistory: [{ id: 'pay_init', amount: 1_000, date: '2026-08-01', method: 'Cash', type: 'deposit' }],
});

test('a correction derives the paid total from the recorded payments', () => {
  const resolved = resolvePlatformOrderCorrection(storedOrder(), { totalPrice: 6_000, deposit: 1_000 }, 'owner_1', now);

  assert.equal(resolved.totalPaid, 1_000);
  assert.equal(resolved.remainingBalance, 5_000);
  assert.equal(resolved.paymentStatus, 'partially_paid');
  assert.equal(resolved.paymentHistory, undefined, 'a correction without an adjustment leaves the payments alone');
});

test('a deliberate adjustment is recorded as a payment entry with its reason', () => {
  const resolved = resolvePlatformOrderCorrection(storedOrder(), {
    totalPrice: 5_000, deposit: 1_000, paymentAdjustment: 500, adjustmentReason: 'InstaPay transfer missed by the branch',
  }, 'owner_1', now);

  assert.equal(resolved.totalPaid, 1_500);
  assert.equal(resolved.adjustment?.amount, 500);
  assert.equal(resolved.adjustment?.type, 'adjustment');
  assert.equal(resolved.adjustment?.recordedByPlatformOwner, 'owner_1');
  assert.equal(resolved.adjustment?.notes, 'InstaPay transfer missed by the branch');
  assert.equal(resolved.paymentHistory?.length, 2);
  // The total and the evidence for it always agree.
  assert.equal(resolved.totalPaid, (resolved.paymentHistory as { amount: number }[]).reduce((sum, entry) => sum + entry.amount, 0));
});

test('an adjustment without a reason is refused', () => {
  assert.throws(
    () => resolvePlatformOrderCorrection(storedOrder(), { totalPrice: 5_000, deposit: 1_000, paymentAdjustment: 500 }, 'owner_1', now),
    (error: PlatformCorrectionError) => error.reason === 'ADJUSTMENT_REASON_REQUIRED',
  );
});

test('a legacy total that no payment explains survives a correction', () => {
  const legacy = { totalPrice: 6_000, deposit: 1_000, totalPaid: 2_500, paymentHistory: [], updatedAt: '2026-08-01T09:00:00.000Z' };

  // A correction that leaves the deposit alone leaves the legacy amount alone.
  const resolved = resolvePlatformOrderCorrection(legacy, { totalPrice: 6_000, deposit: 1_000 }, 'owner_1', now);

  assert.equal(resolved.totalPaid, 2_500);
  assert.equal(resolved.paymentHistory, undefined);
});

test('a correction racing a newer payment is rejected by the version check', () => {
  const stored = storedOrder();
  const openedWith = stored.updatedAt;

  // A settlement lands while the correction form is open.
  const afterPayment = { ...stored, totalPaid: 3_000, updatedAt: '2026-09-21T10:00:00.000Z' };

  assert.equal(platformVersionsMatch(openedWith, afterPayment.updatedAt), false);
  assert.equal(platformVersionsMatch(openedWith, stored.updatedAt), true);
  // Firestore Timestamps and ISO strings describe the same instant.
  assert.equal(platformVersionsMatch(openedWith, { toMillis: () => Date.parse(openedWith) }), true);
  assert.equal(platformVersionsMatch(openedWith, undefined), false);
});

test('a correction applied to the newer record keeps the payment that landed first', () => {
  const settled = {
    totalPrice: 5_000, deposit: 1_000, totalPaid: 3_000, updatedAt: '2026-09-21T10:00:00.000Z',
    paymentHistory: [
      { id: 'pay_init', amount: 1_000, date: '2026-08-01', method: 'Cash', type: 'deposit' },
      { id: 'pay_settlement', amount: 2_000, date: '2026-09-21', method: 'InstaPay', type: 'settlement' },
    ],
  };

  const resolved = resolvePlatformOrderCorrection(settled, { totalPrice: 5_000, deposit: 1_000 }, 'owner_1', now);

  assert.equal(resolved.totalPaid, 3_000, 'the settlement recorded first is still counted');
  assert.equal(resolved.paymentStatus, 'partially_paid');
  assert.equal(resolved.remainingBalance, 2_000);
});

test('a raw totalPaid from the caller cannot move the collected amount', () => {
  const input = { totalPrice: 5_000, deposit: 1_000, totalPaid: 99_999 } as unknown as { totalPrice: number; deposit: number };

  const resolved = resolvePlatformOrderCorrection(storedOrder(), input, 'owner_1', now);

  assert.equal(resolved.totalPaid, 1_000);
});

// A platform deposit correction must follow the same deposit-entry rules as
// the company-side resolver, so `deposit` and the payment history can never
// drift apart.
test('a platform deposit increase updates the deposit entry and the paid total', () => {
  const resolved = resolvePlatformOrderCorrection(storedOrder(), { totalPrice: 5_000, deposit: 1_500 }, 'owner_1', now);

  assert.equal(resolved.totalPaid, 1_500);
  assert.equal(resolved.remainingBalance, 3_500);
  assert.equal(resolved.paymentStatus, 'partially_paid');
  assert.deepEqual((resolved.paymentHistory as { amount: number }[]).map((entry) => entry.amount), [1_500]);
});

test('a platform deposit decrease reduces the same entry', () => {
  const settled = {
    totalPrice: 5_000, deposit: 1_000, totalPaid: 1_600, updatedAt: '2026-08-01T09:00:00.000Z',
    paymentHistory: [
      { id: 'pay_init', amount: 1_000, date: '2026-08-01', method: 'Cash', type: 'deposit' },
      { id: 'pay_settlement', amount: 600, date: '2026-09-10', method: 'InstaPay', type: 'settlement' },
    ],
  };

  const lowered = resolvePlatformOrderCorrection(settled, { totalPrice: 5_000, deposit: 400 }, 'owner_1', now);
  assert.equal(lowered.totalPaid, 1_000);
  assert.deepEqual((lowered.paymentHistory as { amount: number }[]).map((entry) => entry.amount), [400, 600]);

  // Clearing the deposit removes the entry rather than leaving a zero-value one.
  const cleared = resolvePlatformOrderCorrection(settled, { totalPrice: 5_000, deposit: 0 }, 'owner_1', now);
  assert.equal(cleared.totalPaid, 600);
  assert.deepEqual((cleared.paymentHistory as { id: string }[]).map((entry) => entry.id), ['pay_settlement']);
  assert.equal((cleared.paymentHistory as { amount: number }[]).some((entry) => entry.amount === 0), false);
});

test('a platform deposit correction updates the existing entry instead of duplicating it', () => {
  const resolved = resolvePlatformOrderCorrection(storedOrder(), { totalPrice: 5_000, deposit: 2_000 }, 'owner_1', now);

  const entries = resolved.paymentHistory as { id: string; type: string; date: string }[];
  assert.equal(entries.length, 1, 'no second deposit entry is created');
  assert.equal(entries.filter((entry) => entry.type === 'deposit').length, 1);
  assert.equal(entries[0].id, 'pay_init', 'the original entry is corrected in place');
  assert.equal(entries[0].date, '2026-08-01', 'the original receipt date is kept');
  assert.equal(resolved.totalPaid, 2_000);
});

test('a platform deposit correction preserves a legacy unexplained paid amount', () => {
  // 2,500 collected, none of it itemised, and no deposit entry to correct.
  const legacy = { totalPrice: 6_000, deposit: 1_000, totalPaid: 2_500, paymentHistory: [], updatedAt: '2026-08-01T09:00:00.000Z' };

  const raised = resolvePlatformOrderCorrection(legacy, { totalPrice: 6_000, deposit: 1_200 }, 'owner_1', now);
  assert.equal(raised.totalPaid, 2_700, 'the correction moves the total, the legacy amount survives');
  assert.equal(raised.paymentHistory, undefined, 'no collection is invented for a record with no entries');

  // A legacy remainder alongside a real deposit entry is carried through too.
  const partiallyItemised = {
    totalPrice: 6_000, deposit: 1_000, totalPaid: 1_800, updatedAt: '2026-08-01T09:00:00.000Z',
    paymentHistory: [{ id: 'pay_init', amount: 1_000, date: '2026-08-01', method: 'Cash', type: 'deposit' }],
  };
  const corrected = resolvePlatformOrderCorrection(partiallyItemised, { totalPrice: 6_000, deposit: 1_200 }, 'owner_1', now);
  assert.equal(corrected.totalPaid, 2_000, '800 unexplained + the corrected 1,200 deposit');
});

test('a stale expectedVersion still rejects a deposit correction', () => {
  const stored = storedOrder();
  const openedWith = stored.updatedAt;

  // A settlement lands while the correction form sits open.
  const afterPayment = { ...stored, totalPaid: 3_000, updatedAt: '2026-09-21T10:00:00.000Z' };

  assert.equal(platformVersionsMatch(openedWith, afterPayment.updatedAt), false, 'the correction must be refused');
  // Applied to the newer record instead, the deposit correction keeps that payment.
  const resolved = resolvePlatformOrderCorrection(
    { ...afterPayment, paymentHistory: [...stored.paymentHistory, { id: 'pay_settlement', amount: 2_000, date: '2026-09-21', method: 'InstaPay', type: 'settlement' }] },
    { totalPrice: 5_000, deposit: 1_500 }, 'owner_1', now,
  );
  assert.equal(resolved.totalPaid, 3_500);
  assert.equal((resolved.paymentHistory as { amount: number }[]).length, 2);
});
