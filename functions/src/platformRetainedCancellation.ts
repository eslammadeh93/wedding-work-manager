/**
 * The platform-side monthly order accounts.
 *
 * This is the same arithmetic the app publishes, kept in its own module so it
 * can be tested without initialising firebase-admin. Three things differ from
 * what `index.ts` used to do inline, and each is the app's own rule:
 *
 *  - a booking cancelled with its money kept is recognised through
 *    `isPlatformRetainedCancellation`, which tolerates the status spellings
 *    that legacy records actually carry;
 *  - its retained profit follows the payment and refund dates, never the
 *    event, wedding or cancellation date; and
 *  - a plainly cancelled booking keeps its real cash on its real dates. It
 *    earns nothing and forecasts nothing, but the money it genuinely took is
 *    no longer deleted from the company's cash.
 *
 * Every published figure keeps the expression it had.
 */

export type PlatformCashOrder = {
  id: string; orderNumber: string; customerName: string; orderStatus: string; totalPrice: number; deposit: number; totalPaid: number;
  bookingDate: string; eventDate: string; weddingDate: string; createdAt: string; workerCost: number; transportationCost: number; otherExpenses: number;
  paymentMethod: string; paymentHistory: Array<Record<string, unknown>>;
  /** Stamped the first time the order completed; empty when it never has. */
  fulfillmentRecognizedAt: string;
};

export type PlatformCashCollection = {
  orderId: string;
  amount: number;
  date: string;
  paymentType: string;
  retained: boolean;
};

/**
 * Whether a booking was cancelled with its money kept.
 *
 * The stored status is normalised before it is compared, exactly as the app
 * does: a record written by an older version, an import or a hand edit can
 * carry the same status with different spacing, casing or separators, and a
 * strict comparison drops it out of every retained rule. It reads the stored
 * value tolerantly and never rewrites it.
 */
export const isPlatformRetainedCancellation = (orderStatus: unknown): boolean =>
  String(orderStatus || '').trim().toLowerCase().replace(/[\s-]+/g, '_') === 'cancelled_deposit_retained';

/** Legacy security movements. They are held money, never contract money. */
const isPlatformSecurityEntry = (type: unknown): boolean => {
  const value = String(type || '');
  return value === 'security_deposit' || value === 'security_refund';
};

const isPlatformRefundEntry = (type: unknown): boolean => String(type || '') === 'refund';

export const platformNumber = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

export const platformMonthMatches = (value: string, month: string): boolean => value.startsWith(`${month}-`);

/**
 * Whether the order's worker and transportation costs have been financially
 * recognized.
 *
 * Recognition happens on completion and is then permanent, so a later status
 * change - `completed` to `returned` above all - cannot un-spend money a
 * closed month already reported. Records written before the stamp existed
 * fall back to the current status, which is what the app does.
 */
export const platformFulfillmentRecognized = (order: Pick<PlatformCashOrder, 'orderStatus' | 'fulfillmentRecognizedAt'>): boolean =>
  order.orderStatus === 'completed' || Boolean(order.fulfillmentRecognizedAt);

/** Worker and transport, counted only once fulfillment has been recognized. */
const platformFulfillmentCosts = (order: PlatformCashOrder): number =>
  (platformFulfillmentRecognized(order) ? platformNumber(order.workerCost) + platformNumber(order.transportationCost) : 0);

/**
 * A voided expense keeps its original entry and a dated reversal cancels it,
 * so a reversal subtracts rather than adding a second time.
 */
const platformEntryCashEffect = (entry: Record<string, unknown>): number =>
  (entry.isReversal === true ? -platformNumber(entry.amount) : platformNumber(entry.amount));

/** An entry booked against an order is that order's cost, never overhead. */
export const isPlatformOrderLinkedEntry = (entry: Record<string, unknown>): boolean => Boolean(entry.linkedOrderId);

/**
 * One order's contract money, each amount on the date it actually moved.
 *
 * A refund is money leaving, so it subtracts on its own refund date rather
 * than editing the receipt it relates to. Security movements are excluded
 * entirely: they are the customer's money and contribute nothing anywhere.
 */
export const platformCashCollections = (
  order: PlatformCashOrder,
  platformDate: (value: unknown) => string,
): PlatformCashCollection[] => {
  const retained = isPlatformRetainedCancellation(order.orderStatus);
  const history = order.paymentHistory
    .filter(payment => platformNumber(payment.amount) > 0 && !isPlatformSecurityEntry(payment.type));
  const signed = (payment: Record<string, unknown>) =>
    (isPlatformRefundEntry(payment.type) ? -platformNumber(payment.amount) : platformNumber(payment.amount));
  const historyTotal = history.reduce((sum, payment) => sum + signed(payment), 0);
  const actualPaid = order.totalPaid > 0 ? order.totalPaid : Math.max(order.deposit, historyTotal);
  const fallbackDate = order.bookingDate || order.createdAt;
  const entries = history.map((payment, index) => {
    const amount = signed(payment);
    const date = platformDate(payment.date) || fallbackDate;
    const explicitType = payment.type === 'deposit' || payment.type === 'settlement' ? payment.type : '';
    const paymentType = isPlatformRefundEntry(payment.type)
      ? 'refund'
      : explicitType || (index === 0 && (date === fallbackDate || amount <= order.deposit) ? 'deposit' : 'settlement');
    return { orderId: order.id, amount, date, paymentType, retained };
  });
  if (actualPaid > historyTotal) {
    entries.push({
      orderId: order.id,
      amount: actualPaid - historyTotal,
      date: order.orderStatus === 'completed' ? (order.eventDate || order.weddingDate || fallbackDate) : fallbackDate,
      paymentType: history.length === 0 && order.deposit > 0 ? 'deposit' : 'settlement',
      retained,
    });
  }
  return entries;
};

/**
 * The actual money one order put into, or took out of, the company during one
 * month. This is the app's `netOrderCashContribution`, term for term.
 *
 * Collections count on the day they were received and refunds on the day the
 * money went back. Costs follow when they are really spent: `otherExpenses` at
 * booking, because that is when the money leaves, and worker and transport
 * only once fulfillment has been recognized, charged to the execution month.
 * Each cost is therefore charged in exactly one month, and never in two.
 *
 * Cancellation changes nothing here. What was collected was collected, and a
 * refund is its own dated movement in its own month.
 */
export const platformNetOrderCashContribution = (
  order: PlatformCashOrder,
  orderLinkedEntries: Array<Record<string, unknown>>,
  month: string,
  platformDate: (value: unknown) => string,
): number => {
  const collected = platformCashCollections(order, platformDate)
    .filter(collection => platformMonthMatches(collection.date, month))
    .reduce((total, collection) => total + collection.amount, 0);

  // Booked and spent at registration, whatever month the event falls in.
  const bookedCosts = platformMonthMatches(order.bookingDate || order.createdAt, month)
    ? platformNumber(order.otherExpenses)
    : 0;

  // Recognized at fulfillment, charged to the execution month.
  const fulfillmentCosts = platformFulfillmentRecognized(order)
    && platformMonthMatches(order.eventDate || order.weddingDate, month)
    ? platformFulfillmentCosts(order)
    : 0;

  const linkedCosts = orderLinkedEntries
    .filter(entry => entry.linkedOrderId === order.id && platformMonthMatches(platformDate(entry.date), month))
    .reduce((total, entry) => total + platformEntryCashEffect(entry), 0);

  return collected - bookedCosts - fulfillmentCosts - linkedCosts;
};

export const platformMonthlyAccounts = (
  orders: PlatformCashOrder[],
  expenses: Array<Record<string, unknown>>,
  month: string,
  platformDate: (value: unknown) => string,
) => {
  const monthEnd = `${month}-31`;
  const eventDate = (order: PlatformCashOrder) => order.eventDate || order.weddingDate;
  const completedInMonth = (order: PlatformCashOrder) => order.orderStatus === 'completed' && platformMonthMatches(eventDate(order), month);
  const isCancelledEitherWay = (order: PlatformCashOrder) => order.orderStatus === 'cancelled' || isPlatformRetainedCancellation(order.orderStatus);
  /**
   * The cash bucket for everything that is neither completed this month nor a
   * retained cancellation, which has its own bucket.
   *
   * A plainly cancelled booking belongs here: cancelling it did not un-receive
   * the money it took, so its payments stay in the month they arrived and its
   * refunds subtract in the month they went back, exactly as the app reports
   * them. It is still kept out of every profit and forecast figure below.
   */
  const upcoming = (order: PlatformCashOrder) => !isPlatformRetainedCancellation(order.orderStatus) && !completedInMonth(order);
  // Every order's real money is collected here. Dropping cancelled bookings
  // used to delete cash the company genuinely received from the platform view.
  const allCollections = orders.flatMap(order => platformCashCollections(order, platformDate));
  const collections = allCollections.filter(collection => platformMonthMatches(collection.date, month));
  const sum = (items: Array<{ amount: number }>) => items.reduce((total, item) => total + item.amount, 0);
  const byId = new Map(orders.map(order => [order.id, order]));
  const collectedFromCompletedOrders = sum(collections.filter(collection => { const order = byId.get(collection.orderId); return Boolean(order && completedInMonth(order)); }));
  // Retained profit: the net contract money that moved this month, on its own
  // dates. The cancellation itself recognises nothing, because it moves none.
  const retainedCancelledDeposits = sum(collections.filter(collection => collection.retained));
  const advancesFromUpcomingOrders = sum(collections.filter(collection => { const order = byId.get(collection.orderId); return Boolean(order && upcoming(order) && !collection.retained); }));
  const standardCollections = collections.filter(collection => !collection.retained);
  const totalDepositsPaid = sum(standardCollections.filter(collection => collection.paymentType === 'deposit')) + retainedCancelledDeposits;
  const totalSettlementPayments = sum(standardCollections.filter(collection => collection.paymentType === 'settlement'));
  const grossMonthlyIncome = totalDepositsPaid + totalSettlementPayments;
  const expectedSettlementPayments = orders.filter(order => !isCancelledEitherWay(order) && platformMonthMatches(eventDate(order), month)).reduce((total, order) => total + Math.max(0, order.totalPrice - (order.totalPaid > 0 ? order.totalPaid : order.deposit)), 0);
  const upcomingOrderDeposits = sum(collections.filter(collection => { const order = byId.get(collection.orderId); return Boolean(order && upcoming(order) && !collection.retained && collection.paymentType === 'deposit'); }));
  // An entry booked against an order is that order's cost and is deducted
  // inside net order cash on its own date, so it is never also charged here as
  // company overhead. That is what makes "counted exactly once" true.
  const orderLinkedEntries = expenses.filter(expense => isPlatformOrderLinkedEntry(expense) && !expense.deletedAt);
  const operatingExpenses = expenses.filter(expense => platformMonthMatches(platformDate(expense.date), month) && expense.type !== 'capital' && String(expense.category || '') !== 'رأس مال' && !expense.deletedAt && !isPlatformOrderLinkedEntry(expense)).reduce((total, expense) => total + platformNumber(expense.amount), 0);
  const bookedInMonth = (order: PlatformCashOrder) => platformMonthMatches(order.bookingDate || order.createdAt, month);
  // Booking expenses are spent before fulfillment and must not be charged again
  // when an order booked in an earlier month is completed.
  const completedOrderCosts = orders.filter(completedInMonth).reduce((total, order) => total + order.workerCost + order.transportationCost + (bookedInMonth(order) ? order.otherExpenses : 0), 0);
  const upcomingOrderOtherExpenses = orders.filter(order => upcoming(order) && bookedInMonth(order)).reduce((total, order) => total + order.otherExpenses, 0);
  const completedOrdersNetProfit = collectedFromCompletedOrders - completedOrderCosts;
  // Net order cash is summed per order from the one definition the app uses,
  // so every order - completed, upcoming, cancelled or refunded - is treated
  // by the same rule. Capital is deliberately absent: it is treasury, not
  // money the orders themselves generated.
  const netMonthlyCash = orders.reduce(
    (total, order) => total + platformNetOrderCashContribution(order, orderLinkedEntries, month, platformDate),
    0,
  );
  const executedOrdersNetProfit = orders.filter(order => !isCancelledEitherWay(order) && platformMonthMatches(eventDate(order), month)).reduce((total, order) => total + order.totalPrice - order.otherExpenses - order.workerCost - order.transportationCost, 0);
  const futureExecutionBookingDeposits = orders.filter(order => !isCancelledEitherWay(order) && platformMonthMatches(order.bookingDate || order.createdAt, month) && eventDate(order) > monthEnd).flatMap(order => platformCashCollections(order, platformDate)).filter(collection => platformMonthMatches(collection.date, month) && collection.paymentType === 'deposit').reduce((total, collection) => total + collection.amount, 0);
  return { month, netMonthlyCash, grossMonthlyIncome, completedOrdersNetProfit, retainedCancelledDeposits, upcomingOrderDepositsNet: upcomingOrderDeposits - upcomingOrderOtherExpenses, upcomingOrderOtherExpenses, netMonthlyOrderProfit: executedOrdersNetProfit + retainedCancelledDeposits + futureExecutionBookingDeposits, expectedSettlementPayments, operatingExpenses };
};
