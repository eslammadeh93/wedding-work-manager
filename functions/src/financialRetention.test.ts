import assert from 'node:assert/strict';
import test from 'node:test';
import { holdsFinancialHistory, legacyRecognitionBackfill, partitionPurgeCandidates, recognitionBackfillDecision } from './financialRetention.js';

const candidate = (data: Record<string, unknown>) => ({ id: String(data.id || 'x'), data });

test('the purge never destroys an order that still carries financial history', () => {
  const expired = [
    candidate({ id: 'paid', totalPaid: 800, paymentHistory: [{ id: 'pay_1', amount: 800 }] }),
    candidate({ id: 'retained', financiallyRetained: true }),
    candidate({ id: 'completed', orderStatus: 'completed' }),
    candidate({ id: 'recognized', fulfillmentRecognizedAt: '2026-08-20T00:00:00.000Z' }),
    candidate({ id: 'empty', totalPaid: 0, deposit: 0, paymentHistory: [], orderStatus: 'new' }),
  ];

  const { destroy, retain } = partitionPurgeCandidates(expired, 'orders');

  assert.deepEqual(destroy.map((item) => item.id), ['empty'], 'only an order with no financial history is destroyed');
  assert.deepEqual(retain.map((item) => item.id), ['paid', 'retained', 'completed', 'recognized']);
});

test('records that cannot carry financial history are purged as before', () => {
  const expired = [candidate({ id: 'cus_1' }), candidate({ id: 'cus_2' })];
  for (const collectionName of ['customers', 'inventory']) {
    const { destroy, retain } = partitionPurgeCandidates(expired, collectionName);
    assert.equal(destroy.length, 2, `${collectionName} still purges normally`);
    assert.equal(retain.length, 0);
  }
});

test('financial history is recognised from any of the posted signals', () => {
  assert.equal(holdsFinancialHistory({ deposit: 500 }), true);
  assert.equal(holdsFinancialHistory({ paymentHistory: [{ amount: 10 }] }), true);
  assert.equal(holdsFinancialHistory({ orderStatus: 'returned', fulfillmentRecognizedAt: '2026-08-20' }), true);
  assert.equal(holdsFinancialHistory({ orderStatus: 'cancelled', totalPaid: 0, deposit: 0 }), false);
  assert.equal(holdsFinancialHistory(undefined), false);
});

// --- legacy fulfillment-recognition backfill --------------------------------

const legacyOrder = (changes: Record<string, unknown>) => ({
  orderStatus: 'returned', workerCost: 400, transportationCost: 100,
  eventDate: '2026-08-20', weddingDate: '2026-08-20',
  updatedAt: '2026-09-02T09:00:00.000Z', createdAt: '2026-08-01T09:00:00.000Z',
  ...changes,
});

test('a legacy returned order with fulfillment costs is recognized', () => {
  const updates = legacyRecognitionBackfill(legacyOrder({}));

  assert.ok(updates, 'the record must be repaired');
  assert.equal(updates.fulfillmentRecognizedAt, '2026-08-20', 'the execution date the costs are already accounted to');
  assert.match(updates.fulfillmentRecognizedAt, /^\d{4}-\d{2}-\d{2}$/, 'a plain day, so no time zone can shift it to another date');
  assert.equal(updates.fulfillmentRecognizedSource, 'backfill', 'the instant is marked as inferred, never as observed');
});

test('an order still sitting at completed is repaired too, before anyone returns it', () => {
  // These look correct today only because the status predicate covers them.
  const updates = legacyRecognitionBackfill(legacyOrder({ orderStatus: 'completed' }));
  assert.equal(updates?.fulfillmentRecognizedAt, '2026-08-20');
});

test('an existing recognition timestamp is never overwritten', () => {
  const observed = '2026-08-20T18:42:11.000Z';
  assert.equal(legacyRecognitionBackfill(legacyOrder({ fulfillmentRecognizedAt: observed })), null);
  assert.equal(legacyRecognitionBackfill(legacyOrder({ fulfillmentRecognizedAt: observed, fulfillmentRecognizedSource: 'completion' })), null);
});

test('orders that never completed are not stamped', () => {
  for (const orderStatus of ['new', 'confirmed', 'preparing', 'out_for_delivery', 'cancelled', 'cancelled_deposit_retained', 'pending', 'in_progress']) {
    assert.equal(legacyRecognitionBackfill(legacyOrder({ orderStatus })), null, `${orderStatus} must be left alone`);
  }
});

test('a record with no fulfillment cost is left unchanged', () => {
  assert.equal(legacyRecognitionBackfill(legacyOrder({ workerCost: 0, transportationCost: 0 })), null);
  assert.equal(legacyRecognitionBackfill(legacyOrder({ workerCost: undefined, transportationCost: undefined })), null);
  // A cost on either field alone is still worth protecting.
  assert.ok(legacyRecognitionBackfill(legacyOrder({ workerCost: 0, transportationCost: 75 })));
});

test('no date is invented when the record carries none that can be trusted', () => {
  assert.equal(legacyRecognitionBackfill(legacyOrder({ eventDate: '', weddingDate: '', updatedAt: '', createdAt: '' })), null);
  assert.equal(legacyRecognitionBackfill(legacyOrder({ eventDate: 'soon', weddingDate: '', updatedAt: '', createdAt: '' })), null);
  // It falls back through the record's other dates before giving up.
  assert.equal(
    legacyRecognitionBackfill(legacyOrder({ eventDate: '', weddingDate: '' }))?.fulfillmentRecognizedAt,
    '2026-09-02',
  );
});

test('the backfill is idempotent: a second pass over its own output changes nothing', () => {
  const record: Record<string, unknown> = legacyOrder({});

  const first = legacyRecognitionBackfill(record);
  assert.ok(first);
  const afterFirstRun: Record<string, unknown> = { ...record, ...first };

  assert.equal(legacyRecognitionBackfill(afterFirstRun), null, 'a second run is a no-op');
  assert.equal(legacyRecognitionBackfill({ ...afterFirstRun, ...(legacyRecognitionBackfill(afterFirstRun) || {}) }), null);
  // The financial amounts are untouched by any number of runs.
  assert.equal(afterFirstRun.workerCost, 400);
  assert.equal(afterFirstRun.transportationCost, 100);
  assert.equal(afterFirstRun.eventDate, '2026-08-20');
});

test('the stamped value is a date-only day that no time zone can shift', () => {
  const stamped = legacyRecognitionBackfill(legacyOrder({ eventDate: '2026-08-20' }));

  assert.equal(stamped?.fulfillmentRecognizedAt, '2026-08-20');
  assert.equal(stamped?.fulfillmentRecognizedSource, 'backfill', 'it is never presented as an observed completion time');
  // Rendering the stored value in any time zone still reads as the same day,
  // which an instant such as midday UTC would not (UTC+14 rolls it forward).
  for (const timeZone of ['Pacific/Kiritimati', 'Etc/GMT+12', 'Africa/Cairo', 'UTC']) {
    const rendered = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(`${stamped!.fulfillmentRecognizedAt}T00:00:00Z`));
    assert.equal(rendered >= '2026-08-19' && rendered <= '2026-08-20', true, `stored day stays readable in ${timeZone}`);
  }
  assert.equal(stamped!.fulfillmentRecognizedAt.length, 10, 'no instant is implied at all');
});

test('skipped records report why, so undatable ones can be found and reviewed', () => {
  assert.deepEqual(recognitionBackfillDecision(legacyOrder({ fulfillmentRecognizedAt: '2026-08-20' })), { action: 'skip', reason: 'already-recognized' });
  assert.deepEqual(recognitionBackfillDecision(legacyOrder({ orderStatus: 'cancelled' })), { action: 'skip', reason: 'not-completed' });
  assert.deepEqual(recognitionBackfillDecision(legacyOrder({ workerCost: 0, transportationCost: 0 })), { action: 'skip', reason: 'no-fulfillment-cost' });
  assert.deepEqual(
    recognitionBackfillDecision(legacyOrder({ eventDate: '', weddingDate: '', updatedAt: '', createdAt: '' })),
    { action: 'skip', reason: 'no-trustworthy-date' },
    'this is the reason the job counts and logs for manual review',
  );
  assert.equal(recognitionBackfillDecision(undefined).action, 'skip');
  assert.equal(recognitionBackfillDecision(legacyOrder({})).action, 'stamp');
});
