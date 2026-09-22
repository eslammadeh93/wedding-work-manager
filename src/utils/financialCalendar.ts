import type { Order } from '../types';

/**
 * Calendar handling for financial grouping.
 *
 * Two mistakes kept moving money into the wrong period. The first is month
 * arithmetic that keeps the current day: `setMonth(getMonth() - 1)` on the
 * 31st of March asks for the 31st of February, which JavaScript rolls forward
 * into March, so "last month" comes back as March again and February is never
 * reported at all. Every month here is therefore built from day 1, which no
 * month is ever short of.
 *
 * The second is parsing a date-only value as an instant. `new Date('2026-08-01')`
 * is midnight UTC, and reading it back with local getters lands on 2026-07-31
 * anywhere west of Greenwich - a receipt silently booked to the previous month,
 * and in January to the previous year. A `YYYY-MM-DD` value is a calendar day,
 * not a moment, so it is read literally and never converted.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * The calendar day a financial value belongs to, as `YYYY-MM-DD`.
 *
 * A date-only string is taken at face value. Anything else is a real instant
 * (`createdAt` and friends) and is read in the viewer's own timezone, which is
 * the calendar they work in.
 */
export const financialDateKey = (value?: string | null): string | null => {
  if (!value) return null;
  const matched = String(value).match(DATE_ONLY);
  if (matched) return matched[0];
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** The `YYYY-MM` bucket a financial value belongs to. */
export const financialMonthKey = (value?: string | null): string | null => financialDateKey(value)?.slice(0, 7) ?? null;

/** The calendar year a financial value belongs to. */
export const financialYear = (value?: string | null): number | null => {
  const key = financialDateKey(value);
  return key ? Number(key.slice(0, 4)) : null;
};

export const monthKeyOf = (year: number, month: number): string => `${year}-${String(month + 1).padStart(2, '0')}`;

/** True when the value falls in the given year and zero-based month. */
export const isInFinancialMonth = (value: string | null | undefined, year: number, month: number): boolean =>
  financialMonthKey(value) === monthKeyOf(year, month);

export const isInFinancialYear = (value: string | null | undefined, year: number): boolean => financialYear(value) === year;

/**
 * A month as a stable anchor: always day 1, so shifting it can never skip or
 * repeat a month, and midday so no daylight-saving transition can move it.
 */
export const monthAnchor = (year: number, month: number): Date => new Date(year, month, 1, 12);

/** Moves a month anchor by whole months, correct across year boundaries. */
export const shiftMonths = (anchor: Date, delta: number): Date =>
  monthAnchor(anchor.getFullYear(), anchor.getMonth() + delta);

export interface FinancialMonthWindow {
  key: string;
  year: number;
  /** Zero-based, matching `Date.getMonth`. */
  month: number;
  anchor: Date;
}

/**
 * The last `count` months ending with the one containing `from`, oldest first.
 * Built by shifting a day-1 anchor, so March never reports February twice.
 */
export const recentMonthWindows = (count: number, from = new Date()): FinancialMonthWindow[] => {
  const base = monthAnchor(from.getFullYear(), from.getMonth());
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const anchor = shiftMonths(base, index - (count - 1));
    return { key: monthKeyOf(anchor.getFullYear(), anchor.getMonth()), year: anchor.getFullYear(), month: anchor.getMonth(), anchor };
  });
};

const positiveAmount = (value: unknown): number => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

/**
 * Every date on an order at which money moved, in whatever way the financial
 * screens already read it. Mirrors `functions/src/platformFinancialMonths.ts`,
 * which does the same job for the platform analytics.
 */
export const orderFinancialDates = (order: Order): string[] => {
  const dates: string[] = [];
  const add = (value?: string | null) => { const key = financialDateKey(value); if (key) dates.push(key); };

  add(order.eventDate || order.weddingDate);
  // A booking date matters financially when something was actually charged to
  // it; `otherExpenses` is spent in the booking month even for a later event.
  if (positiveAmount(order.otherExpenses) > 0) add(order.bookingDate || order.createdAt);
  // Deposits, settlements and refunds each sit on their own date.
  for (const payment of order.paymentHistory || []) {
    if (positiveAmount(payment.amount) <= 0) continue;
    add(payment.date);
  }
  return dates;
};

/**
 * The years a report can meaningfully be run for: any year holding a financial
 * movement, not only years that happen to contain an event. A year whose only
 * activity was a deposit, a refund, or rent and salaries is still a year with
 * books to show.
 */
export const availableFinancialYears = (
  orders: readonly Order[],
  entries: readonly { date?: string }[] = [],
  today = new Date(),
): number[] => {
  const years = new Set<number>([today.getFullYear()]);
  const add = (value?: string | null) => { const year = financialYear(value); if (year) years.add(year); };

  for (const order of orders) for (const date of orderFinancialDates(order)) add(date);
  // A voided entry keeps its original month as evidence, so its year stays
  // selectable; Phase 2 cancels it with a dated reversal, not by erasure.
  for (const entry of entries) add(entry.date);

  return [...years].sort((a, b) => b - a);
};
