import type { CompanyFinanceEntry, Order } from '../types';
import { calculateMonthlyCash, orderCashCollections } from './monthlyCash';
import { completedOrderFulfillmentCosts, recordedOrderPayment } from './orderPayments';

export type ReconciliationIssueKind = 'payment-history' | 'remaining-balance' | 'payment-status' | 'overpaid' | 'invalid-amount';

export interface MonthlyCashReconciliationItem {
  orderId: string;
  orderNumber: string;
  customerName: string;
  expectedContribution: number;
  cashContribution: number;
  difference: number;
}

export interface MonthlyCashReconciliationIssue {
  id: string;
  kind: ReconciliationIssueKind;
  orderNumber: string;
  customerName: string;
  messageAr: string;
  messageEn: string;
}

export interface MonthlyCashReconciliation {
  netOrderCash: number;
  expectedProfit: number;
  /** Expected profit minus net order cash. Positive means the forecast is higher. */
  difference: number;
  items: MonthlyCashReconciliationItem[];
  issues: MonthlyCashReconciliationIssue[];
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
    };
    records.set(order.id, record);
    return record;
  };

  orders.forEach((order) => {
    const record = getRecord(order);
    const executionDate = dateKey(order.eventDate || order.weddingDate);
    const bookingDate = dateKey(order.bookingDate || order.createdAt);
    const directCosts = positive(order.otherExpenses) + positive(order.workerCost) + positive(order.transportationCost);
    const collectionsThisMonth = orderCashCollections(order)
      .filter(collection => inMonth(dateKey(collection.date), year, month));

    // Expected-profit formula: full planned order profit on execution, plus
    // deposits for bookings now that execute later, plus retained deposits.
    if (isNormalOrder(order) && inMonth(executionDate, year, month)) {
      record.expectedContribution += positive(order.totalPrice) - directCosts;
    }
    if (isNormalOrder(order)
      && inMonth(bookingDate, year, month)
      && (executionDate || '') > `${year}-${String(month + 1).padStart(2, '0')}-31`) {
      record.expectedContribution += collectionsThisMonth
        .filter(collection => collection.paymentType === 'deposit')
        .reduce((sum, collection) => sum + collection.amount, 0);
    }
    if (order.orderStatus === 'cancelled_deposit_retained') {
      record.expectedContribution += collectionsThisMonth.reduce((sum, collection) => sum + collection.amount, 0);
    }

    // Net-cash formula: realised completed-order profit, all advances on
    // uncompleted orders, retained deposits, then execution-month other costs.
    const completedInSelectedMonth = order.orderStatus === 'completed' && inMonth(executionDate, year, month);
    if (completedInSelectedMonth) {
      // Payments received before this month were already included as advances
      // in their collection month, so completion only receives this month's cash.
      record.cashContribution += collectionsThisMonth.reduce((sum, collection) => sum + collection.amount, 0)
        - completedOrderFulfillmentCosts(order) - positive(order.otherExpenses);
    }
    if (isNormalOrder(order) && !completedInSelectedMonth) {
      record.cashContribution += collectionsThisMonth.reduce((sum, collection) => sum + collection.amount, 0);
      if (inMonth(executionDate, year, month)) record.cashContribution -= positive(order.otherExpenses);
    }
    if (order.orderStatus === 'cancelled_deposit_retained') {
      record.cashContribution += collectionsThisMonth.reduce((sum, collection) => sum + collection.amount, 0);
    }
    record.difference = record.expectedContribution - record.cashContribution;
  });

  const issues: MonthlyCashReconciliationIssue[] = [];
  orders.forEach((order) => {
    const historyTotal = (order.paymentHistory || []).reduce((sum, payment) => sum + positive(payment.amount), 0);
    const paid = recordedOrderPayment(order);
    const expectedRemaining = Math.max(0, positive(order.totalPrice) - paid);
    const storedRemaining = Number(order.remainingBalance);
    const label = `${order.orderNumber} — ${order.customerName}`;

    if (historyTotal > 0 && Math.abs(historyTotal - paid) > 0.01) {
      issues.push({ id: `${order.id}-payment-history`, kind: 'payment-history', orderNumber: order.orderNumber, customerName: order.customerName,
        messageAr: `${label}: مجموع سجل الدفعات ${historyTotal.toLocaleString('en-US')} لا يطابق إجمالي المدفوع ${paid.toLocaleString('en-US')}.`,
        messageEn: `${label}: payment history (${historyTotal}) does not match total paid (${paid}).` });
    }
    if (Number.isFinite(storedRemaining) && Math.abs(storedRemaining - expectedRemaining) > 0.01) {
      issues.push({ id: `${order.id}-remaining-balance`, kind: 'remaining-balance', orderNumber: order.orderNumber, customerName: order.customerName,
        messageAr: `${label}: الرصيد المسجّل ${storedRemaining.toLocaleString('en-US')} بينما الرصيد المحسوب ${expectedRemaining.toLocaleString('en-US')}.`,
        messageEn: `${label}: stored remaining balance (${storedRemaining}) differs from calculated balance (${expectedRemaining}).` });
    }
    if (order.paymentStatus === 'fully_paid' && expectedRemaining > 0.01) {
      issues.push({ id: `${order.id}-payment-status`, kind: 'payment-status', orderNumber: order.orderNumber, customerName: order.customerName,
        messageAr: `${label}: الحالة مكتوبة «مدفوع بالكامل» لكن المتبقي الفعلي ${expectedRemaining.toLocaleString('en-US')}. الحل: إن كان المبلغ تم تحصيله، أضف دفعة سداد بقيمة ${expectedRemaining.toLocaleString('en-US')}. وإن لم يُحصّل، غيّر الحالة إلى «مدفوع جزئيًا».`,
        messageEn: `${label}: marked fully paid but ${expectedRemaining} remains. Record a settlement payment if collected; otherwise change it to partially paid.` });
    }
    if (order.paymentStatus !== 'fully_paid' && positive(order.totalPrice) > 0 && expectedRemaining <= 0.01) {
      issues.push({ id: `${order.id}-payment-status`, kind: 'payment-status', orderNumber: order.orderNumber, customerName: order.customerName,
        messageAr: `${label}: كل سعر الأوردر مسجّل كمحصّل، لكن حالة الدفع ليست «مدفوع بالكامل». راجع حالة الدفع واحفظ الأوردر لتحديثها.`,
        messageEn: `${label}: the full order price is recorded as paid, but the payment status is not fully paid. Review and save the order to update it.` });
    }
    if (paid > positive(order.totalPrice) + 0.01) {
      issues.push({ id: `${order.id}-overpaid`, kind: 'overpaid', orderNumber: order.orderNumber, customerName: order.customerName,
        messageAr: `${label}: إجمالي المدفوع أكبر من سعر الأوردر.`, messageEn: `${label}: total paid is greater than the order price.` });
    }
    if ([order.totalPrice, order.totalPaid, order.remainingBalance, order.otherExpenses, order.workerCost, order.transportationCost]
      .some(value => value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0))) {
      issues.push({ id: `${order.id}-invalid-amount`, kind: 'invalid-amount', orderNumber: order.orderNumber, customerName: order.customerName,
        messageAr: `${label}: يوجد مبلغ غير صالح أو سالب في بيانات الأوردر.`, messageEn: `${label}: an order amount is invalid or negative.` });
    }
  });

  const items = [...records.values()]
    .filter(item => Math.abs(item.difference) > 0.01)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  return {
    netOrderCash: summary.netMonthlyCash,
    expectedProfit: summary.netMonthlyOrderProfit,
    difference: summary.netMonthlyOrderProfit - summary.netMonthlyCash,
    items,
    issues,
  };
};
