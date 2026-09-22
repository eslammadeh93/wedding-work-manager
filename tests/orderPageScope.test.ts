import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesOrderPageRequest, type OrderPageRequest } from '../src/multiTenant/data/companyDataService';

const archived = { orderStatus: 'completed', paymentStatus: 'fully_paid', archivedAt: '2027-03-01T00:00:00.000Z' };
const live = { orderStatus: 'confirmed', paymentStatus: 'partially_paid' };
const deletedRetained = { orderStatus: 'completed', paymentStatus: 'fully_paid', deletedAt: '2026-09-01T00:00:00.000Z', financiallyRetained: true };
const deletedEmpty = { orderStatus: 'new', paymentStatus: 'unpaid', deletedAt: '2026-09-01T00:00:00.000Z' };

const matches = (data: Record<string, unknown>, request: OrderPageRequest) => matchesOrderPageRequest(data, request);

test('archived orders are included in financial-history queries', () => {
  const financial: OrderPageRequest = { scope: 'financial' };
  assert.equal(matches(archived, financial), true, 'archiving is an operational concern, not an accounting one');
  assert.equal(matches(live, financial), true);
  assert.equal(matches(deletedRetained, financial), true, 'retained financial history stays visible to accounting');
  assert.equal(matches(deletedEmpty, financial), false, 'a deleted order with no financial history stays gone');
});

test('archived orders stay excluded from the normal operational lists', () => {
  for (const scope of ['all', 'active', 'finished'] as const) {
    assert.equal(matches(archived, { scope }), false, `scope ${scope} must not show archived orders`);
    assert.equal(matches(deletedRetained, { scope }), false, `scope ${scope} must not show deleted orders`);
  }
  assert.equal(matches(live, { scope: 'all' }), true);
  assert.equal(matches(live, { scope: 'active' }), true);
  // The dedicated archive screen is unchanged.
  assert.equal(matches(archived, { scope: 'archived' }), true);
  assert.equal(matches(live, { scope: 'archived' }), false);
});

test('the financial scope still honours an explicit payment-status filter', () => {
  assert.equal(matches(archived, { scope: 'financial', paymentStatus: 'fully_paid' }), true);
  assert.equal(matches(archived, { scope: 'financial', paymentStatus: 'unpaid' }), false);
});
