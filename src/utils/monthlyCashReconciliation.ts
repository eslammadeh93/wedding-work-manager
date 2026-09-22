import type { CompanyFinanceEntry, Order } from '../types';
import {
  calculateMonthlyCash,
  expectedOrderProfitContribution,
  isOrderLinkedEntry,
  netOrderCashContribution,
  orderCashCollections,
} from './monthlyCash';
import { completedOrderFulfillmentCosts, recordedOrderPayment } from './orderPayments';

export type ReconciliationIssueKind = 'payment-history' | 'remaining-balance' | 'payment-status' | 'overpaid' | 'invalid-amount';

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
  /** Retained cancellation: recognition follows its lifecycle dates. */
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

export interface MonthlyCashReconciliationIssue {
  id: string;
  kind: ReconciliationIssueKind;
  orderNumber: string;
  customerName: string;
  messageAr: string;
  messageEn: string;
  /**
   * `month` belongs to the selected month's reconciliation; `global` is a
   * stored-data fault that belongs to no month in particular.
   */
  scope: 'month' | 'global';
}

export interface MonthlyCashReconciliation {
  netOrderCash: number;
  expectedProfit: number;
  /** Expected profit minus net order cash. Positive means the forecast is higher. */
  difference: number;
  items: MonthlyCashReconciliationItem[];
  /** Only records financially relevant to the selected month. */
  issues: MonthlyCashReconciliationIssue[];
  /**
   * Data faults that are true of the record whatever month is being viewed:
   * a stored total no payment entry explains, an invalid or negative amount.
   * They are reported separately so they never look like part of this month's
   * difference, and they are never hidden just because another month is open.
   */
  globalIssues: MonthlyCashReconciliationIssue[];
}

const dateKey = (value?: string) => {
  if (!value) return null;
  const matched = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return matched?.[1] || null;
};

const inMonth = (value: string | null, year: number, month: number) =>
  value === null ? false : value.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`);

const positive = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const isNormalOrder = (order: Order) => order.orderStatus !== 'cancelled' && order.orderStatus !== 'cancelled_deposit_retained';

/**
 * Whether a record has anything to do with the selected month, judged by the
 * date that actually governs the issue being reported rather than by the event
 * date alone: money is judged by the day it moved, a margin by the execution
 * date, and a cancellation by the day the lifecycle event happened.
 */
export const monthlyFinancialRelevance = (order: Order, year: number, month: number) => {
  const paymentInMonth = orderCashCollections(order)
    .some((collection) => inMonth(dateKey(collection.date), year, month));
  const eventInMonth = inMonth(dateKey(order.eventDate || order.weddingDate), year, month);
  const lifecycleInMonth = inMonth(dateKey(order.cancelledAt), year, month)
    || (order.cancellationHistory || []).some((event) => inMonth(dateKey(String(event?.at || '')), year, month));
  return { paymentInMonth, eventInMonth, lifecycleInMonth, any: paymentInMonth || eventInMonth || lifecycleInMonth };
};

const monthKeyOf = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}`;

/** The rule that produced this order's pair of figures in this month. */
export const reconciliationReasonFor = (order: Order, year: number, month: number): ReconciliationReason => {
  if (order.deletedAt) return 'deleted-order';
  if (order.orderStatus === 'cancelled_deposit_retained') return 'retained-cancellation';
  if (order.orderStatus === 'cancelled') return 'cancelled-no-retention';

  const eventDate = dateKey(order.eventDate || order.weddingDate);
  if (!eventDate) return 'missing-event-date';
  if (inMonth(eventDate, year, month)) return 'uncollected-this-month';
  return eventDate.slice(0, 7) < monthKeyOf(year, month) ? 'collection-after-event-month' : 'advance-for-future-event';
};

/**
 * Faults that describe the stored record itself rather than anything that
 * happened in a particular month, so they are reported globally.
 */
const GLOBAL_ISSUE_KINDS = new Set<ReconciliationIssueKind>(['payment-history', 'invalid-amount']);

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

  const collected: MonthlyCashReconciliationIssue[] = [];
  orders.forEach((order) => {
    const relevance = monthlyFinancialRelevance(order, year, month);
    // A record-level fault is always reported; anything else has to belong to
    // the month being reconciled, or it is another month's business.
    const push = (issue: Omit<MonthlyCashReconciliationIssue, 'scope'>) => {
      const scope = GLOBAL_ISSUE_KINDS.has(issue.kind) ? 'global' as const : 'month' as const;
      if (scope === 'month' && !relevance.any) return;
      collected.push({ ...issue, scope });
    };
    const historyTotal = (order.paymentHistory || []).reduce((sum, payment) => sum + positive(payment.amount), 0);
    const paid = recordedOrderPayment(order);
    const expectedRemaining = Math.max(0, positive(order.totalPrice) - paid);
    const storedRemaining = Number(order.remainingBalance);
    const label = `${order.orderNumber} — ${order.customerName}`;

    if (historyTotal > 0 && Math.abs(historyTotal - paid) > 0.01) {
      push({ id: `${order.id}-payment-history`, kind: 'payment-history', orderNumber: order.orderNumber, customerName: order.customerName,
        messageAr: `${label}: مجموع سجل الدفعات ${historyTotal.toLocaleString('en-US')} لا يطابق إجمالي المدفوع ${paid.toLocaleString('en-US')}.`,
        messageEn: `${label}: payment history (${historyTotal}) does not match total paid (${paid}).` });
    }
    if (Number.isFinite(storedRemaining) && Math.abs(storedRemaining - expectedRemaining) > 0.01) {
      push({ id: `${order.id}-remaining-balance`, kind: 'remaining-balance', orderNumber: order.orderNumber, customerName: order.customerName,
        messageAr: `${label}: الرصيد المسجّل ${storedRemaining.toLocaleString('en-US')} بينما الرصيد المحسوب ${expectedRemaining.toLocaleString('en-US')}.`,
        messageEn: `${label}: stored remaining balance (${storedRemaining}) differs from calculated balance (${expectedRemaining}).` });
    }
    if (order.paymentStatus === 'fully_paid' && expectedRemaining > 0.01) {
      push({ id: `${order.id}-payment-status`, kind: 'payment-status', orderNumber: order.orderNumber, customerName: order.customerName,
        messageAr: `${label}: الحالة مكتوبة «مدفوع بالكامل» لكن المتبقي الفعلي ${expectedRemaining.toLocaleString('en-US')}. الحل: إن كان المبلغ تم تحصيله، أضف دفعة سداد بقيمة ${expectedRemaining.toLocaleString('en-US')}. وإن لم يُحصّل، غيّر الحالة إلى «مدفوع جزئيًا».`,
        messageEn: `${label}: marked fully paid but ${expectedRemaining} remains. Record a settlement payment if collected; otherwise change it to partially paid.` });
    }
    if (order.paymentStatus !== 'fully_paid' && positive(order.totalPrice) > 0 && expectedRemaining <= 0.01) {
      push({ id: `${order.id}-payment-status`, kind: 'payment-status', orderNumber: order.orderNumber, customerName: order.customerName,
        messageAr: `${label}: كل سعر الأوردر مسجّل كمحصّل، لكن حالة الدفع ليست «مدفوع بالكامل». راجع حالة الدفع واحفظ الأوردر لتحديثها.`,
        messageEn: `${label}: the full order price is recorded as paid, but the payment status is not fully paid. Review and save the order to update it.` });
    }
    if (paid > positive(order.totalPrice) + 0.01) {
      push({ id: `${order.id}-overpaid`, kind: 'overpaid', orderNumber: order.orderNumber, customerName: order.customerName,
        messageAr: `${label}: إجمالي المدفوع أكبر من سعر الأوردر.`, messageEn: `${label}: total paid is greater than the order price.` });
    }
    if ([order.totalPrice, order.totalPaid, order.remainingBalance, order.otherExpenses, order.workerCost, order.transportationCost]
      .some(value => value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0))) {
      push({ id: `${order.id}-invalid-amount`, kind: 'invalid-amount', orderNumber: order.orderNumber, customerName: order.customerName,
        messageAr: `${label}: يوجد مبلغ غير صالح أو سالب في بيانات الأوردر.`, messageEn: `${label}: an order amount is invalid or negative.` });
    }
  });

  const issues = collected.filter((issue) => issue.scope === 'month');
  const globalIssues = collected.filter((issue) => issue.scope === 'global');

  const items = [...records.values()]
    .filter(item => Math.abs(item.difference) > 0.01)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  return {
    netOrderCash: summary.netOrderCash,
    expectedProfit: summary.expectedOrderProfit,
    difference: summary.expectedOrderProfit - summary.netOrderCash,
    items,
    issues,
    globalIssues,
  };
};
