import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import type { Order, PaymentEntry } from '../src/types';
import {
  editPaymentEntry,
  orderFinancialPosition,
  removePaymentEntry,
  resolveOrderPaymentState,
} from '../src/utils/orderPaymentState';
import { orderVersionsMatch } from '../src/multiTenant/data/orderVersion';

const baseOrder = (changes: Partial<Order> = {}): Order => ({
  id: 'ord_1', orderNumber: 'WED-2026-001', customerId: 'cus_1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-08-01', weddingDate: '2026-10-01', eventDate: '2026-10-01', deliveryDate: '2026-10-01', eventLocation: '',
  totalPrice: 10_000, deposit: 2_000, totalPaid: 5_000, remainingBalance: 5_000, paymentStatus: 'partially_paid',
  paymentHistory: [
    { id: 'pay_deposit', amount: 2_000, date: '2026-08-01', method: 'Cash', type: 'deposit' },
    { id: 'pay_settlement', amount: 3_000, date: '2026-09-10', method: 'InstaPay', type: 'settlement' },
  ],
  orderStatus: 'confirmed', reservedItems: [], attachments: [],
  createdAt: '2026-08-01T09:00:00.000Z', updatedAt: '2026-08-01T09:00:00.000Z',
  ...changes,
});

/**
 * The provider's payment write, reproduced exactly: a version guard, then the
 * caller's reducer applied to the history **as stored**, then the canonical
 * resolver. The screen never supplies a history snapshot of its own, which is
 * what makes a concurrent payment survive a correction made beside it.
 */
const paymentWrite = (
  stored: Order,
  apply: (history: PaymentEntry[]) => PaymentEntry[] | null,
  options: { expectedUpdatedAt?: string } = {},
) => {
  if (options.expectedUpdatedAt && !orderVersionsMatch(options.expectedUpdatedAt, stored.updatedAt)) {
    return { ok: false as const, code: 'ORDER_STALE', stored };
  }
  const nextHistory = apply(stored.paymentHistory || []);
  if (!nextHistory) return { ok: true as const, wrote: false, stored };
  const financial = resolveOrderPaymentState(stored, { paymentHistory: nextHistory, totalPrice: stored.totalPrice });
  return {
    ok: true as const,
    wrote: true,
    stored: { ...stored, ...financial, paymentHistory: nextHistory, updatedAt: '2026-09-20T12:00:00.000Z' } as Order,
  };
};

// --- editing a payment -------------------------------------------------------

test('editing a payment amount recalculates every derived figure', () => {
  const result = paymentWrite(baseOrder(), (history) => editPaymentEntry(history, 'pay_settlement', { amount: 6_000 }));
  assert.equal(result.ok && result.wrote, true);
  const updated = result.stored;

  assert.equal(updated.totalPaid, 8_000, '2,000 deposit + the corrected 6,000');
  assert.equal(updated.remainingBalance, 2_000);
  assert.equal(updated.paymentStatus, 'partially_paid');
  assert.equal(orderFinancialPosition(updated).customerCredit, 0);
});

test('correcting a payment upwards can complete the order and create credit', () => {
  const settled = paymentWrite(baseOrder(), (history) => editPaymentEntry(history, 'pay_settlement', { amount: 8_000 })).stored;
  assert.equal(settled.totalPaid, 10_000);
  assert.equal(settled.remainingBalance, 0);
  assert.equal(settled.paymentStatus, 'fully_paid');

  const overpaid = paymentWrite(settled, (history) => editPaymentEntry(history, 'pay_settlement', { amount: 8_500 })).stored;
  assert.equal(overpaid.totalPaid, 10_500);
  assert.equal(overpaid.remainingBalance, 0);
  assert.equal(overpaid.paymentStatus, 'fully_paid');
  assert.equal(orderFinancialPosition(overpaid).customerCredit, 500, 'the extra 500 is owed back, not revenue');
});

test('editing one entry leaves every other entry byte-for-byte untouched', () => {
  const stored = baseOrder();
  const untouched = stored.paymentHistory[0];
  const updated = paymentWrite(stored, (history) => editPaymentEntry(history, 'pay_settlement', { amount: 4_000, date: '2026-09-15' })).stored;

  assert.deepEqual(updated.paymentHistory[0], untouched, 'the deposit entry is unchanged');
  const edited = updated.paymentHistory.find((entry) => entry.id === 'pay_settlement');
  assert.equal(edited?.amount, 4_000);
  assert.equal(edited?.date, '2026-09-15');
  assert.equal(edited?.method, 'InstaPay', 'the method is not reclassified');
  assert.equal(edited?.type, 'settlement', 'and neither is the type');
  assert.equal(updated.paymentHistory.length, 2, 'no entry is added or dropped');
  assert.equal(updated.totalPrice, stored.totalPrice, 'the price is untouched');
});

test('a correction that changes nothing writes nothing', () => {
  const result = paymentWrite(baseOrder(), (history) => editPaymentEntry(history, 'pay_settlement', { amount: 3_000, date: '2026-09-10' }));
  assert.equal(result.ok && result.wrote, false, 'a no-op must not bump the version for other open editors');
  assert.equal(editPaymentEntry(baseOrder().paymentHistory, 'missing_id', { amount: 1 }), null);
});

test('a correction refuses an amount that is not real money', () => {
  const history = baseOrder().paymentHistory;
  assert.throws(() => editPaymentEntry(history, 'pay_settlement', { amount: 0 }));
  assert.throws(() => editPaymentEntry(history, 'pay_settlement', { amount: -50 }));
  assert.throws(() => editPaymentEntry(history, 'pay_settlement', { date: '' }));
});

test('a stale correction fails safely instead of overwriting a newer payment', () => {
  const stored = baseOrder();
  const openedWith = stored.updatedAt;

  // Someone records a further payment while the correction sits open.
  const extra: PaymentEntry = { id: 'pay_late', amount: 1_000, date: '2026-09-18', method: 'Cash', type: 'settlement' };
  const moved = paymentWrite(stored, (history) => [...history, extra]).stored;
  assert.equal(moved.totalPaid, 6_000);

  const stale = paymentWrite(moved, (history) => editPaymentEntry(history, 'pay_settlement', { amount: 9_000 }), { expectedUpdatedAt: openedWith });
  assert.equal(stale.ok, false);
  assert.equal(!stale.ok && stale.code, 'ORDER_STALE');
  assert.equal(stale.stored.totalPaid, 6_000, 'the newer payment still stands');
  assert.equal(stale.stored.paymentHistory.length, 3);
});

// --- deleting a payment ------------------------------------------------------

test('deleting a payment recalculates all derived payment state', () => {
  const result = paymentWrite(baseOrder(), (history) => removePaymentEntry(history, 'pay_settlement'));
  const updated = result.stored;

  assert.equal(updated.paymentHistory.length, 1);
  assert.equal(updated.totalPaid, 2_000, 'only the deposit is left');
  assert.equal(updated.remainingBalance, 8_000);
  assert.equal(updated.paymentStatus, 'partially_paid');
  assert.equal(orderFinancialPosition(updated).customerCredit, 0);
});

test('deleting one payment leaves the others and the order itself untouched', () => {
  const stored = baseOrder({
    workerCost: 400, transportationCost: 200, otherExpenses: 100,
    cancellationHistory: [{ kind: 'cancelled_deposit_retained', at: '2026-09-01T00:00:00.000Z' }],
  });
  const updated = paymentWrite(stored, (history) => removePaymentEntry(history, 'pay_settlement')).stored;

  assert.deepEqual(updated.paymentHistory, [stored.paymentHistory[0]], 'the deposit survives exactly as recorded');
  assert.equal(updated.totalPrice, 10_000);
  assert.equal(updated.workerCost, 400);
  assert.equal(updated.transportationCost, 200);
  assert.equal(updated.otherExpenses, 100);
  assert.deepEqual(updated.cancellationHistory, stored.cancellationHistory, 'the cancellation history is not touched');
});

test('a stale delete cannot overwrite newer payment data', () => {
  const stored = baseOrder();
  const openedWith = stored.updatedAt;
  const extra: PaymentEntry = { id: 'pay_late', amount: 2_500, date: '2026-09-19', method: 'Cash', type: 'settlement' };
  const moved = paymentWrite(stored, (history) => [...history, extra]).stored;

  const stale = paymentWrite(moved, (history) => removePaymentEntry(history, 'pay_settlement'), { expectedUpdatedAt: openedWith });
  assert.equal(stale.ok, false);
  assert.equal(stale.stored.paymentHistory.length, 3, 'nothing was removed');
  assert.equal(stale.stored.totalPaid, 7_500);

  // Deleting an entry that is already gone writes nothing at all.
  const gone = paymentWrite(moved, (history) => removePaymentEntry(history, 'pay_never'));
  assert.equal(gone.ok && gone.wrote, false);
});

test('an ordinary order edit can neither remove nor reduce a recorded payment', () => {
  // Deletion is its own deliberate action: an edit that does not carry a
  // payment intent leaves the entries alone and can never lower the total.
  const stored = baseOrder();
  const ordinaryEdit = resolveOrderPaymentState(stored, { totalPrice: 12_000 });

  assert.equal(ordinaryEdit.paymentHistory, undefined, 'no entry is rewritten by an ordinary edit');
  assert.equal(ordinaryEdit.totalPaid, 5_000, 'and the paid total is preserved');
  assert.equal(ordinaryEdit.remainingBalance, 7_000);
});

// --- legacy security entries stay financially inert ---------------------------

test('editing or deleting a legacy security entry moves no financial total', () => {
  const withLegacy = baseOrder({
    securityDeposit: 1_000,
    paymentHistory: [
      ...baseOrder().paymentHistory,
      { id: 'sec_1', amount: 1_000, date: '2026-08-04', method: 'Cash', type: 'security_deposit' },
    ],
  });
  const before = orderFinancialPosition(withLegacy);

  const edited = paymentWrite(withLegacy, (history) => editPaymentEntry(history, 'sec_1', { amount: 4_000, date: '2026-09-01' })).stored;
  assert.deepEqual(orderFinancialPosition(edited), before, 'raising a legacy security amount changes nothing');
  assert.equal(edited.totalPaid, withLegacy.totalPaid);
  assert.equal(edited.remainingBalance, withLegacy.remainingBalance);

  const deleted = paymentWrite(withLegacy, (history) => removePaymentEntry(history, 'sec_1')).stored;
  assert.deepEqual(orderFinancialPosition(deleted), before, 'and neither does removing it');
  assert.equal(deleted.paymentHistory.length, 2, 'only that entry went');
});

// --- the controls are actually wired up --------------------------------------

test('every payment row offers both a correction and a deletion', () => {
  const rows = fs.readFileSync('src/components/orders/OrderDetailSections.tsx', 'utf8');
  const modal = fs.readFileSync('src/components/orders/OrderDetailModal.tsx', 'utf8');

  assert.ok(rows.includes('onEditPayment'), 'the edit control is rendered');
  assert.ok(rows.includes('onDeletePayment'), 'the delete control is rendered');
  assert.equal(rows.includes("pay.type === 'settlement' && onDeletePayment"), false,
    'deletion is no longer limited to settlement rows');

  assert.ok(modal.includes('editPaymentEntry'), 'the modal corrects through the canonical reducer');
  assert.ok(modal.includes('removePaymentEntry'), 'and deletes through it too');
  assert.ok(modal.includes('window.confirm'), 'both actions confirm explicitly');
  assert.ok(modal.includes('expectedUpdatedAt: order.updatedAt'), 'and both carry the version they were opened with');
  assert.ok(modal.includes('editedPaymentAmount'), 'the amount is editable, not only the date');
});
