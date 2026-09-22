/**
 * Retention rules shared by the scheduled recycle-bin purge.
 *
 * Operational deletion hides a record; it must never destroy posted financial
 * evidence. An order that took money, or whose fulfillment costs were already
 * recognized, is kept forever even after its recycle-bin window expires. This
 * mirrors `src/utils/financialRetention.ts`; the functions package cannot
 * import from the app sources, so the rules are restated here.
 */
const positive = (value: unknown): number => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

export interface PurgeCandidate {
  totalPaid?: unknown;
  deposit?: unknown;
  paymentHistory?: unknown;
  orderStatus?: unknown;
  fulfillmentRecognizedAt?: unknown;
  financiallyRetained?: unknown;
}

/** True when destroying this document would destroy financial history. */
export const holdsFinancialHistory = (data: PurgeCandidate | undefined): boolean => {
  if (!data) return false;
  if (data.financiallyRetained === true) return true;
  if (positive(data.totalPaid) > 0 || positive(data.deposit) > 0) return true;
  if (Array.isArray(data.paymentHistory) && data.paymentHistory.length > 0) return true;
  return data.orderStatus === 'completed' || Boolean(data.fulfillmentRecognizedAt);
};

/**
 * Splits a batch of expired recycle-bin documents into the ones that may be
 * destroyed and the ones that must be kept as accounting evidence.
 */
export const partitionPurgeCandidates = <T extends { data: PurgeCandidate | undefined }>(
  candidates: readonly T[],
  collectionName: string,
): { destroy: T[]; retain: T[] } => {
  // Only orders carry embedded financial history; customers and inventory do not.
  if (collectionName !== 'orders') return { destroy: [...candidates], retain: [] };
  const destroy: T[] = [];
  const retain: T[] = [];
  for (const candidate of candidates) (holdsFinancialHistory(candidate.data) ? retain : destroy).push(candidate);
  return { destroy, retain };
};

/**
 * One-time recognition backfill for orders that predate `fulfillmentRecognizedAt`.
 *
 * Two groups of legacy records still show the original bug, where moving an
 * order to `returned` hands a closed month its fulfillment costs back:
 *
 *  - orders already sitting at `returned` that were completed before the stamp
 *    existed, and
 *  - orders sitting at `completed` that were completed before the stamp
 *    existed. These look correct today only because the status predicate still
 *    covers them; the moment somebody returns one, the costs disappear.
 *
 * Nothing else is touched. An order that never completed - new, confirmed,
 * cancelled, cancelled with a retained deposit - has nothing to recognize, and
 * an order with no worker or transport cost has no amount to protect, so both
 * are left exactly as they are.
 */
export interface RecognitionBackfillCandidate {
  orderStatus?: unknown;
  workerCost?: unknown;
  transportationCost?: unknown;
  fulfillmentRecognizedAt?: unknown;
  eventDate?: unknown;
  weddingDate?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
}

/** Statuses an order can only have reached by being completed first. */
const RECOGNIZED_STATUSES = new Set(['completed', 'returned']);

const dayString = (value: unknown): string | undefined => {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  return Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? undefined : text;
};

/**
 * The recognition date to stamp, or undefined when no date on the record can
 * be trusted.
 *
 * The execution date is preferred because it is the date the cash and profit
 * calculations already assign these costs to, so the stamp agrees with figures
 * that were already reported. No date is ever invented: a record with nothing
 * usable is skipped and left exactly as it is.
 *
 * The value is stored as a plain `YYYY-MM-DD` day, not an instant. The real
 * completion moment is unknown, and converting a date to an instant would pick
 * a wall-clock time that reads as a different calendar day in some time zones,
 * so the date-only meaning of the source field is preserved as-is.
 * `fulfillmentCostsRecognized` only tests that the field is set, so this is a
 * pure representation choice with no effect on any calculation.
 */
export const legacyRecognitionDate = (data: RecognitionBackfillCandidate): string | undefined =>
  dayString(data.eventDate) ?? dayString(data.weddingDate) ?? dayString(data.updatedAt) ?? dayString(data.createdAt);

export type RecognitionSkipReason = 'already-recognized' | 'not-completed' | 'no-fulfillment-cost' | 'no-trustworthy-date';

export type RecognitionBackfillDecision =
  | { action: 'stamp'; updates: { fulfillmentRecognizedAt: string; fulfillmentRecognizedSource: 'backfill' } }
  | { action: 'skip'; reason: RecognitionSkipReason };

/**
 * Why a record is or is not stamped. The reason is what lets the job report
 * how many records it could not date, so they can be found and reviewed by
 * hand rather than quietly staying broken.
 */
export const recognitionBackfillDecision = (
  data: RecognitionBackfillCandidate | undefined,
): RecognitionBackfillDecision => {
  // Never overwrite a recognition that is already recorded.
  if (!data || data.fulfillmentRecognizedAt) return { action: 'skip', reason: 'already-recognized' };
  if (!RECOGNIZED_STATUSES.has(String(data.orderStatus || ''))) return { action: 'skip', reason: 'not-completed' };
  if (positive(data.workerCost) + positive(data.transportationCost) <= 0) return { action: 'skip', reason: 'no-fulfillment-cost' };
  const recognizedOn = legacyRecognitionDate(data);
  if (!recognizedOn) return { action: 'skip', reason: 'no-trustworthy-date' };
  // `backfill` marks the date as inferred from the execution date rather than
  // observed at completion, so it is never read as a real event time.
  return { action: 'stamp', updates: { fulfillmentRecognizedAt: recognizedOn, fulfillmentRecognizedSource: 'backfill' } };
};

/**
 * The fields to write, or null when the record must not be touched. Returning
 * null for anything already stamped is what makes the backfill idempotent: a
 * second run sees its own output and does nothing.
 */
export const legacyRecognitionBackfill = (
  data: RecognitionBackfillCandidate | undefined,
): { fulfillmentRecognizedAt: string; fulfillmentRecognizedSource: 'backfill' } | null => {
  const decision = recognitionBackfillDecision(data);
  return decision.action === 'stamp' ? decision.updates : null;
};
