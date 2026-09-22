import assert from 'node:assert/strict';
import test from 'node:test';
import type { Order, PaymentEntry } from '../src/types';
import { orderVersionsMatch } from '../src/multiTenant/data/orderVersion';
import { resolveOrderPaymentState } from '../src/utils/orderPaymentState';
import { applyVersionedUpdate, type VersionedSnapshot, type VersionedTransaction } from '../src/multiTenant/data/versionedUpdate';
import { RecordConflictError } from '../src/multiTenant/data/recordConflict';

/**
 * A stand-in for a Firestore transaction. `update` fails on a missing document
 * exactly as Firestore does, which is what stops a stale editor recreating a
 * deleted record.
 */
const fakeStore = (documents: Record<string, Record<string, unknown>>) => {
  const store = new Map(Object.entries(documents));
  const transaction: VersionedTransaction<string> = {
    async get(reference: string): Promise<VersionedSnapshot> {
      return { exists: () => store.has(reference), data: () => store.get(reference) };
    },
    update(reference: string, value: object) {
      if (!store.has(reference)) throw new Error('NOT_FOUND: no document to update');
      store.set(reference, { ...store.get(reference), ...(value as Record<string, unknown>) });
    },
  };
  return { store, transaction };
};

/** The order-editor rule: the write is refused unless the version still matches. */
const orderEditorWrite = (stored: Order, openedWith: string | undefined, patch: Partial<Order>) => {
  if (openedWith && !orderVersionsMatch(openedWith, stored.updatedAt)) {
    return { ok: false as const, code: 'ORDER_STALE' };
  }
  return { ok: true as const, patch };
};

const baseOrder = (): Order => ({
  id: 'ord_1', orderNumber: 'WED-2026-001', customerId: 'cus_1', customerName: 'A', customerPhone: '',
  weddingDate: '2026-10-01', eventDate: '2026-10-01', deliveryDate: '2026-10-01', eventLocation: '',
  totalPrice: 5_000, deposit: 1_000, totalPaid: 1_000, remainingBalance: 4_000, paymentStatus: 'partially_paid',
  paymentHistory: [{ id: 'pay_init', amount: 1_000, date: '2026-08-01', method: 'Cash', type: 'deposit' }],
  orderStatus: 'confirmed', reservedItems: [], attachments: [],
  createdAt: '2026-08-01T09:00:00.000Z', updatedAt: '2026-08-01T09:00:00.000Z',
});

test('a stale order editor cannot overwrite a payment recorded after it was opened', () => {
  const stored = baseOrder();
  const openedWith = stored.updatedAt;

  // Somebody records a settlement while the editor sits open.
  const settlement: PaymentEntry = { id: 'pay_settlement', amount: 2_000, date: '2026-09-21', method: 'InstaPay', type: 'settlement' };
  const afterPayment: Order = {
    ...stored,
    ...resolveOrderPaymentState(stored, { paymentHistory: [...stored.paymentHistory, settlement], totalPrice: stored.totalPrice }),
    paymentHistory: [...stored.paymentHistory, settlement],
    updatedAt: '2026-09-21T10:00:00.000Z',
  };
  assert.equal(afterPayment.totalPaid, 3_000);

  const result = orderEditorWrite(afterPayment, openedWith, { eventLocation: 'New hall' });

  assert.equal(result.ok, false, 'the stale editor must fail instead of writing');
  assert.equal(result.ok === false && result.code, 'ORDER_STALE');
  assert.equal(afterPayment.totalPaid, 3_000, 'the newer payment survives untouched');
});

test('an order editor opened at the current version still saves, and keeps the payment data', () => {
  const stored = baseOrder();

  const result = orderEditorWrite(stored, stored.updatedAt, { eventLocation: 'New hall' });

  assert.equal(result.ok, true);
  // An ordinary edit carries no payment history at all.
  assert.equal('paymentHistory' in (result.ok ? result.patch : {}), false);
  const financial = resolveOrderPaymentState(stored, { totalPrice: stored.totalPrice });
  assert.equal(financial.totalPaid, 1_000);
  assert.equal(financial.paymentHistory, undefined);
});

test('concurrent expense edits conflict instead of overwriting each other', async () => {
  const { store, transaction } = fakeStore({
    'expenses/exp_1': { id: 'exp_1', amount: 500, date: '2026-09-01', updatedAt: '2026-09-01T08:00:00.000Z' },
  });
  const openedWith = '2026-09-01T08:00:00.000Z';

  // The first editor saves and moves the version forward.
  await applyVersionedUpdate(transaction, 'expenses/exp_1', { amount: 700, updatedAt: '2026-09-02T08:00:00.000Z' }, openedWith);
  assert.equal(store.get('expenses/exp_1')?.amount, 700);

  // The second editor started from the same version and must now be refused.
  await assert.rejects(
    () => applyVersionedUpdate(transaction, 'expenses/exp_1', { amount: 900, updatedAt: '2026-09-02T09:00:00.000Z' }, openedWith),
    (error: RecordConflictError) => error.code === 'CONFLICT',
  );
  assert.equal(store.get('expenses/exp_1')?.amount, 700, 'the first save is not silently replaced');
});

test('a deleted expense cannot be recreated by a stale editor', async () => {
  const { store, transaction } = fakeStore({
    'expenses/exp_1': { id: 'exp_1', amount: 500, date: '2026-09-01', updatedAt: '2026-09-01T08:00:00.000Z' },
  });
  const openedWith = '2026-09-01T08:00:00.000Z';

  store.delete('expenses/exp_1');

  await assert.rejects(
    () => applyVersionedUpdate(transaction, 'expenses/exp_1', { amount: 900, updatedAt: '2026-09-02T09:00:00.000Z' }, openedWith),
    (error: RecordConflictError) => error.code === 'NOT_FOUND',
  );
  assert.equal(store.has('expenses/exp_1'), false, 'the deleted expense stays deleted');
});

test('a soft-deleted record is treated as gone rather than revived', async () => {
  const { store, transaction } = fakeStore({
    'expenses/exp_1': { id: 'exp_1', amount: 500, deletedAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-01T08:00:00.000Z' },
  });

  await assert.rejects(
    () => applyVersionedUpdate(transaction, 'expenses/exp_1', { amount: 900 }, '2026-09-01T08:00:00.000Z'),
    (error: RecordConflictError) => error.code === 'NOT_FOUND',
  );
  assert.equal(store.get('expenses/exp_1')?.amount, 500);
});

test('a record written before versions existed is still editable', async () => {
  const { store, transaction } = fakeStore({ 'expenses/exp_legacy': { id: 'exp_legacy', amount: 500 } });

  await applyVersionedUpdate(transaction, 'expenses/exp_legacy', { amount: 600, updatedAt: '2026-09-02T08:00:00.000Z' }, undefined);

  assert.equal(store.get('expenses/exp_legacy')?.amount, 600);
});
