import assert from 'node:assert/strict';
import test from 'node:test';
import { orderVersionsMatch } from '../src/multiTenant/data/orderVersion';

test('order version check accepts equivalent legacy Firestore timestamps', () => {
  const expected = { toMillis: () => 1_778_371_200_000 };
  const current = { toMillis: () => 1_778_371_200_000 };

  assert.equal(orderVersionsMatch(expected, current), true);
  assert.equal(orderVersionsMatch('2026-05-10T00:00:00.000Z', current), true);
});

test('order version check still detects a genuine concurrent update', () => {
  assert.equal(orderVersionsMatch('2026-05-10T00:00:00.000Z', '2026-05-10T00:00:01.000Z'), false);
});
