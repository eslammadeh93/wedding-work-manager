import assert from 'node:assert/strict';
import test from 'node:test';
import { orderPageResult, orderScanSize, type OrderPageSnapshot } from '../src/multiTenant/data/companyDataService';
import type { OrderPageRequest } from '../src/multiTenant/data/companyDataService';

interface Row { id: string; orderStatus: string; paymentStatus: string; archivedAt?: string; deletedAt?: string; financiallyRetained?: boolean }

const row = (index: number, changes: Partial<Row> = {}): Row => ({
  id: `ord_${String(index).padStart(4, '0')}`,
  orderStatus: 'completed',
  paymentStatus: 'fully_paid',
  ...changes,
});

const snapshot = (record: Row): OrderPageSnapshot => ({ id: record.id, data: () => record as unknown as Record<string, unknown> });

/**
 * Drives the real paging contract over a fixed collection: take a window of
 * `scanSize` starting after the cursor, exactly as Firestore's `startAfter`
 * plus `limit` would, and keep going while `hasMore` says so.
 */
const readAll = (collection: Row[], request: OrderPageRequest, pageSize: number) => {
  const scanSize = orderScanSize(pageSize);
  const seen: string[] = [];
  let cursorId: string | null = null;
  let requests = 0;

  for (let guard = 0; guard < 500; guard += 1) {
    const startIndex = cursorId === null ? 0 : collection.findIndex((item) => item.id === cursorId) + 1;
    const window = collection.slice(startIndex, startIndex + scanSize).map(snapshot);
    const page = orderPageResult<Row & { id: string }>(window, request, pageSize, scanSize);
    requests += 1;
    seen.push(...page.records.map((record) => record.id));
    if (!page.hasMore || !page.cursor) return { seen, requests };
    cursorId = (page.cursor as unknown as OrderPageSnapshot).id;
  }
  throw new Error('pagination did not terminate');
};

const financial: OrderPageRequest = { scope: 'financial' };

test('the scan window is always wider than the page, so a full page is never mistaken for the end', () => {
  for (const pageSize of [10, 50, 99, 100]) {
    assert.ok(orderScanSize(pageSize) > pageSize, `scan window must exceed page size ${pageSize}`);
  }
  // Bounded: a single request never reads an unlimited number of documents.
  assert.ok(orderScanSize(100) <= 250);
});

test('99 financial orders load completely', () => {
  const collection = Array.from({ length: 99 }, (_, index) => row(index));
  const { seen } = readAll(collection, financial, 100);
  assert.equal(seen.length, 99);
  assert.deepEqual(seen, collection.map((item) => item.id));
});

test('exactly 100 financial orders load completely', () => {
  // The old lookahead was min(100, pageSize * 2), so at pageSize 100 the scan
  // window equalled the page and hasMore was false after the first 100.
  const collection = Array.from({ length: 100 }, (_, index) => row(index));
  const { seen } = readAll(collection, financial, 100);
  assert.equal(seen.length, 100);
  assert.deepEqual(seen, collection.map((item) => item.id));
});

test('101 financial orders load completely', () => {
  const collection = Array.from({ length: 101 }, (_, index) => row(index));
  const { seen } = readAll(collection, financial, 100);
  assert.equal(seen.length, 101, 'the 101st order must not be silently dropped');
  assert.equal(seen[100], 'ord_0100');
});

test('more than two pages load completely', () => {
  const collection = Array.from({ length: 457 }, (_, index) => row(index));
  const { seen, requests } = readAll(collection, financial, 100);
  assert.equal(seen.length, 457);
  assert.ok(requests >= 3, 'this really did span multiple pages');
  assert.deepEqual(seen, collection.map((item) => item.id));
});

test('no duplicates and no omissions across cursors', () => {
  const collection = Array.from({ length: 623 }, (_, index) => row(index));
  for (const pageSize of [10, 33, 50, 100]) {
    const { seen } = readAll(collection, financial, pageSize);
    assert.equal(new Set(seen).size, seen.length, `page size ${pageSize} produced duplicates`);
    assert.equal(seen.length, collection.length, `page size ${pageSize} omitted records`);
    assert.deepEqual(seen, collection.map((item) => item.id), `page size ${pageSize} reordered records`);
  }
});

test('filtered pagination skips nothing at the page boundary', () => {
  // Every other record is filtered out locally, which is what used to move the
  // cursor past matching documents that were never returned.
  const collection = Array.from({ length: 400 }, (_, index) => (index % 2 === 0
    ? row(index)
    : row(index, { deletedAt: '2026-09-01T00:00:00.000Z' })));
  const expected = collection.filter((item) => !item.deletedAt).map((item) => item.id);

  for (const pageSize of [10, 50, 100]) {
    const { seen } = readAll(collection, financial, pageSize);
    assert.deepEqual(seen, expected, `page size ${pageSize} lost filtered-boundary records`);
  }
});

test('a page that filters out entirely still reports more to come', () => {
  // A whole window of non-matching documents must not look like the end.
  const collection = [
    ...Array.from({ length: 220 }, (_, index) => row(index, { deletedAt: '2026-09-01T00:00:00.000Z' })),
    row(999),
  ];
  const { seen } = readAll(collection, financial, 100);
  assert.deepEqual(seen, ['ord_0999'], 'the record beyond a fully filtered window must still be reached');
});

test('retained and archived records page correctly in the financial scope only', () => {
  const collection = [
    row(0, { archivedAt: '2027-01-01T00:00:00.000Z' }),
    row(1, { deletedAt: '2026-09-01T00:00:00.000Z', financiallyRetained: true }),
    row(2),
  ];
  assert.deepEqual(readAll(collection, financial, 10).seen, ['ord_0000', 'ord_0001', 'ord_0002']);
  assert.deepEqual(readAll(collection, { scope: 'all' }, 10).seen, ['ord_0002'], 'operational lists are unchanged');
});
