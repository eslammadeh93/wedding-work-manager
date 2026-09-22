import type { FinancialHistoryStatus } from '../multiTenant/data/financialHistory';

/**
 * Whether a financial figure is safe to present as authoritative.
 *
 * Two different gaps used to be indistinguishable from real zeros. A user with
 * Reports access but no expense permission received an empty expense array and
 * saw totals computed as if the company had spent nothing, so an owner and a
 * manager were shown different numbers with neither marked as partial. And a
 * failed history page left the screen showing whatever had loaded so far.
 *
 * Missing data is therefore modelled explicitly: a metric is either available
 * or it names the reason it is not, and the reason is rendered instead of a
 * number. Nothing here widens anybody's permissions - a metric the viewer
 * cannot source is withheld, not fetched by other means.
 */
export type FinancialMetricState =
  | { available: true }
  | { available: false; reason: 'loading' | 'permission' | 'error' | 'incomplete'; message: string };

export type ExpenseAccess = 'granted' | 'denied';

export interface FinancialInputs {
  historyStatus: FinancialHistoryStatus | undefined;
  historyLoading: boolean;
  historyMessage?: string;
  expenseAccess: ExpenseAccess;
}

const MESSAGES = {
  loading: 'جارٍ تحميل السجل المالي…',
  permission: 'هذا الرقم يحتاج صلاحية عرض المالية والمصروفات، وهي غير متاحة لحسابك.',
  error: 'تعذر تحميل السجل المالي، لذلك لا يمكن عرض رقم نهائي.',
  incomplete: 'السجل المالي غير مكتمل، لذلك لا يمكن عرض رقم نهائي.',
} as const;

const unavailable = (reason: 'loading' | 'permission' | 'error' | 'incomplete', message?: string): FinancialMetricState =>
  ({ available: false, reason, message: message || MESSAGES[reason] });

/** A metric built only from orders. Expense permission is irrelevant to it. */
export const orderMetricState = (inputs: FinancialInputs): FinancialMetricState => {
  if (inputs.historyLoading) return unavailable('loading');
  if (inputs.historyStatus === 'error') return unavailable('error', inputs.historyMessage);
  if (inputs.historyStatus === 'truncated') return unavailable('incomplete', inputs.historyMessage);
  if (inputs.historyStatus !== 'complete') return unavailable('loading');
  return { available: true };
};

/**
 * A metric that also consumes expenses or capital. Without expense access the
 * inputs are not zero, they are unknown, so the metric is withheld.
 */
export const expenseMetricState = (inputs: FinancialInputs): FinancialMetricState => {
  if (inputs.expenseAccess === 'denied') return unavailable('permission');
  return orderMetricState(inputs);
};

/**
 * Exports carry numbers out of the app, where nothing signals that they were
 * partial, so they are blocked unless every input is complete.
 */
export const financialExportAllowed = (inputs: FinancialInputs): boolean =>
  expenseMetricState(inputs).available;

export const financialExportBlockedReason = (inputs: FinancialInputs): string | null => {
  const state = expenseMetricState(inputs);
  return state.available === true ? null : state.message;
};
