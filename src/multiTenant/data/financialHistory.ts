import type { Order } from '../../types';
import { companyDataService, type DataOperationResult, type PageResult } from './companyDataService';

/**
 * The one loader for financial order history.
 *
 * Finance and Reports both need every order that carries money, not the short
 * operational window the live listener keeps. They used to run their own
 * near-identical paging loops, which is how they drifted apart: one used the
 * operational scope, one fell back to the operational list when a page failed,
 * and neither could tell a complete dataset from a truncated one.
 *
 * The rule here is that the result always says how complete it is, and a
 * caller that wants authoritative totals must refuse to show them unless the
 * status is `complete`. Nothing in this module ever substitutes the
 * operational list for history it failed to load.
 */
export type FinancialHistoryStatus = 'complete' | 'truncated' | 'error';

export interface FinancialHistoryResult {
  records: Order[];
  status: FinancialHistoryStatus;
  /** Set when the dataset is not complete, for display to the user. */
  message?: string;
  pagesRead: number;
}

export type OrderPageFetcher = (request: {
  scope: 'financial';
  pageSize: number;
  cursor: PageResult<Order>['cursor'];
}) => Promise<DataOperationResult<PageResult<Order>>>;

export interface FinancialHistoryOptions {
  pageSize?: number;
  /** A hard ceiling so a runaway loop can never page forever. */
  maxPages?: number;
  fetchPage?: OrderPageFetcher;
}

const TRUNCATED_MESSAGE = 'تجاوزت بيانات الفترة حد التحميل؛ الأرقام المعروضة غير مكتملة.';
const DEFAULT_ERROR = 'تعذر تحميل السجل المالي.';

export const loadFinancialOrderHistory = async (
  companyId: string,
  { pageSize = 100, maxPages = 200, fetchPage }: FinancialHistoryOptions = {},
): Promise<FinancialHistoryResult> => {
  const fetch: OrderPageFetcher = fetchPage
    ?? ((request) => companyDataService.getOrderPage<Order>(companyId, request));

  const byId = new Map<string, Order>();
  let cursor: PageResult<Order>['cursor'] = null;
  let pagesRead = 0;

  while (pagesRead < maxPages) {
    const result = await fetch({ scope: 'financial', pageSize, cursor });
    pagesRead += 1;
    if (!result.success || !result.data) {
      // A failed page makes the whole dataset untrustworthy. It is reported as
      // an error rather than returned as a shorter, plausible-looking list.
      return { records: [], status: 'error', message: result.message || DEFAULT_ERROR, pagesRead };
    }
    // Keyed by id so an overlapping scan window can never double-count an
    // order into the totals.
    for (const record of result.data.records) byId.set(record.id, record);
    if (!result.data.hasMore || !result.data.cursor) {
      return { records: [...byId.values()], status: 'complete', pagesRead };
    }
    cursor = result.data.cursor;
  }

  return { records: [...byId.values()], status: 'truncated', message: TRUNCATED_MESSAGE, pagesRead };
};

/** Authoritative totals may only be shown, or exported, from a complete dataset. */
export const financialHistoryIsComplete = (status: FinancialHistoryStatus | undefined): boolean => status === 'complete';
