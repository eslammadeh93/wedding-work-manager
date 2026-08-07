import type { CompanyFinanceEntry, Order, PaymentEntry } from '../types';
import { completedOrderFulfillmentCosts, recordedOrderPayment } from './orderPayments';

export interface CashCollection {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  amount: number;
  date: string;
  method: string;
  isCompletedOrder: boolean;
  isLegacyEstimate?: boolean;
}

export interface MonthlyCashSummary {
  collections: CashCollection[];
  collectedFromCompletedOrders: number;
  advancesFromUpcomingOrders: number;
  capitalAdded: number;
  operatingExpenses: number;
  completedOrderCosts: number;
  /** Other expenses entered for orders booked this month but not completed yet. */
  upcomingOrderOtherExpenses: number;
  /** Customer collections less direct fulfillment costs; excludes capital and general overhead. */
  orderCashNet: number;
  /** Cumulative order-only cash that should be in the safe at the selected month end. */
  orderCashBalanceToDate: number;
  cashMovement: number;
  expectedSafeBalance: number;
}

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
  };

  const entries: CashCollection[] = history.map((payment: PaymentEntry) => ({
    ...base,
    id: payment.id,
    amount: positiveAmount(payment.amount),
    date: dateKey(payment.date) || fallbackDate,
    method: payment.method || order.paymentMethod || 'other',
  }));

  // Stored totals from older records sometimes exceed their available history.
  // Keep the difference visible instead of silently omitting cash from the safe.
  if (actualPaid > historyTotal) {
    entries.push({
      ...base,
      id: `${order.id}-legacy-payment`,
      amount: actualPaid - historyTotal,
      date: fallbackDate,
      method: order.paymentMethod || 'other',
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
  const allCollections = orders
    .filter((order) => order.orderStatus !== 'cancelled')
    .flatMap(orderCashCollections);
  const collections = allCollections
    .filter((collection) => inMonth(dateKey(collection.date), year, month))
    .sort((a, b) => b.date.localeCompare(a.date));

  const sum = (items: Array<{ amount: number }>) => items.reduce((total, item) => total + item.amount, 0);
  const collectedFromCompletedOrders = sum(collections.filter((collection) => collection.isCompletedOrder));
  const advancesFromUpcomingOrders = sum(collections.filter((collection) => !collection.isCompletedOrder));

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

  // Before fulfillment, only the "other expenses" field is treated as spent.
  // Worker and transport costs remain pending until the order is completed.
  // `bookingDate` is the best available date for this expense in the current data model.
  const upcomingOrderOtherExpenses = orders
    .filter((order) => order.orderStatus !== 'completed' && order.orderStatus !== 'cancelled' && inMonth(dateKey(order.bookingDate || order.createdAt), year, month))
    .reduce((total, order) => total + positiveAmount(order.otherExpenses), 0);

  const orderCashNet = collectedFromCompletedOrders + advancesFromUpcomingOrders - completedOrderCosts - upcomingOrderOtherExpenses;
  const cashMovement = collectedFromCompletedOrders + advancesFromUpcomingOrders + capitalAdded - operatingExpenses - completedOrderCosts;

  const collectedToDate = sum(allCollections.filter((collection) => onOrBeforeMonthEnd(dateKey(collection.date), year, month)));
  const capitalToDate = financeEntries
    .filter((entry) => isCapital(entry) && onOrBeforeMonthEnd(dateKey(entry.date), year, month))
    .reduce((total, entry) => total + positiveAmount(entry.amount), 0);
  const operatingExpensesToDate = financeEntries
    .filter((entry) => !isCapital(entry) && onOrBeforeMonthEnd(dateKey(entry.date), year, month))
    .reduce((total, entry) => total + positiveAmount(entry.amount), 0);
  const completedCostsToDate = orders
    .filter((order) => order.orderStatus === 'completed' && onOrBeforeMonthEnd(dateKey(order.eventDate || order.weddingDate), year, month))
    .reduce((total, order) => total + completedOrderFulfillmentCosts(order) + positiveAmount(order.otherExpenses), 0);
  // Other expenses are paid before fulfillment, so they remain deducted from
  // the safe for every later month while their order is still not completed.
  const upcomingOrderOtherExpensesToDate = orders
    .filter((order) => order.orderStatus !== 'completed' && order.orderStatus !== 'cancelled' && onOrBeforeMonthEnd(dateKey(order.bookingDate || order.createdAt), year, month))
    .reduce((total, order) => total + positiveAmount(order.otherExpenses), 0);
  const orderCashBalanceToDate = collectedToDate - completedCostsToDate - upcomingOrderOtherExpensesToDate;

  return {
    collections,
    collectedFromCompletedOrders,
    advancesFromUpcomingOrders,
    capitalAdded,
    operatingExpenses,
    completedOrderCosts,
    upcomingOrderOtherExpenses,
    orderCashNet,
    orderCashBalanceToDate,
    cashMovement,
    expectedSafeBalance: collectedToDate + capitalToDate - operatingExpensesToDate - completedCostsToDate,
  };
};
