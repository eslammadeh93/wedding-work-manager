import assert from 'node:assert/strict';
import test from 'node:test';
import type { Order } from '../src/types';
import type { PageResult } from '../src/multiTenant/data/companyDataService';
import { loadFinancialOrderHistory, financialHistoryIsComplete, type OrderPageFetcher } from '../src/multiTenant/data/financialHistory';
import {
  expenseMetricState,
  financialExportAllowed,
  financialExportBlockedReason,
  orderMetricState,
  type FinancialInputs,
} from '../src/utils/financialAvailability';
import { calculateSafeBalanceToDate } from '../src/utils/monthlyCash';
import { financialHistoryOrders } from '../src/utils/financialRetention';

const order = (changes: Partial<Order>): Order => ({
  id: 'order-1', orderNumber: 'ORD-1', customerId: 'c1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-08-02', weddingDate: '2026-08-20', eventDate: '2026-08-20', deliveryDate: '2026-08-20', eventLocation: '',
  totalPrice: 2000, deposit: 500, totalPaid: 500, remainingBalance: 1500, paymentStatus: 'partially_paid',
  paymentHistory: [], orderStatus: 'confirmed', reservedItems: [], attachments: [], createdAt: '2026-08-02', updatedAt: '2026-08-02',
  ...changes,
});

const pagedFetcher = (pages: Array<{ records: Order[]; hasMore: boolean }>): OrderPageFetcher => {
  let call = 0;
  return async () => {
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return {
      success: true,
      data: {
        records: page.records,
        hasMore: page.hasMore,
        cursor: (page.hasMore ? { id: 'cursor' } : null) as PageResult<Order>['cursor'],
      },
    };
  };
};

// --- R6: failures are failures, never a quiet fallback ----------------------

test('a failed history page is reported as an error and returns no records', async () => {
  const fetchPage: OrderPageFetcher = async () => ({ success: false, message: 'تعذر الاتصال.' });

  const result = await loadFinancialOrderHistory('company-1', { fetchPage });

  assert.equal(result.status, 'error');
  assert.equal(result.records.length, 0, 'a partial list must not be handed back as if it were the dataset');
  assert.equal(result.message, 'تعذر الاتصال.');
  assert.equal(financialHistoryIsComplete(result.status), false);
});

test('a failure part-way through discards the pages that did load', async () => {
  let call = 0;
  const fetchPage: OrderPageFetcher = async () => {
    call += 1;
    if (call === 1) {
      return { success: true, data: { records: [order({ id: 'a' })], hasMore: true, cursor: { id: 'c' } as PageResult<Order>['cursor'] } };
    }
    return { success: false, message: 'انقطع الاتصال.' };
  };

  const result = await loadFinancialOrderHistory('company-1', { fetchPage });

  assert.equal(result.status, 'error');
  assert.equal(result.records.length, 0, 'half a ledger is not a ledger');
});

test('a truncated load is marked, not passed off as complete', async () => {
  const fetchPage = pagedFetcher([{ records: [order({ id: 'a' })], hasMore: true }]);

  const result = await loadFinancialOrderHistory('company-1', { fetchPage, maxPages: 3 });

  assert.equal(result.status, 'truncated');
  assert.equal(result.pagesRead, 3);
  assert.equal(financialHistoryIsComplete(result.status), false);
});

test('a complete load reports complete and de-duplicates overlapping windows', async () => {
  const fetchPage = pagedFetcher([
    { records: [order({ id: 'a' }), order({ id: 'b' })], hasMore: true },
    { records: [order({ id: 'b' }), order({ id: 'c' })], hasMore: false },
  ]);

  const result = await loadFinancialOrderHistory('company-1', { fetchPage });

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.records.map((record) => record.id), ['a', 'b', 'c'], 'an overlapping cursor must not double-count money');
});

// --- R3: accounting totals use the complete dataset -------------------------

test('an old receipt outside the operational window still reaches the financial totals', () => {
  // The live listener only keeps a short recent window, so this order is not
  // in the operational list at all.
  const operationalList: Order[] = [];
  const historical = order({
    id: 'old', eventDate: '2026-02-10', weddingDate: '2026-02-10', bookingDate: '2026-02-01',
    totalPaid: 900, remainingBalance: 1100,
    paymentHistory: [{ id: 'pay_1', amount: 900, date: '2026-02-01', method: 'Cash', type: 'deposit' }],
  });

  assert.equal(calculateSafeBalanceToDate(operationalList, [], new Date(2026, 8, 30)), 0);
  assert.equal(
    calculateSafeBalanceToDate([historical], [], new Date(2026, 8, 30)),
    900,
    'the dashboard total must see money the operational list never loads',
  );
});

test('an archived or retained-deleted order counts in accounting but not in the operational list', () => {
  const archived = order({ id: 'arch', archivedAt: '2027-01-01T00:00:00.000Z', totalPaid: 400, paymentHistory: [{ id: 'p', amount: 400, date: '2026-08-03', method: 'Cash', type: 'deposit' }] });
  const retained = order({ id: 'gone', deletedAt: '2026-09-01T00:00:00.000Z', financiallyRetained: true, totalPaid: 250, paymentHistory: [{ id: 'q', amount: 250, date: '2026-08-04', method: 'Cash', type: 'deposit' }] });

  const accounting = financialHistoryOrders([archived], [retained]);
  assert.equal(accounting.length, 2);
  assert.equal(calculateSafeBalanceToDate(accounting, [], new Date(2026, 8, 30)), 650);

  // The operational list keeps neither of them.
  const operational = [archived, retained].filter((item) => !item.archivedAt && !item.deletedAt);
  assert.equal(operational.length, 0);
});

// --- R5: unreadable is not zero ---------------------------------------------

const ready: FinancialInputs = { historyStatus: 'complete', historyLoading: false, expenseAccess: 'granted' };

test('a user without expense access gets an unavailable metric, never a zero-expense total', () => {
  const denied: FinancialInputs = { ...ready, expenseAccess: 'denied' };

  const state = expenseMetricState(denied);
  assert.equal(state.available, false);
  assert.equal(state.available === false && state.reason, 'permission');
  assert.match(state.available === false ? state.message : '', /صلاحية/);

  // The order-only half of the report is still authoritative for that user, so
  // access is withheld per metric rather than by blanking the whole screen.
  assert.equal(orderMetricState(denied).available, true);

  // Owner and manager therefore never see two different "complete" numbers:
  // the manager sees the metric withheld instead of a smaller figure.
  assert.equal(expenseMetricState(ready).available, true);
});

test('the authorized, complete case reports available', () => {
  assert.deepEqual(orderMetricState(ready), { available: true });
  assert.deepEqual(expenseMetricState(ready), { available: true });
  assert.equal(financialExportAllowed(ready), true);
  assert.equal(financialExportBlockedReason(ready), null);
});

test('loading, error and truncated states are each distinguishable and none reads as zero', () => {
  const loading = orderMetricState({ ...ready, historyLoading: true });
  const failed = orderMetricState({ ...ready, historyStatus: 'error', historyMessage: 'تعذر التحميل.' });
  const partial = orderMetricState({ ...ready, historyStatus: 'truncated', historyMessage: 'غير مكتمل.' });

  assert.equal(loading.available === false && loading.reason, 'loading');
  assert.equal(failed.available === false && failed.reason, 'error');
  assert.equal(failed.available === false && failed.message, 'تعذر التحميل.');
  assert.equal(partial.available === false && partial.reason, 'incomplete');
});

// --- R6: exports are blocked unless every input is complete -----------------

test('exports are blocked while loading, on error, when truncated, and without expense access', () => {
  for (const inputs of [
    { ...ready, historyLoading: true },
    { ...ready, historyStatus: 'error' as const },
    { ...ready, historyStatus: 'truncated' as const },
    { ...ready, expenseAccess: 'denied' as const },
    { ...ready, historyStatus: undefined },
  ]) {
    assert.equal(financialExportAllowed(inputs), false, `export must be blocked for ${JSON.stringify(inputs)}`);
    assert.ok(financialExportBlockedReason(inputs), 'the block must come with a reason to show the user');
  }
});
