/**
 * Platform-owner order corrections.
 *
 * The correction is a financial write on a tenant's order, so it may not be a
 * read-then-write: another user can record a payment between the two halves.
 * The pure helpers below decide the resulting financial state; the caller runs
 * them inside a Firestore transaction together with the audit entry, so the
 * change and the evidence for it commit or fail as one.
 */

export interface PlatformOrderCorrectionInput {
  totalPrice: number;
  deposit: number;
  /** Optional deliberate adjustment. It is recorded, never silently absorbed. */
  paymentAdjustment?: number;
  adjustmentReason?: string;
}

export interface StoredPlatformOrder {
  totalPrice?: unknown;
  deposit?: unknown;
  totalPaid?: unknown;
  paymentHistory?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
}

export interface PlatformPaymentAdjustment {
  id: string;
  amount: number;
  date: string;
  method: string;
  type: 'adjustment';
  notes: string;
  recordedByPlatformOwner: string;
}

export class PlatformCorrectionError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = 'PlatformCorrectionError';
  }
}

/** Rounds to whole cents so repeated corrections cannot drift. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

export const platformAmount = (value: unknown): number => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

export const platformHistoryTotal = (history: unknown): number => {
  if (!Array.isArray(history)) return 0;
  return round2(history.reduce((sum: number, entry: unknown) => sum + platformAmount((entry as Record<string, unknown>)?.amount), 0));
};

/** The version a caller must echo back, taken from the document it read. */
export const platformOrderVersion = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const stamp = value as { toMillis?: () => number };
    if (typeof stamp.toMillis === 'function') return new Date(stamp.toMillis()).toISOString();
  }
  return '';
};

export const platformVersionsMatch = (expected: string, current: unknown): boolean => {
  const currentVersion = platformOrderVersion(current);
  if (!currentVersion) return false;
  if (expected === currentVersion) return true;
  const expectedMillis = Date.parse(expected);
  const currentMillis = Date.parse(currentVersion);
  return Number.isFinite(expectedMillis) && Number.isFinite(currentMillis) && expectedMillis === currentMillis;
};

export interface ResolvedPlatformCorrection {
  totalPaid: number;
  remainingBalance: number;
  paymentStatus: 'unpaid' | 'partially_paid' | 'fully_paid';
  /** Present only when the payment entries themselves changed. */
  paymentHistory?: unknown[];
  adjustment?: PlatformPaymentAdjustment;
}

/**
 * Deposit-entry handling, mirroring `resolveOrderPaymentState` in
 * `src/utils/orderPaymentState.ts`. The functions package cannot import from
 * the app sources, so the rules are restated here and must stay in step.
 */
const isDepositEntry = (entry: Record<string, unknown>, index: number): boolean => {
  if (entry?.type === 'deposit') return true;
  if (entry?.type === 'settlement' || entry?.type === 'adjustment') return false;
  // Entries written before `type` existed labelled the booking payment in notes.
  return index === 0 && /initial|deposit|\u0639\u0631\u0628\u0648\u0646|\u0645\u0642\u062f\u0645/i.test(String(entry?.notes || ''));
};

export const platformDepositEntryIndex = (history: readonly unknown[]): number =>
  history.findIndex((entry, index) => isDepositEntry(entry as Record<string, unknown>, index));

/**
 * Resolves the financial result of a correction against the order as stored.
 *
 * `totalPaid` is never accepted directly: it is derived from the recorded
 * payments plus the unexplained legacy remainder, and any deliberate change to
 * the collected amount must arrive as `paymentAdjustment`, which is written
 * into the payment history so the total always has a record behind it.
 *
 * A corrected `deposit` rewrites the matching deposit entry in place, exactly
 * as the company-side resolver does, so the deposit field and the payment
 * history can never drift apart. Where no deposit entry exists the total
 * shifts by the correction itself rather than inventing a collection whose
 * date nobody knows.
 */
export const resolvePlatformOrderCorrection = (
  current: StoredPlatformOrder,
  input: PlatformOrderCorrectionInput,
  actorUid: string,
  now: Date,
): ResolvedPlatformCorrection => {
  const storedHistory = Array.isArray(current.paymentHistory) ? [...current.paymentHistory] : [];
  const historyTotal = platformHistoryTotal(storedHistory);
  const storedPaid = Number.isFinite(Number(current.totalPaid)) ? Math.max(0, Number(current.totalPaid)) : 0;
  // Never below what the recorded payments prove was collected.
  const priorPaid = Math.max(storedPaid, historyTotal);
  // Money the stored total claims but no entry explains stays untouched until
  // somebody reconciles it deliberately.
  const legacyRemainder = Math.max(0, round2(priorPaid - historyTotal));

  let history = storedHistory;
  let entriesChanged = false;
  // Carries a deposit correction on a record that has no deposit entry to edit.
  let depositShift = 0;
  const nextDeposit = round2(Number(input.deposit));
  const priorDeposit = round2(Number(current.deposit) || 0);
  if (Number.isFinite(nextDeposit) && nextDeposit !== priorDeposit) {
    const index = platformDepositEntryIndex(history);
    if (index < 0) {
      depositShift = round2(nextDeposit - priorDeposit);
    } else if (nextDeposit <= 0) {
      // A cleared deposit must not leave a zero-value fake collection behind.
      history = history.filter((_, position) => position !== index);
      entriesChanged = true;
    } else {
      // The existing entry is corrected in place, never duplicated.
      history = history.map((entry, position) => (position === index
        ? { ...(entry as Record<string, unknown>), amount: nextDeposit, type: 'deposit' }
        : entry));
      entriesChanged = true;
    }
  }

  const adjustmentAmount = Number(input.paymentAdjustment || 0);
  let adjustment: PlatformPaymentAdjustment | undefined;
  if (adjustmentAmount !== 0) {
    // Whole pounds only, and refused rather than rounded.
    if (!Number.isInteger(adjustmentAmount)) throw new PlatformCorrectionError('INVALID_ADJUSTMENT', 'قيمة التسوية يجب أن تكون بالجنيه الصحيح بدون كسور.');
    const reason = String(input.adjustmentReason || '').trim().slice(0, 500);
    if (!reason) throw new PlatformCorrectionError('ADJUSTMENT_REASON_REQUIRED', 'يجب إدخال سبب تسوية المبالغ المحصلة.');
    adjustment = {
      id: `pay_platform_${now.getTime()}`,
      amount: adjustmentAmount,
      date: now.toISOString().slice(0, 10),
      method: 'platform_adjustment',
      type: 'adjustment',
      notes: reason,
      recordedByPlatformOwner: actorUid,
    };
    history = [...history, adjustment];
    entriesChanged = true;
  }

  const nextHistoryTotal = platformHistoryTotal(history);
  // A downward correction can never take the total below the payments that
  // are still recorded.
  const totalPaid = Math.max(0, nextHistoryTotal, round2(nextHistoryTotal + legacyRemainder + depositShift));
  const totalPrice = Math.max(0, Number(input.totalPrice) || 0);

  return {
    totalPaid,
    remainingBalance: round2(Math.max(0, totalPrice - totalPaid)),
    paymentStatus: totalPaid >= totalPrice && totalPrice > 0 ? 'fully_paid' : totalPaid > 0 ? 'partially_paid' : 'unpaid',
    ...(entriesChanged ? { paymentHistory: history } : {}),
    ...(adjustment ? { adjustment } : {}),
  };
};
