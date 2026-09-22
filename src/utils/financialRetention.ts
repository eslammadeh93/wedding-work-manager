import type { CancellationEvent, CompanyFinanceEntry, Order, PaymentEntry } from '../types';
import { paymentHistoryTotal } from './orderPaymentState';
import { fulfillmentCostsRecognized, recordedOrderPayment } from './orderPayments';

/**
 * Operational deletion and accounting retention are two different things.
 *
 * A user deleting an order means "take it off my screens". It cannot mean
 * "erase the money that was collected for it", because that silently rewrites
 * periods that were already reported and, once the recycle bin purges, the
 * evidence is gone for good. Records that carry posted financial history are
 * therefore marked as retained when they are deleted: they disappear from
 * operational lists exactly as before, stay in accounting datasets, and the
 * purge job skips them.
 */

/** An order carries posted financial history once money or costs were recognized. */
export const isFinanciallyActiveOrder = (order: Order): boolean => {
  if (recordedOrderPayment(order) > 0) return true;
  if (paymentHistoryTotal(order.paymentHistory) > 0) return true;
  if ((order.paymentHistory || []).length > 0) return true;
  return fulfillmentCostsRecognized(order);
};

/** Retention flag merged into the deletion patch for a financially active order. */
export const orderRetentionMetadata = (order: Order): { financiallyRetained: true } | Record<string, never> =>
  (isFinanciallyActiveOrder(order) ? { financiallyRetained: true } : {});

export const isRetainedOrder = (order: Pick<Order, 'financiallyRetained'>): boolean => order.financiallyRetained === true;

/**
 * The dataset accounting must read: everything operational, plus deleted
 * records that were retained because they carry posted financial history.
 * Deleted records without any financial history stay out, so an ordinary
 * mistaken entry still disappears completely.
 */
export const financialHistoryOrders = (operational: Order[], deleted: Order[]): Order[] => {
  const byId = new Map(operational.map((order) => [order.id, order]));
  for (const order of deleted) {
    if (!byId.has(order.id) && (isRetainedOrder(order) || isFinanciallyActiveOrder(order))) byId.set(order.id, order);
  }
  return [...byId.values()];
};

/** A purge may never destroy an order that still carries financial evidence. */
export const purgeWouldDestroyFinancialHistory = (order: Pick<Order, 'financiallyRetained' | 'totalPaid' | 'deposit' | 'paymentHistory' | 'orderStatus'> & { fulfillmentRecognizedAt?: string | null }): boolean =>
  order.financiallyRetained === true || isFinanciallyActiveOrder(order as Order);

/**
 * Voiding an expense keeps the original entry and cancels it with a separate
 * dated reversal, so the month the expense was booked in never changes and the
 * void is visible in the month it actually happened.
 */
export const expenseReversalEntry = (
  expense: CompanyFinanceEntry,
  reversalId: string,
  now = new Date(),
): CompanyFinanceEntry => ({
  id: reversalId,
  type: expense.type,
  category: expense.category,
  amount: expense.amount,
  date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  notes: `إلغاء قيد: ${expense.notes || expense.description || expense.category}`,
  description: `Reversal of ${expense.id}`,
  reversalOfId: expense.id,
  isReversal: true,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});

/** Marks the original entry as voided without removing it. */
export const expenseVoidMetadata = (reversalId: string, now = new Date()) => ({
  voidedAt: now.toISOString(),
  reversedByEntryId: reversalId,
  updatedAt: now.toISOString(),
});

const CANCELLED_STATUSES: readonly string[] = ['cancelled', 'cancelled_deposit_retained'];

/**
 * What a write should record about cancellation.
 *
 * Events are appended, never replaced, so the sequence a booking actually went
 * through survives. A single overwritten date would move profit recognized
 * under an earlier cancellation into a later month and rewrite a month that
 * had already been reported.
 *
 * Two writes record nothing at all:
 *
 *  - an edit that leaves the status alone, or re-saves the same status, which
 *    the order form does on every save;
 *  - anything touching an order that is *already* cancelled in storage but has
 *    no date, because it was cancelled before this existed. Stamping now would
 *    claim it happened today. It stays missing and honest, and
 *    `retainedCancellationsMissingDate` reports it.
 */
export const cancellationMetadata = (
  current: Pick<Order, 'cancelledAt' | 'orderStatus' | 'cancellationHistory'>,
  nextStatus: Order['orderStatus'] | undefined,
  now = new Date(),
): Partial<Pick<Order, 'cancelledAt' | 'cancellationHistory'>> => {
  if (nextStatus === undefined) return {};
  const wasCancelled = CANCELLED_STATUSES.includes(current.orderStatus);
  const willBeCancelled = CANCELLED_STATUSES.includes(nextStatus);
  const history = current.cancellationHistory || [];
  const append = (kind: CancellationEvent['kind']) => [...history, { kind, at: now.toISOString() }];

  if (willBeCancelled) {
    if (wasCancelled) {
      // Re-saving the same status, which the order form does on every save,
      // decides nothing and must not leave a duplicate event behind.
      if (nextStatus === current.orderStatus) return {};
      // Moving between the two cancelled states is a real decision about
      // whether the deposit is kept, so it is dated like any other. The
      // booking's own cancellation date is not touched: the cancellation did
      // not happen again, only the decision about the money changed - and for
      // a record cancelled before any of this existed, writing one would claim
      // it was cancelled today.
      return { cancellationHistory: append(nextStatus as CancellationEvent['kind']) };
    }
    return { cancelledAt: now.toISOString(), cancellationHistory: append(nextStatus as CancellationEvent['kind']) };
  }
  if (!wasCancelled) return {};
  // Reinstated: recorded as its own event so the recognition it undoes is
  // reversed in this month rather than erased from the month it was made in.
  return { cancelledAt: null, cancellationHistory: append('reinstated') };
};

/** A refund is recorded as its own dated movement against the order. */
export const refundPaymentEntry = (
  id: string,
  amount: number,
  date: string,
  method: string,
  reason: string,
): PaymentEntry => ({
  id,
  amount,
  date,
  method,
  type: 'refund',
  notes: reason,
});
