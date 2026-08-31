import assert from 'node:assert/strict';
import test from 'node:test';
import { activityLogTimestamp, normalizeActivityLogRecord } from '../src/utils/activityLogTimestamp';
import type { ActivityLogRecord } from '../src/types';

test('normalizes Firestore-style and legacy activity-log timestamps before rendering', () => {
  assert.equal(activityLogTimestamp('2026-08-31T10:00:00.000Z'), '2026-08-31T10:00:00.000Z');
  assert.equal(activityLogTimestamp({ seconds: 1_788_170_400, nanoseconds: 0 }), '2026-08-31T10:00:00.000Z');
  assert.equal(activityLogTimestamp({ toDate: () => new Date('2026-08-31T10:00:00.000Z') }), '2026-08-31T10:00:00.000Z');
});

test('uses createdAt as a safe fallback for legacy activity records', () => {
  const record = { id: 'log-1', orderId: 'order-1', orderNumber: 'ORD-1', workerId: '', workerName: '', action: 'opened', customerName: '', eventDate: '', timestamp: undefined, createdAt: { seconds: 1_788_170_400 } } as unknown as ActivityLogRecord;
  assert.equal(normalizeActivityLogRecord(record).timestamp, '2026-08-31T10:00:00.000Z');
});
