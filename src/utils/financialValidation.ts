import type { Expense, Order, PaymentEntry } from '../types';
import { paymentStatusFor } from './orderPaymentState';

/**
 * Client-side guards for financial writes. They mirror the Firestore rules so
 * a broken value is refused before it reaches the database, and they are kept
 * deliberately narrow: every shape a valid existing record can have must still
 * pass.
 */
export class FinancialValidationError extends Error {
  readonly code = 'INVALID_FINANCIAL_DATA';
  constructor(message: string) {
    super(message);
    this.name = 'FinancialValidationError';
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const fail = (message: string): never => {
  throw new FinancialValidationError(message);
};

/**
 * Accepts `YYYY-MM-DD` and the full ISO timestamps the app writes, and nothing
 * else: locale formats such as `01/09/2026` are ambiguous and would land in a
 * different month depending on who typed them.
 */
export const isValidFinancialDate = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!DATE_ONLY.test(trimmed.slice(0, 10))) return false;
  return !Number.isNaN(Date.parse(trimmed));
};

/**
 * The business trades in whole Egyptian pounds. There is no half-pound, so a
 * fractional amount is a typing mistake rather than a smaller unit.
 *
 * It is rejected, never rounded: silently turning 1,500.50 into 1,501 or
 * 1,500 invents money nobody agreed to, and the person entering it would
 * never know. A numeric string is rejected for the same reason - it is a
 * symptom of an input path that has not been checked, and accepting it lets
 * "1500" and 1500 drift apart in storage.
 */
export const isWholeEgp = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);

const assertAmount = (value: unknown, label: string, { allowZero = true } = {}): number => {
  if (typeof value === 'string') fail(`قيمة ${label} يجب أن تكون رقمًا.`);
  const amount = Number(value);
  if (!Number.isFinite(amount)) fail(`قيمة ${label} غير صالحة.`);
  if (amount < 0) fail(`قيمة ${label} لا يمكن أن تكون سالبة.`);
  if (!allowZero && amount === 0) fail(`قيمة ${label} يجب أن تكون أكبر من صفر.`);
  if (!Number.isInteger(amount)) {
    fail(`قيمة ${label} يجب أن تكون بالجنيه الصحيح بدون كسور.`);
  }
  return amount;
};

const MONEY_FIELDS = [
  'totalPrice', 'deposit', 'totalPaid', 'remainingBalance', 'securityDeposit',
  'workerCost', 'transportationCost', 'otherExpenses',
] as const;

/**
 * Money fields on a stored record that are not whole pounds.
 *
 * Records written before this rule existed are left exactly as they are: an
 * unrelated edit must not quietly re-round somebody's historical figure. They
 * are reported here instead, so the bad data is visible and can be corrected
 * deliberately.
 */
export const legacyFractionalFinancialFields = (record: Record<string, unknown> | undefined): string[] => {
  if (!record) return [];
  const flagged = MONEY_FIELDS.filter((field) => {
    const value = record[field];
    return value !== undefined && value !== null && !isWholeEgp(value);
  }) as string[];
  for (const entry of (record.paymentHistory as { id?: string; amount?: unknown }[] | undefined) || []) {
    if (entry && entry.amount !== undefined && !isWholeEgp(entry.amount)) flagged.push(`paymentHistory:${entry.id || '?'}`);
  }
  return flagged;
};

export const assertValidPaymentHistory = (history: readonly PaymentEntry[], previous?: readonly PaymentEntry[]): void => {
  if (!Array.isArray(history)) fail('سجل الدفعات غير صالح.');
  // An entry that is already stored is left alone; only what this write adds
  // or changes has to satisfy the whole-pound rule.
  const unchanged = new Map((previous || []).map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  for (const entry of history) {
    const stored = unchanged.get(entry?.id);
    if (stored && stored.amount === entry.amount && stored.date === entry.date) continue;
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim()) fail('دفعة بدون معرّف صالح.');
    if (seen.has(entry.id)) fail('لا يمكن تكرار نفس الدفعة مرتين.');
    seen.add(entry.id);
    // A zero-value entry is never a real collection; it only corrupts reports.
    assertAmount(entry.amount, 'الدفعة', { allowZero: false });
    if (!isValidFinancialDate(entry.date)) fail('تاريخ الدفعة غير صالح.');
  }
};

export type OrderFinancialWrite = Partial<Pick<Order,
  'totalPrice' | 'deposit' | 'totalPaid' | 'remainingBalance' | 'paymentStatus' | 'paymentHistory'
  | 'securityDeposit' | 'workerCost' | 'transportationCost' | 'otherExpenses'
  | 'bookingDate' | 'eventDate' | 'weddingDate' | 'deliveryDate' | 'returnDate'>>;

/** Validates the financial half of an order create/update payload. */
export const assertValidOrderFinancials = (write: OrderFinancialWrite, previous?: OrderFinancialWrite): void => {
  const amounts: [keyof OrderFinancialWrite, string][] = [
    ['totalPrice', 'إجمالي السعر'], ['deposit', 'العربون'], ['totalPaid', 'المدفوع'],
    ['remainingBalance', 'المتبقي'], ['securityDeposit', 'التأمين'], ['workerCost', 'أجرة العامل'],
    ['transportationCost', 'الانتقالات'], ['otherExpenses', 'مصاريف أخرى'],
  ];
  for (const [key, label] of amounts) {
    const value = write[key];
    if (value === undefined || value === null) continue;
    // A legacy fractional figure that this write is not changing passes
    // through untouched rather than blocking an unrelated edit or being
    // rounded into a different number.
    if (previous && previous[key] === value && !isWholeEgp(value)) continue;
    assertAmount(value, label);
  }

  for (const key of ['bookingDate', 'eventDate', 'weddingDate', 'deliveryDate', 'returnDate'] as const) {
    const value = write[key];
    // An empty string deliberately clears an optional date.
    if (value !== undefined && value !== null && value !== '' && !isValidFinancialDate(value)) fail('تاريخ غير صالح في بيانات الأوردر.');
  }

  if (write.paymentHistory !== undefined) assertValidPaymentHistory(write.paymentHistory, previous?.paymentHistory);

  if (write.totalPaid !== undefined && write.totalPrice !== undefined && write.remainingBalance !== undefined) {
    const expected = Math.max(0, Number(write.totalPrice) - Number(write.totalPaid));
    if (Math.abs(expected - Number(write.remainingBalance)) > 0.01) fail('الرصيد المتبقي لا يطابق المدفوع.');
  }
  if (write.totalPaid !== undefined && write.totalPrice !== undefined && write.paymentStatus !== undefined) {
    if (paymentStatusFor(Number(write.totalPaid), Number(write.totalPrice)) !== write.paymentStatus) fail('حالة السداد لا تطابق المبالغ المسجلة.');
  }
};

export type ExpenseWrite = Partial<Pick<Expense, 'amount' | 'date' | 'type' | 'category' | 'linkedOrderId'>>;

export const assertValidExpense = (write: ExpenseWrite, isKnownOrderId?: (orderId: string) => boolean, previous?: ExpenseWrite): void => {
  if (write.amount !== undefined && !(previous && previous.amount === write.amount && !isWholeEgp(write.amount))) {
    assertAmount(write.amount, 'المصروف', { allowZero: false });
  }
  if (write.date !== undefined && !isValidFinancialDate(write.date)) fail('تاريخ المصروف غير صالح.');
  if (write.linkedOrderId !== undefined && write.linkedOrderId !== null && write.linkedOrderId !== '') {
    if (typeof write.linkedOrderId !== 'string') fail('الطلب المرتبط غير صالح.');
    if (isKnownOrderId && !isKnownOrderId(write.linkedOrderId)) fail('الطلب المرتبط لا يتبع الشركة الحالية.');
  }
};
