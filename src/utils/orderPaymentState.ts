import type { Order, PaymentEntry, PaymentStatus } from '../types';

/**
 * The single canonical payment calculation for order writes.
 *
 * Three fields used to disagree: `deposit`, `totalPaid` and `paymentHistory`.
 * Every write now derives `totalPaid` here, from the record as it is stored
 * right now plus the change the caller actually intends.
 *
 * Legacy records are the reason this is not simply "sum the history".  Orders
 * created before payment history existed carry a `totalPaid` that no history
 * entry explains.  That difference is preserved as an opaque legacy remainder
 * so an ordinary edit can never silently erase money that was really
 * collected.  It is reconciled only when someone explicitly edits the
 * payments themselves.
 */

export type StoredPaymentRecord = Pick<Order, 'deposit' | 'totalPaid' | 'paymentHistory'> & Partial<Pick<Order, 'totalPrice'>>;

export interface OrderPaymentIntent {
  /** Provided only when the user actually edited the deposit field. */
  deposit?: number;
  totalPrice?: number;
  /** Provided only by a deliberate payment mutation, never by an ordinary edit. */
  paymentHistory?: PaymentEntry[];
}

export interface ResolvedOrderPaymentState {
  /** Present only when the payment entries themselves changed. */
  paymentHistory?: PaymentEntry[];
  totalPaid: number;
  remainingBalance: number;
  paymentStatus: PaymentStatus;
}

/** The order's financial position, including the two amounts that are not contract value. */
export interface OrderFinancialPosition {
  totalPaid: number;
  remainingBalance: number;
  paymentStatus: PaymentStatus;
  /** Paid beyond the agreed price, and owed back to the customer. */
  customerCredit: number;
}

const positiveAmount = (value: unknown): number => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const finiteOrZero = (value: unknown): number => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

/** Rounds to whole cents so repeated corrections cannot drift. */
const money = (value: number): number => Math.round(value * 100) / 100;

/**
 * Refunds are stored with a positive amount and a `refund` type, so the money
 * that went back out subtracts here rather than being edited into the original
 * receipt. The net can never go below zero.
 */
export const isRefundEntry = (entry: Pick<PaymentEntry, 'type'>): boolean => entry.type === 'refund';

/**
 * A legacy security movement. `Order.securityDeposit` is informational only
 * and a security entry is not a financial movement, so these entries are
 * excluded from every calculation in the app. They are still recognised here
 * so old records keep their history and their backups while contributing
 * nothing to any figure.
 */
export const isSecurityEntry = (entry: Pick<PaymentEntry, 'type'>): boolean =>
  entry.type === 'security_deposit' || entry.type === 'security_refund';

export const paymentHistoryTotal = (history: readonly PaymentEntry[] | undefined): number =>
  money(Math.max(0, (history || []).reduce(
    (sum, entry) => {
      if (isSecurityEntry(entry)) return sum;
      return sum + (isRefundEntry(entry) ? -positiveAmount(entry.amount) : positiveAmount(entry.amount));
    },
    0,
  )));

/**
 * Money the customer has paid beyond the agreed price, and is therefore owed
 * back. It is real cash in the business, but it is not contract value, so it
 * is reported separately rather than inflating the order or being clamped
 * away as if it had never arrived.
 */
export const customerCreditOf = (totalPaid: number, totalPrice: number): number =>
  money(Math.max(0, finiteOrZero(totalPaid) - Math.max(0, finiteOrZero(totalPrice))));

const isDepositEntry = (entry: PaymentEntry, index: number): boolean => {
  if (entry.type === 'deposit') return true;
  if (entry.type === 'settlement' || entry.type === 'refund' || isSecurityEntry(entry)) return false;
  // Records written before `type` existed labelled the booking payment in notes.
  return index === 0 && /initial|deposit|عربون|مقدم/i.test(entry.notes || '');
};

export const depositEntryIndex = (history: readonly PaymentEntry[] | undefined): number =>
  (history || []).findIndex((entry, index) => isDepositEntry(entry, index));

/** Never below what the payment entries prove was collected. */
export const canonicalRecordedPaid = (record: StoredPaymentRecord): number => {
  const history = record.paymentHistory || [];
  const historyTotal = paymentHistoryTotal(history);
  const storedPaid = finiteOrZero(record.totalPaid);
  const deposit = positiveAmount(record.deposit);
  // The `deposit` field is a fallback for records whose history never captured
  // the booking payment. Once the history does account for the deposit - or
  // once money has been refunded - the history is authoritative, otherwise a
  // fully refunded order would have its original deposit resurrected here.
  const historyAccountsForDeposit = depositEntryIndex(history) >= 0 || history.some(isRefundEntry);
  const claimed = storedPaid > 0 ? storedPaid : historyAccountsForDeposit ? historyTotal : Math.max(deposit, historyTotal);
  return money(Math.max(claimed, historyTotal));
};

/**
 * Money the stored total claims but no payment entry itemises. For a record
 * with complete history this is zero; for a record written before payment
 * history existed it is everything that was ever collected, including the
 * booking deposit. It is carried through every write untouched, so no
 * correction can quietly drop collected money that predates the history.
 */
export const unexplainedLegacyPaid = (record: StoredPaymentRecord): number =>
  Math.max(0, money(canonicalRecordedPaid(record) - paymentHistoryTotal(record.paymentHistory)));

export const paymentStatusFor = (totalPaid: number, totalPrice: number): PaymentStatus =>
  totalPaid >= totalPrice && totalPrice > 0 ? 'fully_paid' : totalPaid > 0 ? 'partially_paid' : 'unpaid';

const depositAdjustedHistory = (
  history: readonly PaymentEntry[],
  nextDeposit: number,
): PaymentEntry[] | undefined => {
  const index = depositEntryIndex(history);
  if (index < 0) return undefined;
  // A zero deposit must not leave a fake zero-value collection behind.
  if (nextDeposit <= 0) return history.filter((_, position) => position !== index);
  return history.map((entry, position) => (position === index ? { ...entry, amount: money(nextDeposit), type: 'deposit' as const } : entry));
};

/**
 * Resolves the financial fields for a write against the record as stored.
 *
 * - A payment mutation (`paymentHistory` given) is authoritative for the
 *   entries and recomputes the total from them plus the legacy remainder.
 * - A deposit correction rewrites the matching deposit entry when one exists,
 *   and otherwise moves the total by the corrected difference without
 *   inventing a collection whose date nobody knows.
 * - Any other edit leaves the entries untouched and can never reduce the
 *   previously recorded paid amount.
 */
export const resolveOrderPaymentState = (
  current: StoredPaymentRecord,
  intent: OrderPaymentIntent,
): ResolvedOrderPaymentState => {
  const storedHistory = current.paymentHistory || [];
  const priorPaid = canonicalRecordedPaid(current);
  const legacyRemainder = unexplainedLegacyPaid(current);
  const totalPrice = Math.max(0, finiteOrZero(intent.totalPrice ?? current.totalPrice));

  const finalize = (totalPaid: number, paymentHistory?: PaymentEntry[]): ResolvedOrderPaymentState => {
    const safePaid = money(Math.max(0, totalPaid));
    return {
      ...(paymentHistory ? { paymentHistory } : {}),
      totalPaid: safePaid,
      remainingBalance: money(Math.max(0, totalPrice - safePaid)),
      paymentStatus: paymentStatusFor(safePaid, totalPrice),
    };
  };

  if (intent.paymentHistory) {
    const nextHistory = intent.paymentHistory;
    return finalize(money(paymentHistoryTotal(nextHistory) + legacyRemainder), nextHistory);
  }

  const nextDeposit = intent.deposit;
  if (typeof nextDeposit === 'number' && Number.isFinite(nextDeposit) && money(nextDeposit) !== money(finiteOrZero(current.deposit))) {
    const adjusted = depositAdjustedHistory(storedHistory, nextDeposit);
    if (adjusted) return finalize(money(paymentHistoryTotal(adjusted) + legacyRemainder), adjusted);
    // No deposit entry to correct: shift the total by the correction itself.
    const difference = money(nextDeposit - finiteOrZero(current.deposit));
    const historyTotal = paymentHistoryTotal(storedHistory);
    return finalize(Math.max(historyTotal, money(priorPaid + difference)));
  }

  return finalize(priorPaid);
};

/**
 * Everything a screen needs to describe where an order stands financially.
 * Only contract money appears here; the informational security amount is not
 * part of any of it.
 */
export const orderFinancialPosition = (record: StoredPaymentRecord): OrderFinancialPosition => {
  const totalPaid = canonicalRecordedPaid(record);
  const totalPrice = Math.max(0, finiteOrZero(record.totalPrice));
  return {
    totalPaid,
    remainingBalance: money(Math.max(0, totalPrice - totalPaid)),
    paymentStatus: paymentStatusFor(totalPaid, totalPrice),
    customerCredit: customerCreditOf(totalPaid, totalPrice),
  };
};

/** Idempotent append used by the transactional payment mutator. */
export const appendPaymentEntry = (history: readonly PaymentEntry[] | undefined, payment: PaymentEntry): PaymentEntry[] | null => {
  const entries = history || [];
  if (entries.some((entry) => entry.id === payment.id)) return null;
  return [...entries, payment];
};

/** The fields a correction may change. Method and type are deliberately fixed. */
export interface PaymentEntryCorrection {
  amount?: number;
  date?: string;
}

/**
 * Corrects one stored entry, identified by its id.
 *
 * It is a reducer over the history as it is stored *right now*, so the caller
 * never submits a snapshot taken when the screen was opened: entries recorded
 * in the meantime are carried through untouched, and only the named one
 * changes. An unknown id, or a correction that changes nothing, returns null
 * so the transaction writes nothing and no version is bumped.
 */
export const editPaymentEntry = (
  history: readonly PaymentEntry[] | undefined,
  id: string,
  correction: PaymentEntryCorrection,
): PaymentEntry[] | null => {
  const entries = history || [];
  const existing = entries.find((entry) => entry.id === id);
  if (!existing) return null;

  const nextAmount = correction.amount === undefined ? existing.amount : money(finiteOrZero(correction.amount));
  const nextDate = correction.date === undefined ? existing.date : correction.date;
  if (nextAmount <= 0) throw new Error('قيمة الدفعة يجب أن تكون أكبر من صفر.');
  if (!nextDate) throw new Error('تاريخ الدفعة مطلوب.');
  if (nextAmount === existing.amount && nextDate === existing.date) return null;

  return entries.map((entry) => (entry.id === id ? { ...entry, amount: nextAmount, date: nextDate } : entry));
};

/**
 * Removes one stored entry by id, leaving every other entry exactly as it is.
 * An id that is no longer there - already deleted by someone else - returns
 * null rather than rewriting the history to the same thing.
 */
export const removePaymentEntry = (
  history: readonly PaymentEntry[] | undefined,
  id: string,
): PaymentEntry[] | null => {
  const entries = history || [];
  if (!entries.some((entry) => entry.id === id)) return null;
  return entries.filter((entry) => entry.id !== id);
};
