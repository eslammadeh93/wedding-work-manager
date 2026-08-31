import type { ActivityLogRecord } from '../types';

type TimestampLike = {
  toDate?: () => Date;
  seconds?: unknown;
  nanoseconds?: unknown;
};

const toIso = (date: Date): string => Number.isNaN(date.getTime()) ? '' : date.toISOString();

/**
 * Activity-log documents are written by server functions, so Firestore returns
 * their timestamps as Timestamp objects while older records use ISO strings.
 * Convert both forms before a screen searches, filters, or formats them.
 */
export const activityLogTimestamp = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return toIso(value);
  if (typeof value === 'number') return toIso(new Date(value));
  if (value && typeof value === 'object') {
    const timestamp = value as TimestampLike;
    if (typeof timestamp.toDate === 'function') return toIso(timestamp.toDate());
    const seconds = Number(timestamp.seconds);
    const nanoseconds = Number(timestamp.nanoseconds || 0);
    if (Number.isFinite(seconds)) return toIso(new Date(seconds * 1000 + nanoseconds / 1_000_000));
  }
  return '';
};

export const normalizeActivityLogRecord = (record: ActivityLogRecord): ActivityLogRecord => {
  const legacyRecord = record as ActivityLogRecord & { createdAt?: unknown };
  return {
    ...record,
    timestamp: activityLogTimestamp(record.timestamp) || activityLogTimestamp(legacyRecord.createdAt),
  };
};
