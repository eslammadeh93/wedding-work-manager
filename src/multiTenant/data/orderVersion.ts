/**
 * Firestore returns a fresh Timestamp object for every document read.  Order
 * records written before the ISO-string convention may therefore carry a
 * Timestamp while newer records carry a string.  Compare the instant, not the
 * object identity, when checking optimistic-concurrency versions.
 */
const timestampMillis = (value: unknown): number | undefined => {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isNaN(milliseconds) ? undefined : milliseconds;
  }

  if (typeof value === 'string') {
    const milliseconds = Date.parse(value);
    return Number.isNaN(milliseconds) ? undefined : milliseconds;
  }

  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    const milliseconds = value.toMillis();
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  }

  return undefined;
};

export const orderVersionsMatch = (expected: unknown, current: unknown): boolean => {
  if (expected === current) return true;
  const expectedMillis = timestampMillis(expected);
  const currentMillis = timestampMillis(current);
  return expectedMillis !== undefined && currentMillis !== undefined && expectedMillis === currentMillis;
};
