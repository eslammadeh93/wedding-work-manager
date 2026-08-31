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

export interface MonthlyCashSummary {
  collections: CashCollection[];
  collectedFromCompletedOrders: number;
  advancesFromUpcomingOrders: number;
  /** Payments retained from bookings cancelled with a non-refundable deposit. */
  retainedCancelledDeposits: number;
  capitalAdded: number;
  operatingExpenses: number;
  completedOrderCosts: number;
  /** Other expenses entered for orders booked this month but not completed yet. */
  upcomingOrderOtherExpenses: number;
  /** Money collected for completed orders less every direct cost on those orders. */
  completedOrdersNetProfit: number;
  /** Completed-order net profit plus retained cancelled deposits. */
  completedOrdersNetProfitWithRetainedDeposits: number;
  /** Upcoming-order advances after subtracting only their recorded other expenses. */
  upcomingOrderAdvancesNet: number;
  /** Booking deposits for orders not yet completed, after their booking expenses. */
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
  /** Other expenses belonging to orders booked in the selected month. */
  bookedOrderOtherExpenses: number;
  /** Worker and transportation costs for orders completed in the selected month. */
  completedWorkerTransportCosts: number;
  /** Other expenses for not-yet-completed orders booked in the selected month. */
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
    .reduce((total, order) => total + completedOrderFulfillmentCosts(order) + positiveAmount(order.otherExpenses), 0);
  const upcomingOrderOtherExpenses = orders
    .filter((order) => order.orderStatus !== 'completed' && order.orderStatus !== 'cancelled' && order.orderStatus !== 'cancelled_deposit_retained'
      && isOnOrBefore(dateKey(order.bookingDate || order.createdAt)))
    .reduce((total, order) => total + positiveAmount(order.otherExpenses), 0);

  return collected + capital - operatingExpenses - completedOrderCosts - upcomingOrderOtherExpenses;
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

  // Direct costs are cash out only after an order has been completed. Event date
  // is used as the best available settlement date until per-cost dates are stored.
  const completedOrderCosts = orders
    .filter((order) => order.orderStatus === 'completed' && inMonth(dateKey(order.eventDate || order.weddingDate), year, month))
    .reduce((total, order) => total + completedOrderFulfillmentCosts(order) + positiveAmount(order.otherExpenses), 0);

  const completedWorkerTransportCosts = orders
    .filter((order) => order.orderStatus === 'completed' && inMonth(dateKey(order.eventDate || order.weddingDate), year, month))
    .reduce((total, order) => total + completedOrderFulfillmentCosts(order), 0);

  const bookedOrderOtherExpenses = orders
    .filter((order) => isUpcomingForSelectedMonth(order) && inMonth(dateKey(order.bookingDate || order.createdAt), year, month))
    .reduce((total, order) => total + positiveAmount(order.otherExpenses), 0);

  // Before fulfillment, only the "other expenses" field is treated as spent.
  // Worker and transport costs remain pending until the order is completed.
  // Other expenses belong to the booking month, even when an advance arrives
  // in a later month.
  const upcomingOrderOtherExpenses = orders
    .filter((order) => isUpcomingForSelectedMonth(order) && inMonth(dateKey(order.bookingDate || order.createdAt), year, month))
    .reduce((total, order) => total + positiveAmount(order.otherExpenses), 0);
  // The report's "total expenses" card is deliberately limited to upcoming
  // orders. Worker and transport costs remain represented by completed-order
  // profit and the monthly net, not this card.
  const totalMonthlyOrderExpenses = upcomingOrderOtherExpenses;

  // A completed order contributes its actual collected amount less every
  // direct cost. Its booking expenses must never be deducted a second time
  // from the headline cash result just because the booking was made this month.
  const completedOrdersRevenue = orders
    .filter((order) => order.orderStatus === 'completed' && inMonth(dateKey(order.eventDate || order.weddingDate), year, month))
    .reduce((total, order) => total + recordedOrderPayment(order), 0);
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
    .reduce((total, order) => total + completedOrderFulfillmentCosts(order) + positiveAmount(order.otherExpenses), 0);
  // Other expenses are recorded in the booking month, so they remain deducted
  // from the safe in every later month while the order is not completed.
  const upcomingOrderOtherExpensesToDate = orders
    .filter((order) => order.orderStatus !== 'completed' && order.orderStatus !== 'cancelled' && order.orderStatus !== 'cancelled_deposit_retained' && onOrBeforeMonthEnd(dateKey(order.bookingDate || order.createdAt), year, month))
    .reduce((total, order) => total + positiveAmount(order.otherExpenses), 0);
  const orderCashBalanceToDate = collectedToDate - completedCostsToDate - upcomingOrderOtherExpensesToDate;

  return {
    collections,
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
