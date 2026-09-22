/**
 * Which months a company's financial analytics must calculate.
 *
 * The period list used to be built from event months alone, so any month that
 * carried money but held no wedding simply did not exist in the report: a
 * deposit taken in March for a June event, a refund paid out weeks after the
 * job, a late settlement, a month of rent and salaries during the off season.
 * Those months were not shown as zero - they were absent, which is worse,
 * because nothing on screen suggested anything was missing.
 *
 * A month is therefore included when any financial date the analytics already
 * consumes falls in it. This only widens the set of periods calculated; the
 * formula applied to each period is untouched.
 */
const MONTH = /^(\d{4})-(\d{2})/;

const monthOf = (value: unknown): string | null => {
  const text = String(value || '');
  const matched = text.match(MONTH);
  return matched ? `${matched[1]}-${matched[2]}` : null;
};

export interface FinancialMonthOrder {
  eventDate?: unknown;
  weddingDate?: unknown;
  bookingDate?: unknown;
  createdAt?: unknown;
  orderStatus?: unknown;
  paymentHistory?: unknown;
  otherExpenses?: unknown;
}

export interface FinancialMonthEntry {
  date?: unknown;
  deletedAt?: unknown;
}

const positive = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

/** Every month in which this order moved money in any way the report reads. */
export const orderFinancialMonths = (order: FinancialMonthOrder): string[] => {
  const months: string[] = [];
  const add = (value: string | null) => { if (value) months.push(value); };

  // Execution: fulfillment costs and completed-order revenue land here.
  add(monthOf(order.eventDate) || monthOf(order.weddingDate));
  // Booking: `otherExpenses` is charged in the booking month even when the
  // event is much later, so that month has a movement of its own.
  if (positive(order.otherExpenses) > 0) add(monthOf(order.bookingDate) || monthOf(order.createdAt));
  // Every deposit, settlement and refund sits on its own date.
  if (Array.isArray(order.paymentHistory)) {
    for (const payment of order.paymentHistory) {
      const entry = payment as Record<string, unknown>;
      if (positive(entry?.amount) <= 0) continue;
      add(monthOf(entry?.date));
    }
  }
  return months;
};

/** Months in which a capital or expense entry moved money. */
export const entryFinancialMonths = (entries: readonly FinancialMonthEntry[]): string[] =>
  entries.filter((entry) => !entry.deletedAt).map((entry) => monthOf(entry.date)).filter((month): month is string => Boolean(month));

/**
 * The full set of months to calculate, newest first. `orderCount` keeps its
 * original meaning - orders whose event falls in that month - so a
 * movement-only month correctly reports zero orders rather than being omitted.
 */
export const platformFinancialMonths = (
  orders: readonly FinancialMonthOrder[],
  orderEventMonths: readonly string[],
  entries: readonly FinancialMonthEntry[],
): Array<{ month: string; orderCount: number }> => {
  const months = new Set<string>();
  for (const order of orders) for (const month of orderFinancialMonths(order)) months.add(month);
  for (const month of entryFinancialMonths(entries)) months.add(month);
  for (const month of orderEventMonths) if (month) months.add(month);

  return [...months]
    .map((month) => ({ month, orderCount: orderEventMonths.filter((candidate) => candidate === month).length }))
    .sort((a, b) => b.month.localeCompare(a.month));
};
