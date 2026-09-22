import type { CompanyFinanceEntry, Order } from '../types';
import {
  calculateMonthlyCash,
  expectedOrderProfitContribution,
  isOrderLinkedEntry,
  isRetainedCancellation,
  netOrderCashContribution,
} from './monthlyCash';

/**
 * Why an order's forecast and its cash disagree in this month.
 *
 * Cash and margin answer different questions, so most of these are ordinary
 * and expected rather than faults: money can arrive in a month that is owed no
 * margin, and a month's margin can be earned before its money arrives.
 */
export type ReconciliationReason =
  /** Soft-deleted: the cash it really took is kept, the work will not happen. */
  | 'deleted-order'
  /** Cancelled outright: nothing is retained as profit. */
  | 'cancelled-no-retention'
  /** Retained cancellation: the kept money is profit in the month it arrived. */
  | 'retained-cancellation'
  /** Executed in an earlier month; its margin was recognized there, not here. */
  | 'collection-after-event-month'
  /** No event or wedding date at all, so no month can claim its margin. */
  | 'missing-event-date'
  /** Executed later: only this month's advance counts, capped at the price. */
  | 'advance-for-future-event'
  /** Executed this month: the whole margin counts, however little has arrived. */
  | 'uncollected-this-month'
  | 'other';

export interface MonthlyCashReconciliationItem {
  orderId: string;
  orderNumber: string;
  customerName: string;
  expectedContribution: number;
  cashContribution: number;
  difference: number;
  /** Which rule produced this order's two figures. */
  reason: ReconciliationReason;
}

export interface MonthlyCashReconciliation {
  netOrderCash: number;
  expectedProfit: number;
  /** Expected profit minus net order cash. Positive means the forecast is higher. */
  difference: number;
  items: MonthlyCashReconciliationItem[];
}

const dateKey = (value?: string) => {
  if (!value) return null;
  const matched = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return matched?.[1] || null;
};

const inMonth = (value: string | null, year: number, month: number) =>
  value === null ? false : value.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`);

const monthKeyOf = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}`;

/** The rule that produced this order's pair of figures in this month. */
export const reconciliationReasonFor = (order: Order, year: number, month: number): ReconciliationReason => {
  if (order.deletedAt) return 'deleted-order';
  // Judged before any execution-date question: a retained cancellation is
  // never explained by a missing or past event date.
  if (isRetainedCancellation(order)) return 'retained-cancellation';
  if (order.orderStatus === 'cancelled') return 'cancelled-no-retention';

  const eventDate = dateKey(order.eventDate || order.weddingDate);
  if (!eventDate) return 'missing-event-date';
  if (inMonth(eventDate, year, month)) return 'uncollected-this-month';
  return eventDate.slice(0, 7) < monthKeyOf(year, month) ? 'collection-after-event-month' : 'advance-for-future-event';
};

/**
 * Rebuilds both headline figures with the same rules as the monthly cash
 * report, then attributes their difference to individual orders.
 */
export const reconcileMonthlyCash = (
  orders: Order[],
  expenses: CompanyFinanceEntry[],
  year: number,
  month: number,
): MonthlyCashReconciliation => {
  const summary = calculateMonthlyCash(orders, expenses, year, month);
  const records = new Map<string, MonthlyCashReconciliationItem>();
  const getRecord = (order: Order) => {
    const existing = records.get(order.id);
    if (existing) return existing;
    const record: MonthlyCashReconciliationItem = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      expectedContribution: 0,
      cashContribution: 0,
      difference: 0,
      reason: reconciliationReasonFor(order, year, month),
    };
    records.set(order.id, record);
    return record;
  };

  // Both sides come from the one definition of each metric, so this really
  // reconciles the two published figures instead of re-deriving them and
  // drifting from them.
  const orderLinkedEntries = expenses.filter(isOrderLinkedEntry);
  orders.forEach((order) => {
    const record = getRecord(order);
    record.expectedContribution += expectedOrderProfitContribution(order, year, month);
    record.cashContribution += netOrderCashContribution(order, orderLinkedEntries, year, month);
    record.difference = record.expectedContribution - record.cashContribution;
  });

  const items = [...records.values()]
    .filter(item => Math.abs(item.difference) > 0.01)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  return {
    netOrderCash: summary.netOrderCash,
    expectedProfit: summary.expectedOrderProfit,
    difference: summary.expectedOrderProfit - summary.netOrderCash,
    items,
  };
};
