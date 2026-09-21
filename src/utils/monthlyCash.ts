import type { CompanyFinanceEntry, Order, PaymentEntry, PaymentType } from '../types';
import { completedOrderFulfillmentCosts, recordedOrderPayment } from './orderPayments';

export interface CashCollection {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  amount: number;
  date: string;
  method: string;
  paymentType: PaymentType;
  isCompletedOrder: boolean;
  /** A cancelled booking whose recorded payment was retained by the company. */
  isRetainedDeposit: boolean;
  isLegacyEstimate?: boolean;
}

export type NetMonthlyCashBreakdownKind = 'completed-order' | 'upcoming-advance' | 'retained-deposit' | 'upcoming-expense';

/** A single order's signed contribution to the selected month's net order cash. */
export interface NetMonthlyCashBreakdownItem {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  kind: NetMonthlyCashBreakdownKind;
  /** The signed amount included in the month's final total. */
  amount: number;
  /** Present for completed orders to show that only this month's collections count. */
  collectedThisMonth?: number;
  /** Present for completed orders; these costs are recognized in the execution month. */
  completedOrderCosts?: number;
}

export interface MonthlyCashSummary {
  collections: CashCollection[];
  netMonthlyCashBreakdown: NetMonthlyCashBreakdownItem[];
  collectedFromCompletedOrders: number;
  advancesFromUpcomingOrders: number;
  /** Payments retained from bookings cancelled with a non-refundable deposit. */
  retainedCancelledDeposits: number;
  capitalAdded: number;
  operatingExpenses: number;
  completedOrderCosts: number;
  /** Booking-month other expenses not already included in this month's completed-order costs. */
  upcomingOrderOtherExpenses: number;
  /** This month's completed-order collections less fulfillment and same-month booking costs. */
  completedOrdersNetProfit: number;
  /** Completed-order net profit plus retained cancelled deposits. */
  completedOrdersNetProfitWithRetainedDeposits: number;
  /** Upcoming-order advances after subtracting only their recorded other expenses. */
  upcomingOrderAdvancesNet: number;
  /** Booking deposits for orders not yet completed, after booking-month other expenses. */
  upcomingOrderDepositsNet: number;
  /** Booking deposits received this month for orders that are not yet completed. */
  upcomingOrderDepositsPaid: number;
  /** All customer money received in the selected month before deductions. */
  grossMonthlyIncome: number;
  /** All booking deposits received in the selected month, including retained deposits. */
  totalDepositsPaid: number;
  /** All settlement payments received in the selected month. */
  totalSettlementPayments: number;
  /** Outstanding order balances expected in the selected month, by execution date. */
  expectedSettlementPayments: number;
  /** Booking-month other expenses outside this month's completed-order costs. */
  bookedOrderOtherExpenses: number;
  /** Worker and transportation costs for orders completed in the selected month. */
  completedWorkerTransportCosts: number;
  /** Booking-month other expenses outside this month's completed-order costs. */
  totalMonthlyOrderExpenses: number;
  /**
   * Completed-order net profit + advances from uncompleted orders + retained
   * cancelled deposits − other expenses for uncompleted orders only.
   */
  netMonthlyCash: number;
  /** Expected total profit by the end of this month from all scheduled orders, after direct costs. */
  netMonthlyOrderProfit: number;
  /** Customer collections less direct fulfillment costs; excludes capital and general overhead. */
  orderCashNet: number;
  /** Cumulative order-only cash that should be in the safe at the selected month end. */
  orderCashBalanceToDate: number;
  cashMovement: number;
  expectedSafeBalance: number;
}

/**
 * The actual amount expected in the company safe at the end of a given day.
 * This is intentionally date-based: future-dated payments and costs must not
 * affect the cash figure shown in the dashboard today.
 */
export const calculateSafeBalanceToDate = (
  orders: Order[],
  financeEntries: CompanyFinanceEntry[],
  asOf = new Date(),
): number => {
  const asOfDate = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}-${String(asOf.getDate()).padStart(2, '0')}`;
  const isOnOrBefore = (value: string | null) => Boolean(value && value <= asOfDate);
  const allCollections = orders
    .filter((order) => order.orderStatus !== 'cancelled')
    .flatMap(orderCashCollections);

  const collected = allCollections
    .filter((collection) => isOnOrBefore(dateKey(collection.date)))
    .reduce((total, collection) => total + positiveAmount(collection.amount), 0);
  const capital = financeEntries
    .filter((entry) => isCapital(entry) && isOnOrBefore(dateKey(entry.date)))
    .reduce((total, entry) => total + positiveAmount(entry.amount), 0);
  const operatingExpenses = financeEntries
    .filter((entry) => !isCapital(entry) && isOnOrBefore(dateKey(entry.date)))
    .reduce((total, entry) => total + positiveAmount(entry.amount), 0);
  const completedOrderCosts = orders
    .filter((order) => order.orderStatus === 'completed' && isOnOrBefore(dateKey(order.eventDate || order.weddingDate)))
    .reduce((total, order) => total + completedOrderFulfillmentCosts(order), 0);
  const bookedOrderOtherExpenses = orders
    .filter((order) => order.orderStatus !== 'cancelled' && order.orderStatus !== 'cancelled_deposit_retained'
      && isOnOrBefore(dateKey(order.bookingDate || order.createdAt)))
    .reduce((total, order) => total + positiveAmount(order.otherExpenses), 0);

  return collected + capital - operatingExpenses - completedOrderCosts - bookedOrderOtherExpenses;
};

/** General expenses consume only the opening carry; order cash and capital stay separate. */
export const calculateFinancePeriodCash = (
  orders: Order[],
  financeEntries: CompanyFinanceEntry[],
  startMonth: string,
  endMonth: string,
) => {
  const [endYear, endMonthNumber] = endMonth.split('-').map(Number);
  const periodEnd = new Date(endYear, endMonthNumber, 0);
  const [startYear, startMonthNumber] = startMonth.split('-').map(Number);
  const previousPeriodEnd = startMonth ? new Date(startYear, startMonthNumber - 1, 0) : null;
  const openingBalance = previousPeriodEnd ? calculateSafeBalanceToDate(orders, financeEntries, previousPeriodEnd) : 0;
  const previousOrderCash = previousPeriodEnd ? calculateSafeBalanceToDate(orders, [], previousPeriodEnd) : 0;
  const netOrderCash = calculateSafeBalanceToDate(orders, [], periodEnd) - previousOrderCash;
  const entries = financeEntries.filter((entry) => {
    const month = dateKey(entry.date)?.slice(0, 7);
    return month && month >= startMonth && month <= endMonth;
  });
  const capitalAdded = entries.filter(isCapital).reduce((sum, entry) => sum + positiveAmount(entry.amount), 0);
  const generalExpenses = entries.filter((entry) => !isCapital(entry)).reduce((sum, entry) => sum + positiveAmount(entry.amount), 0);
  // Keep a deficit visible instead of silently funding expenses from new capital
  // or order income. The combined safe still reflects the money actually left.
  const remainingCarriedBalance = openingBalance - generalExpenses;
  const totalSafeBalance = remainingCarriedBalance + capitalAdded + netOrderCash;
  return { openingBalance, capitalAdded, generalExpenses, netOrderCash, remainingCarriedBalance, totalSafeBalance };
};

const dateKey = (value?: string): string | null => {
  if (!value) return null;
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (matched) return matched[0];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const inMonth = (date: string | null, year: number, month: number) =>
  date?.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`) ?? false;

const onOrBeforeMonthEnd = (date: string | null, year: number, month: number) =>
  !!date && date <= `${year}-${String(month + 1).padStart(2, '0')}-31`;

const positiveAmount = (value: number | undefined) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const inferredPaymentType = (order: Order, payment: PaymentEntry, index: number): PaymentType => {
  if (payment.type === 'deposit' || payment.type === 'settlement') return payment.type;
  if (/initial|deposit|عربون/i.test(payment.notes || '')) return 'deposit';
  const paymentDate = dateKey(payment.date);
  const bookingDate = dateKey(order.bookingDate || order.createdAt);
  if (index === 0 && (paymentDate === bookingDate || positiveAmount(payment.amount) <= positiveAmount(order.deposit))) return 'deposit';
  return 'settlement';
};

/**
 * Gets individual collections. Legacy orders that only contain `deposit` or a
 * stored total get one clearly marked estimated entry on their booking date.
 */
export const orderCashCollections = (order: Order): CashCollection[] => {
  const history = (order.paymentHistory || []).filter((payment) => positiveAmount(payment.amount) > 0);
  const historyTotal = history.reduce((sum, payment) => sum + positiveAmount(payment.amount), 0);
  const actualPaid = recordedOrderPayment(order);
  const fallbackDate = dateKey(order.bookingDate || order.createdAt) || order.createdAt;
  const base = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    isCompletedOrder: order.orderStatus === 'completed',
    isRetainedDeposit: order.orderStatus === 'cancelled_deposit_retained',
  };

  const entries: CashCollection[] = history.map((payment: PaymentEntry, index) => ({
    ...base,
    id: payment.id,
    amount: positiveAmount(payment.amount),
    date: dateKey(payment.date) || fallbackDate,
    method: payment.method || order.paymentMethod || 'other',
    paymentType: inferredPaymentType(order, payment, index),
  }));

  // Stored totals from older records sometimes exceed their available history.
  // Keep the difference visible instead of silently omitting cash from the safe.
  if (actualPaid > historyTotal) {
    const missingAmount = actualPaid - historyTotal;
    const fallbackPaymentType: PaymentType = history.length === 0 && positiveAmount(order.deposit) > 0 ? 'deposit' : 'settlement';
    entries.push({
      ...base,
      id: `${order.id}-legacy-payment`,
      amount: missingAmount,
      date: fallbackPaymentType === 'settlement' && order.orderStatus === 'completed'
        ? dateKey(order.eventDate || order.weddingDate) || fallbackDate
        : fallbackDate,
      method: order.paymentMethod || 'other',
      paymentType: fallbackPaymentType,
      isLegacyEstimate: true,
    });
  }

  return entries;
};

const isCapital = (entry: CompanyFinanceEntry) => entry.type === 'capital' || entry.category === 'رأس مال';

export const calculateMonthlyCash = (
  orders: Order[],
  financeEntries: CompanyFinanceEntry[],
  year: number,
  month: number,
): MonthlyCashSummary => {
  const monthEndKey = `${year}-${String(month + 1).padStart(2, '0')}-31`;
  const orderById = new Map(orders.map(order => [order.id, order]));
  // A report must reflect what the order looked like during that month. An
  // order completed later can still have an August booking deposit for a
  // September event; its current status must not erase that August cash.
  const completedInSelectedMonth = (order: Order | undefined) => Boolean(
    order
    && order.orderStatus === 'completed'
    && inMonth(dateKey(order.eventDate || order.weddingDate), year, month),
  );
  const isUpcomingForSelectedMonth = (order: Order) => order.orderStatus !== 'cancelled'
    && order.orderStatus !== 'cancelled_deposit_retained'
    && !completedInSelectedMonth(order);
  const allCollections = orders
    .filter((order) => order.orderStatus !== 'cancelled')
    .flatMap(orderCashCollections);
  const collections = allCollections
    .filter((collection) => inMonth(dateKey(collection.date), year, month))
    .sort((a, b) => b.date.localeCompare(a.date));

  const sum = (items: Array<{ amount: number }>) => items.reduce((total, item) => total + item.amount, 0);
  const collectedFromCompletedOrders = sum(collections.filter((collection) => completedInSelectedMonth(orderById.get(collection.orderId))));
  const retainedCancelledDeposits = sum(collections.filter((collection) => collection.isRetainedDeposit));
  const advancesFromUpcomingOrders = sum(collections.filter((collection) => {
    const order = orderById.get(collection.orderId);
    return Boolean(order && isUpcomingForSelectedMonth(order) && !collection.isRetainedDeposit);
  }));

  const standardCollections = collections.filter((collection) => !collection.isRetainedDeposit);
  const nonRetainedDeposits = sum(standardCollections.filter((collection) => collection.paymentType === 'deposit'));
  const totalSettlementPayments = sum(standardCollections.filter((collection) => collection.paymentType === 'settlement'));
  const totalDepositsPaid = nonRetainedDeposits + retainedCancelledDeposits;
  const grossMonthlyIncome = totalDepositsPaid + totalSettlementPayments;
  // The remaining amount is expected on the execution date. This is a forecast,
  // so it uses the outstanding balance rather than payments already collected.
  const expectedSettlementPayments = orders
    .filter((order) => order.orderStatus !== 'cancelled' && order.orderStatus !== 'cancelled_deposit_retained'
      && inMonth(dateKey(order.eventDate || order.weddingDate), year, month))
    .reduce((total, order) => total + Math.max(0, positiveAmount(order.totalPrice) - recordedOrderPayment(order)), 0);
  const upcomingOrderDeposits = sum(collections.filter((collection) => {
    const order = orderById.get(collection.orderId);
    return Boolean(order
      && isUpcomingForSelectedMonth(order)
      && !collection.isRetainedDeposit
      && collection.paymentType === 'deposit');
  }));

  const monthlyEntries = financeEntries.filter((entry) => inMonth(dateKey(entry.date), year, month));
  const capitalAdded = monthlyEntries.filter(isCapital).reduce((total, entry) => total + positiveAmount(entry.amount), 0);
  const operatingExpenses = monthlyEntries
    .filter((entry) => !isCapital(entry))
    .reduce((total, entry) => total + positiveAmount(entry.amount), 0);

  // Worker/transport costs belong to completion. Other expenses belong only to
  // booking, including when looking back after the order has been completed.
  const otherExpensesThisMonth = (order: Order) => inMonth(dateKey(order.bookingDate || order.createdAt), year, month)
    ? positiveAmount(order.otherExpenses) : 0;
  const completedCostsThisMonth = (order: Order) => completedOrderFulfillmentCosts(order) + otherExpensesThisMonth(order);
  const completedOrderCosts = orders
    .filter((order) => order.orderStatus === 'completed' && inMonth(dateKey(order.eventDate || order.weddingDate), year, month))
    .reduce((total, order) => total + completedCostsThisMonth(order), 0);

  const completedWorkerTransportCosts = orders
    .filter((order) => order.orderStatus === 'completed' && inMonth(dateKey(order.eventDate || order.weddingDate), year, month))
    .reduce((total, order) => total + completedOrderFulfillmentCosts(order), 0);

  const bookedOrderOtherExpenses = orders
    .filter(isUpcomingForSelectedMonth)
    .reduce((total, order) => total + otherExpensesThisMonth(order), 0);

  // Before fulfillment, only the "other expenses" field is treated as spent.
  // Worker and transport costs remain pending until the order is completed.
  // Deduct them in the booking month, even if execution is in a later month.
  const upcomingOrderOtherExpenses = bookedOrderOtherExpenses;
  // The report's "total expenses" card is deliberately limited to upcoming
  // orders. Worker and transport costs remain represented by completed-order
  // profit and the monthly net, not this card.
  const totalMonthlyOrderExpenses = upcomingOrderOtherExpenses;

  // A completed order includes only costs recognized in this month. Booking
  // expenses deducted in an earlier month must never be deducted on completion.
  // The completion month receives only payments actually collected during that
  // month. A deposit recorded in an earlier month has already affected that
  // earlier month's cash and must never be counted again on completion.
  const completedOrdersRevenue = collectedFromCompletedOrders;
  const completedOrdersNetProfit = completedOrdersRevenue - completedOrderCosts;
  const netMonthlyCash = completedOrdersNetProfit
    + advancesFromUpcomingOrders
    + retainedCancelledDeposits
    - upcomingOrderOtherExpenses;

  // This is the profit expected by the end of the selected month: every order
  // scheduled for execution in that month contributes its full price less all
  // direct costs, whether it has been settled yet or not. Retained cancelled
  // deposits are realised profit, and booking deposits received this month for
  // orders executing in a later month are included as requested cash profit.
  const executedOrdersNetProfit = orders
    .filter((order) => order.orderStatus !== 'cancelled' && order.orderStatus !== 'cancelled_deposit_retained'
      && inMonth(dateKey(order.eventDate || order.weddingDate), year, month))
    .reduce((total, order) => total
      + positiveAmount(order.totalPrice)
      - positiveAmount(order.otherExpenses)
      - positiveAmount(order.workerCost)
      - positiveAmount(order.transportationCost), 0);
  const futureExecutionBookingDeposits = orders
    .filter((order) => order.orderStatus !== 'cancelled' && order.orderStatus !== 'cancelled_deposit_retained'
      && inMonth(dateKey(order.bookingDate || order.createdAt), year, month)
      && (dateKey(order.eventDate || order.weddingDate) || '') > `${year}-${String(month + 1).padStart(2, '0')}-31`)
    .flatMap(orderCashCollections)
    .filter((collection) => inMonth(dateKey(collection.date), year, month) && collection.paymentType === 'deposit')
    .reduce((total, collection) => total + collection.amount, 0);
  const netMonthlyOrderProfit = executedOrdersNetProfit + retainedCancelledDeposits + futureExecutionBookingDeposits;

  const completedOrdersNetProfitWithRetainedDeposits = completedOrdersNetProfit + retainedCancelledDeposits;
  // Before completion, only `otherExpenses` is an actual outflow.
  const upcomingOrderAdvancesNet = advancesFromUpcomingOrders - upcomingOrderOtherExpenses;
  const upcomingOrderDepositsNet = upcomingOrderDeposits - upcomingOrderOtherExpenses;
  const orderCashNet = collectedFromCompletedOrders + advancesFromUpcomingOrders + retainedCancelledDeposits - completedOrderCosts - upcomingOrderOtherExpenses;
  const cashMovement = orderCashNet + capitalAdded - operatingExpenses;

  const monthEnd = new Date(year, month + 1, 0);
  const expectedSafeBalance = calculateSafeBalanceToDate(orders, financeEntries, monthEnd);
  const collectedToDate = sum(allCollections.filter((collection) => onOrBeforeMonthEnd(dateKey(collection.date), year, month)));
  const completedCostsToDate = orders
    .filter((order) => order.orderStatus === 'completed' && onOrBeforeMonthEnd(dateKey(order.eventDate || order.weddingDate), year, month))
    .reduce((total, order) => total + completedOrderFulfillmentCosts(order), 0);
  // Booking expenses stay deducted once, regardless of later completion.
  const bookedOrderOtherExpensesToDate = orders
    .filter((order) => order.orderStatus !== 'cancelled' && order.orderStatus !== 'cancelled_deposit_retained' && onOrBeforeMonthEnd(dateKey(order.bookingDate || order.createdAt), year, month))
    .reduce((total, order) => total + positiveAmount(order.otherExpenses), 0);
  const orderCashBalanceToDate = collectedToDate - completedCostsToDate - bookedOrderOtherExpensesToDate;

  const netMonthlyCashBreakdown: NetMonthlyCashBreakdownItem[] = [
    ...orders
      .filter((order) => order.orderStatus === 'completed' && inMonth(dateKey(order.eventDate || order.weddingDate), year, month))
      .map((order) => {
        const collectedThisMonth = sum(collections.filter((collection) => collection.orderId === order.id));
        const orderCosts = completedCostsThisMonth(order);
        return {
          id: `${order.id}-completed`,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          kind: 'completed-order' as const,
          amount: collectedThisMonth - orderCosts,
          collectedThisMonth,
          completedOrderCosts: orderCosts,
        };
      }),
    ...orders
      .filter((order) => isUpcomingForSelectedMonth(order))
      .map((order) => {
        const amount = sum(collections.filter((collection) => collection.orderId === order.id && !collection.isRetainedDeposit));
        return amount > 0 ? {
          id: `${order.id}-advance`, orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName,
          kind: 'upcoming-advance' as const, amount,
        } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
    ...orders
      .filter((order) => order.orderStatus === 'cancelled_deposit_retained')
      .map((order) => {
        const amount = sum(collections.filter((collection) => collection.orderId === order.id && collection.isRetainedDeposit));
        return amount > 0 ? {
          id: `${order.id}-retained`, orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName,
          kind: 'retained-deposit' as const, amount,
        } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
    ...orders
      .filter((order) => isUpcomingForSelectedMonth(order) && otherExpensesThisMonth(order) > 0)
      .map((order) => ({
        id: `${order.id}-expense`, orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName,
        kind: 'upcoming-expense' as const, amount: -positiveAmount(order.otherExpenses),
      })),
  ];

  return {
    collections,
    netMonthlyCashBreakdown,
    collectedFromCompletedOrders,
    advancesFromUpcomingOrders,
    retainedCancelledDeposits,
    capitalAdded,
    operatingExpenses,
    completedOrderCosts,
    upcomingOrderOtherExpenses,
    completedOrdersNetProfit,
    grossMonthlyIncome,
    totalDepositsPaid,
    totalSettlementPayments,
    expectedSettlementPayments,
    bookedOrderOtherExpenses,
    completedWorkerTransportCosts,
    totalMonthlyOrderExpenses,
    netMonthlyCash,
    netMonthlyOrderProfit,
    orderCashNet,
    orderCashBalanceToDate,
    cashMovement,
    completedOrdersNetProfitWithRetainedDeposits,
    upcomingOrderAdvancesNet,
    upcomingOrderDepositsNet,
    upcomingOrderDepositsPaid: upcomingOrderDeposits,
    expectedSafeBalance,
  };
};
