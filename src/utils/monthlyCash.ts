import type { CompanyFinanceEntry, Order, PaymentEntry, PaymentType } from '../types';
import { completedOrderFulfillmentCosts, fulfillmentCostsRecognized, recordedOrderPayment } from './orderPayments';
import { financialDateKey } from './financialCalendar';
import { isSecurityEntry } from './orderPaymentState';

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
  /**
   * Actual money the month's orders produced: collected cash, less the order
   * costs recognized in this month, less dated refunds. Not forecast revenue.
   */
  netOrderCash: number;
  /**
   * Contract margin for the work scheduled this month: full agreed price less
   * all three direct order costs, for every non-cancelled order. Not cash.
   */
  expectedOrderProfit: number;
  /** Company operating costs only; order-linked entries are excluded. */
  generalOperatingExpenses: number;
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
  // Cancelling an order does not un-receive the money that was already taken
  // for it. The receipt stays recorded on its original date; if the money went
  // back, that is its own dated refund movement. Legacy security movements are
  // not collections at all and never reach this sum.
  const allCollections = orders.flatMap(orderCashCollections);

  const collected = allCollections
    .filter((collection) => isOnOrBefore(dateKey(collection.date)))
    .reduce((total, collection) => total + collection.amount, 0);
  const capital = financeEntries
    .filter((entry) => isCapital(entry) && isOnOrBefore(dateKey(entry.date)))
    .reduce((total, entry) => total + entryCashEffect(entry), 0);
  // Order-linked entries are order costs and are deducted below, so they are
  // never also charged here as company operating expenses.
  const operatingExpenses = financeEntries
    .filter((entry) => isGeneralOperatingEntry(entry) && isOnOrBefore(dateKey(entry.date)))
    .reduce((total, entry) => total + entryCashEffect(entry), 0);
  const orderLinkedCosts = financeEntries
    .filter((entry) => isOrderLinkedEntry(entry) && isOnOrBefore(dateKey(entry.date)))
    .reduce((total, entry) => total + entryCashEffect(entry), 0);
  const completedOrderCosts = orders
    .filter((order) => fulfillmentCostsRecognized(order) && isOnOrBefore(dateKey(order.eventDate || order.weddingDate)))
    .reduce((total, order) => total + completedOrderFulfillmentCosts(order), 0);
  // A cost that was incurred at booking stays incurred. Cancelling the order
  // later does not refund what was already spent on it.
  const bookedOrderOtherExpenses = orders
    .filter((order) => isOnOrBefore(dateKey(order.bookingDate || order.createdAt)))
    .reduce((total, order) => total + positiveAmount(order.otherExpenses), 0);

  return collected + capital - operatingExpenses - orderLinkedCosts - completedOrderCosts - bookedOrderOtherExpenses;
};

/**
 * The treasury position for one operating period.
 *
 * Each period stands on its own. It opens with the previous period's final
 * treasury balance - the actual money left, not its revenue, profit or
 * contract value - then adds capital put in by hand, subtracts the company's
 * own operating costs, and finally adds what the orders themselves netted.
 *
 * A deficit stays visible. Clamping the remaining balance at zero would hide
 * that this period's expenses outran the money carried into it, and would make
 * the total stop reconciling with the cash actually in hand.
 */
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
  // The order-cash side must see the entries booked against orders, otherwise
  // an order-linked cost is deducted nowhere: it is excluded from general
  // operating expenses by design, so leaving it out here loses it entirely.
  const orderEntries = financeEntries.filter(isOrderLinkedEntry);
  const previousOrderCash = previousPeriodEnd ? calculateSafeBalanceToDate(orders, orderEntries, previousPeriodEnd) : 0;
  const netOrderCash = calculateSafeBalanceToDate(orders, orderEntries, periodEnd) - previousOrderCash;
  const entries = financeEntries.filter((entry) => {
    const month = dateKey(entry.date)?.slice(0, 7);
    return month && month >= startMonth && month <= endMonth;
  });
  const capitalAdded = entries.filter(isCapital).reduce((sum, entry) => sum + entryCashEffect(entry), 0);
  // Order-linked entries are order costs and are already inside net order
  // cash, so charging them here as well would deduct the same money twice.
  const generalExpenses = entries.filter(isGeneralOperatingEntry).reduce((sum, entry) => sum + entryCashEffect(entry), 0);
  // Capital belongs to the operating balance, not only to the grand total:
  // money put into the business is available to meet this period's costs, and
  // showing the carry without it understates what is actually there.
  const remainingCarriedBalance = openingBalance + capitalAdded - generalExpenses;
  const totalSafeBalance = remainingCarriedBalance + netOrderCash;
  return {
    openingBalance, capitalAdded, generalExpenses, netOrderCash, remainingCarriedBalance, totalSafeBalance,
    // Unambiguous names for the same four figures.
    openingCarriedBalance: openingBalance,
    generalOperatingExpenses: generalExpenses,
    remainingOperatingBalance: remainingCarriedBalance,
    totalTreasuryBalance: totalSafeBalance,
  };
};

// The one date-only helper, shared with the reporting screens so a value can
// never be classified into one month here and another month there.
const dateKey = financialDateKey;

const inMonth = (date: string | null, year: number, month: number) =>
  date?.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`) ?? false;

const onOrBeforeMonthEnd = (date: string | null, year: number, month: number) =>
  !!date && date <= `${year}-${String(month + 1).padStart(2, '0')}-31`;

const positiveAmount = (value: number | undefined) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const inferredPaymentType = (order: Order, payment: PaymentEntry, index: number): PaymentType => {
  // Security entries never get here: they are filtered out before this runs.
  if (payment.type === 'deposit' || payment.type === 'settlement' || payment.type === 'refund') return payment.type;
  if (/initial|deposit|عربون/i.test(payment.notes || '')) return 'deposit';
  const paymentDate = dateKey(payment.date);
  const bookingDate = dateKey(order.bookingDate || order.createdAt);
  if (index === 0 && (paymentDate === bookingDate || positiveAmount(payment.amount) <= positiveAmount(order.deposit))) return 'deposit';
  return 'settlement';
};

/**
 * Whether a booking was cancelled with its money kept.
 *
 * The stored status is normalised before it is compared. A record written by
 * an older version, an import or a hand edit can carry the same status with
 * different spacing, casing or separators, and a strict string comparison
 * silently dropped it out of every retained rule: it then fell through to the
 * execution-date branches, where an order that was never executed has no event
 * date and so recognized no profit at all, while its retained cash still
 * counted. Retained money is profit whatever the record's spelling.
 *
 * This reads the stored value tolerantly and never rewrites it. Every retained
 * rule goes through here - recognition and the presentation buckets alike - so
 * one legacy record can never be retained for one rule and active for another.
 */
export const isRetainedCancellation = (order: Pick<Order, 'orderStatus'>): boolean =>
  String(order.orderStatus || '').trim().toLowerCase().replace(/[\s-]+/g, '_') === 'cancelled_deposit_retained';

/**
 * Gets individual collections. Legacy orders that only contain `deposit` or a
 * stored total get one clearly marked estimated entry on their booking date.
 */
export const orderCashCollections = (order: Order): CashCollection[] => {
  // Legacy security movements are dropped here, at the single point where
  // payment entries become cash. They stay stored on the order, but no cash
  // figure anywhere in the app - safe balance, treasury, net order cash,
  // monthly cash or reports - can see them.
  const history = (order.paymentHistory || [])
    .filter((payment) => positiveAmount(payment.amount) > 0 && !isSecurityEntry(payment));
  // A refund is money leaving on its own date, so it nets against the total
  // rather than editing the receipt it relates to.
  const signedAmount = (payment: PaymentEntry) => (payment.type === 'refund'
    ? -positiveAmount(payment.amount)
    : positiveAmount(payment.amount));
  const historyTotal = history.reduce((sum, payment) => sum + signedAmount(payment), 0);
  const actualPaid = recordedOrderPayment(order);
  const fallbackDate = dateKey(order.bookingDate || order.createdAt) || order.createdAt;
  const base = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    isCompletedOrder: order.orderStatus === 'completed',
    isRetainedDeposit: isRetainedCancellation(order),
  };

  const entries: CashCollection[] = history.map((payment: PaymentEntry, index) => ({
    ...base,
    id: payment.id,
    amount: signedAmount(payment),
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

/**
 * A voided expense keeps its original entry, and a separate reversal entry
 * cancels it from the date of the void. Summing a reversal with the opposite
 * sign leaves the month the expense was booked in untouched while the void
 * shows up in the month it actually happened.
 */
const entryCashEffect = (entry: CompanyFinanceEntry) =>
  (entry.isReversal ? -positiveAmount(entry.amount) : positiveAmount(entry.amount));

/**
 * A finance entry booked against a specific order is that order's cost, not a
 * company operating cost. Keeping it on one side only is what makes "counted
 * exactly once" true: it is deducted inside net order cash, on its own date,
 * and never again as a general expense.
 */
export const isOrderLinkedEntry = (entry: CompanyFinanceEntry) => Boolean(entry.linkedOrderId);

export const isGeneralOperatingEntry = (entry: CompanyFinanceEntry) => !isCapital(entry) && !isOrderLinkedEntry(entry);

/**
 * The actual money an order put into, or took out of, the company during one
 * month.
 *
 * This is cash, not forecast. Collections count on the date they were received
 * and refunds on the date the money went back. Costs follow when they are
 * really spent: `otherExpenses` at booking, because that is when the money
 * leaves, and worker and transport only once fulfillment has been recognized,
 * because before that they are a plan rather than a payment. Each cost is
 * therefore charged in exactly one month, and never in two.
 *
 * Cancellation changes nothing here. What was collected was collected, and a
 * refund is its own dated movement in its own month.
 */
export const netOrderCashContribution = (
  order: Order,
  orderEntries: readonly CompanyFinanceEntry[],
  year: number,
  month: number,
): number => {
  const collected = orderCashCollections(order)
    .filter((collection) => inMonth(dateKey(collection.date), year, month))
    .reduce((total, collection) => total + collection.amount, 0);

  // Booked and spent at registration, whatever month the event falls in.
  const bookedCosts = inMonth(dateKey(order.bookingDate || order.createdAt), year, month)
    ? positiveAmount(order.otherExpenses)
    : 0;

  // Recognized at fulfillment, charged to the execution month.
  const fulfillmentCosts = fulfillmentCostsRecognized(order) && inMonth(dateKey(order.eventDate || order.weddingDate), year, month)
    ? completedOrderFulfillmentCosts(order)
    : 0;

  const linkedCosts = orderEntries
    .filter((entry) => entry.linkedOrderId === order.id && inMonth(dateKey(entry.date), year, month))
    .reduce((total, entry) => total + entryCashEffect(entry), 0);

  return collected - bookedCosts - fulfillmentCosts - linkedCosts;
};

/**
 * What one order should be worth to the month it is scheduled in, if it runs
 * and is collected in full.
 *
 * This is a contract margin, not a cash figure: it uses the whole agreed price
 * rather than what has been collected so far, and all three direct costs
 * whether or not they have been paid yet. Refunds and collection timing are
 * deliberately absent - they belong to cash, and mixing them in here would
 * make the number answer neither question. Company salaries, rent and other
 * operating costs are absent for the same reason: they are treasury, not order
 * margin.
 *
 * A cancelled order is not going to happen, so it contributes nothing.
 */
/**
 * Retained cancellations carrying no cancellation date at all. Their profit is
 * unaffected - it follows the payment dates like every other retained
 * cancellation - so this reports a gap in the record's history, not a gap in
 * its accounting.
 */
export const retainedCancellationsMissingDate = (orders: readonly Order[]): Order[] =>
  orders.filter((order) => isRetainedCancellation(order)
    && !order.deletedAt
    && !order.cancelledAt
    && !(order.cancellationHistory || []).length);

/** `YYYY-MM` for the selected month, used to place an event before or after it. */
const monthKey = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}`;

/**
 * What the month is expected to be worth, from two sources that never overlap.
 *
 * An order executed in the month contributes its whole contract margin, however
 * little of it has been collected - the work is happening, so the month has
 * earned it. Payments received for that same order are deliberately not added
 * as well: its full value is already counted here, and adding the cash on top
 * would count the same money twice.
 *
 * An order scheduled for a later month contributes only the cash that actually
 * arrived this month, less any `otherExpenses` spent at booking. Its worker and
 * transport costs are not deducted yet because they are not owed until
 * fulfillment, and its margin belongs to the month it is executed in.
 *
 * A booking cancelled with its deposit kept is a third case: the money the
 * business keeps is profit, recognized in the month it was actually received.
 * Its execution date is irrelevant - it may have none - and so is the date it
 * was cancelled, because cancelling moves no money.
 *
 * Each order falls in exactly one section, so no amount is counted twice
 * within a month.
 */
export const expectedOrderProfitContribution = (order: Order, year: number, month: number): number => {
  // A deleted order is kept in the accounting dataset for the money it really
  // took, but the work will not happen, so it forecasts no margin. Its cash
  // contribution is unaffected and stays in `netOrderCashContribution`.
  if (order.deletedAt) return 0;

  const collections = orderCashCollections(order);
  /** Net contract money that moved in the selected month, by its own date. */
  const collectedInMonth = () => collections
    .filter((collection) => inMonth(dateKey(collection.date), year, month))
    .reduce((total, collection) => total + collection.amount, 0);

  /**
   * A booking cancelled with its money kept.
   *
   * The money the business keeps is profit, and it is recognized in the month
   * it was actually received - the same month its cash landed in - so the two
   * figures agree there instead of the profit appearing in a later month on
   * its own. A refund is the same movement in reverse, recognized in the month
   * the money went back; the month that originally reported the receipt keeps
   * its figure.
   *
   * `cancelledAt` and `cancellationHistory` stay stored and are still read for
   * lifecycle and history, but they no longer place this profit in a month: a
   * cancellation moves no money, so it can create none. Nothing here depends
   * on an event date either, because a retained booking may never have been
   * executed, or even scheduled, at all.
   */
  if (isRetainedCancellation(order)) return collectedInMonth();

  // A booking cancelled outright keeps nothing, so it forecasts no margin in
  // any month. What it collected and refunded stays on its real dates in
  // `netOrderCashContribution`, untouched.
  if (order.orderStatus === 'cancelled') return 0;

  const eventDate = dateKey(order.eventDate || order.weddingDate);

  // (A) Executed this month: the whole contract margin, collected or not.
  if (inMonth(eventDate, year, month)) {
    return positiveAmount(order.totalPrice)
      - positiveAmount(order.otherExpenses)
      - positiveAmount(order.workerCost)
      - positiveAmount(order.transportationCost);
  }

  // (B) Executed earlier: its margin was recognized in its own month, so a
  // payment arriving now is cash only.
  if ((eventDate || '').slice(0, 7) <= monthKey(year, month)) return 0;

  const selectedMonthStart = `${monthKey(year, month)}-01`;
  // Refunds net off naturally because their collections are already negative.
  const contractCollections = collections;
  const receivedThisMonth = contractCollections
    .filter((collection) => inMonth(dateKey(collection.date), year, month))
    .reduce((total, collection) => total + collection.amount, 0);
  const receivedEarlier = contractCollections
    .filter((collection) => (dateKey(collection.date) || '') < selectedMonthStart)
    .reduce((total, collection) => total + collection.amount, 0);

  // Anything paid beyond the agreed price is money owed back to the customer,
  // so it is customer credit rather than profit and is left out.
  const contractHeadroom = Math.max(0, positiveAmount(order.totalPrice) - receivedEarlier);
  const countedAdvance = Math.min(receivedThisMonth, contractHeadroom);

  // Deducted only in the month the booking cost was actually spent, so a
  // booking expense recognized earlier is never deducted a second time.
  const bookedCosts = inMonth(dateKey(order.bookingDate || order.createdAt), year, month)
    ? positiveAmount(order.otherExpenses)
    : 0;

  return countedAdvance - bookedCosts;
};

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
  // Everything that is not a completed order for this month and not a retained
  // cancellation - retained deposits have their own bucket. Cancelled orders
  // stay here deliberately: the money they received was really received, and a
  // cancellation must not delete it out of a month that was already reported.
  const isUpcomingForSelectedMonth = (order: Order) => !isRetainedCancellation(order)
    && !completedInSelectedMonth(order);
  const allCollections = orders.flatMap(orderCashCollections);
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
    .filter((order) => order.orderStatus !== 'cancelled' && !isRetainedCancellation(order)
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
  const capitalAdded = monthlyEntries.filter(isCapital).reduce((total, entry) => total + entryCashEffect(entry), 0);
  // General operating expenses are salaries, rent and the like. An expense
  // booked against an order is that order's cost and is deducted in net order
  // cash instead, so no cost is subtracted on both sides.
  const operatingExpenses = monthlyEntries
    .filter(isGeneralOperatingEntry)
    .reduce((total, entry) => total + entryCashEffect(entry), 0);
  const orderLinkedEntries = financeEntries.filter(isOrderLinkedEntry);

  // Worker/transport costs belong to completion. Other expenses belong only to
  // booking, including when looking back after the order has been completed.
  const otherExpensesThisMonth = (order: Order) => inMonth(dateKey(order.bookingDate || order.createdAt), year, month)
    ? positiveAmount(order.otherExpenses) : 0;
  // An expense booked against this order, spent on its own date.
  const linkedCostsThisMonth = (order: Order) => orderLinkedEntries
    .filter((entry) => entry.linkedOrderId === order.id && inMonth(dateKey(entry.date), year, month))
    .reduce((total, entry) => total + entryCashEffect(entry), 0);
  const completedCostsThisMonth = (order: Order) => completedOrderFulfillmentCosts(order) + otherExpensesThisMonth(order) + linkedCostsThisMonth(order);
  const recognizedThisMonth = (order: Order) => fulfillmentCostsRecognized(order)
    && inMonth(dateKey(order.eventDate || order.weddingDate), year, month);
  // Costs follow recognition, not the order's current operational status, so a
  // later `returned` cannot hand a closed month its fulfillment costs back.
  const completedOrderCosts = orders
    .filter(recognizedThisMonth)
    .reduce((total, order) => total + completedCostsThisMonth(order), 0);

  const completedWorkerTransportCosts = orders
    .filter((order) => fulfillmentCostsRecognized(order) && inMonth(dateKey(order.eventDate || order.weddingDate), year, month))
    .reduce((total, order) => total + completedOrderFulfillmentCosts(order), 0);

  const bookedOrderOtherExpenses = orders
    .filter((order) => !recognizedThisMonth(order))
    .reduce((total, order) => total + otherExpensesThisMonth(order) + linkedCostsThisMonth(order), 0);

  // Before fulfillment, only the "other expenses" field is treated as spent.
  // Worker and transport costs remain pending until the order is completed.
  // Deduct them in the booking month, even if execution is in a later month.
  const upcomingOrderOtherExpenses = bookedOrderOtherExpenses;
  // The report's "total expenses" card is deliberately limited to upcoming
  // orders. Worker and transport costs remain represented by completed-order
  // profit and the monthly net, not this card.
  const totalMonthlyOrderExpenses = upcomingOrderOtherExpenses;

  // Summed per order from the one definition, so every order - completed,
  // upcoming, cancelled or refunded - is treated by the same rule.
  const netOrderCash = orders.reduce((total, order) => total + netOrderCashContribution(order, orderLinkedEntries, year, month), 0);

  // A completed order includes only costs recognized in this month. Booking
  // expenses deducted in an earlier month must never be deducted on completion.
  // The completion month receives only payments actually collected during that
  // month. A deposit recorded in an earlier month has already affected that
  // earlier month's cash and must never be counted again on completion.
  const completedOrdersRevenue = collectedFromCompletedOrders;
  const completedOrdersNetProfit = completedOrdersRevenue - completedOrderCosts;
  const netMonthlyCash = netOrderCash;

  // This is the profit expected by the end of the selected month: every order
  // scheduled for execution in that month contributes its full price less all
  // direct costs, whether it has been settled yet or not. Retained cancelled
  // deposits are realised profit, and booking deposits received this month for
  // orders executing in a later month are included as requested cash profit.
  const executedOrdersNetProfit = orders
    .reduce((total, order) => total + expectedOrderProfitContribution(order, year, month), 0);
  // Expected profit is a contract margin: what the month's scheduled work is
  // worth if it all runs and is collected in full. Cash-flow terms - retained
  // deposits, advances taken this month for a later event - deliberately do
  // not belong in it; they are already reported as net order cash.
  const expectedOrderProfit = executedOrdersNetProfit;
  const netMonthlyOrderProfit = expectedOrderProfit;

  const completedOrdersNetProfitWithRetainedDeposits = completedOrdersNetProfit + retainedCancelledDeposits;
  // Before completion, only `otherExpenses` is an actual outflow.
  const upcomingOrderAdvancesNet = advancesFromUpcomingOrders - upcomingOrderOtherExpenses;
  const upcomingOrderDepositsNet = upcomingOrderDeposits - upcomingOrderOtherExpenses;
  const orderCashNet = netOrderCash;
  const cashMovement = orderCashNet + capitalAdded - operatingExpenses;

  const monthEnd = new Date(year, month + 1, 0);
  const expectedSafeBalance = calculateSafeBalanceToDate(orders, financeEntries, monthEnd);
  const collectedToDate = sum(allCollections.filter((collection) => onOrBeforeMonthEnd(dateKey(collection.date), year, month)));
  const completedCostsToDate = orders
    .filter((order) => fulfillmentCostsRecognized(order) && onOrBeforeMonthEnd(dateKey(order.eventDate || order.weddingDate), year, month))
    .reduce((total, order) => total + completedOrderFulfillmentCosts(order), 0);
  // Booking expenses stay deducted once, regardless of later completion or
  // cancellation.
  const bookedOrderOtherExpensesToDate = orders
    .filter((order) => onOrBeforeMonthEnd(dateKey(order.bookingDate || order.createdAt), year, month))
    .reduce((total, order) => total + positiveAmount(order.otherExpenses), 0);
  const linkedOrderCostsToDate = orderLinkedEntries
    .filter((entry) => onOrBeforeMonthEnd(dateKey(entry.date), year, month))
    .reduce((total, entry) => total + entryCashEffect(entry), 0);
  const orderCashBalanceToDate = collectedToDate - completedCostsToDate - bookedOrderOtherExpensesToDate - linkedOrderCostsToDate;

  const netMonthlyCashBreakdown: NetMonthlyCashBreakdownItem[] = [
    ...orders
      .filter(recognizedThisMonth)
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
      .filter((order) => !recognizedThisMonth(order))
      .map((order) => {
        const amount = sum(collections.filter((collection) => collection.orderId === order.id && !collection.isRetainedDeposit));
        return amount > 0 ? {
          id: `${order.id}-advance`, orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName,
          kind: 'upcoming-advance' as const, amount,
        } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
    ...orders
      .filter((order) => isRetainedCancellation(order))
      .map((order) => {
        const amount = sum(collections.filter((collection) => collection.orderId === order.id && collection.isRetainedDeposit));
        return amount > 0 ? {
          id: `${order.id}-retained`, orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName,
          kind: 'retained-deposit' as const, amount,
        } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
    ...orders
      .filter((order) => !recognizedThisMonth(order) && otherExpensesThisMonth(order) + linkedCostsThisMonth(order) > 0)
      .map((order) => ({
        id: `${order.id}-expense`, orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName,
        kind: 'upcoming-expense' as const, amount: -(otherExpensesThisMonth(order) + linkedCostsThisMonth(order)),
      })),
  ];

  return {
    netOrderCash,
    expectedOrderProfit,
    generalOperatingExpenses: operatingExpenses,
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
