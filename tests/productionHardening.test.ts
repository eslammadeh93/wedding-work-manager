import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import type { CompanyFinanceEntry, CompanySettings, Order } from '../src/types';
import { IncompleteBackupError, backupCounts, buildFinancialBackup, type BackupInputs } from '../src/utils/financialBackup';
import { isSameSubmission, newSubmissionId, submissionIdFor } from '../src/utils/submissionId';
import { ProviderConfigurationError, resolveMultiTenantFlag } from '../src/multiTenant/featureFlags';
import { orderFinancialPosition } from '../src/utils/orderPaymentState';
import { legacyFractionalFinancialFields } from '../src/utils/financialValidation';

const order = (changes: Partial<Order>): Order => ({
  id: 'order-1', orderNumber: 'ORD-1', customerId: 'c1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-08-02', weddingDate: '2026-08-20', eventDate: '2026-08-20', deliveryDate: '2026-08-20', eventLocation: '',
  totalPrice: 10_000, deposit: 0, totalPaid: 0, remainingBalance: 10_000, paymentStatus: 'unpaid',
  paymentHistory: [], orderStatus: 'confirmed', reservedItems: [], attachments: [], createdAt: '2026-08-02', updatedAt: '2026-08-02',
  ...changes,
});

const settings = {} as CompanySettings;
const inputs = (changes: Partial<BackupInputs> = {}): BackupInputs => ({
  companyId: 'company-1',
  historyStatus: 'complete',
  historyLoading: false,
  expenseAccess: 'granted',
  accountingOrders: [],
  expenses: [], customers: [], suppliers: [], inventory: [], categories: [],
  settings,
  ...changes,
});

// --- D6: the backup carries the whole ledger, or none of it -----------------

const archived = order({
  id: 'arch', orderNumber: 'ORD-ARCH', archivedAt: '2027-03-01T00:00:00.000Z',
  totalPaid: 4_000, fulfillmentRecognizedAt: '2026-08-20T18:00:00.000Z',
  paymentHistory: [{ id: 'p1', amount: 4_000, date: '2026-08-03', method: 'Cash', type: 'deposit' }],
});
const retained = order({
  id: 'gone', orderNumber: 'ORD-DEL', deletedAt: '2026-09-01T00:00:00.000Z', financiallyRetained: true,
  totalPaid: 2_500,
  paymentHistory: [
    { id: 'p2', amount: 2_500, date: '2026-08-04', method: 'Cash', type: 'deposit' },
    { id: 's1', amount: 1_000, date: '2026-08-04', method: 'Cash', type: 'security_deposit' },
  ],
  cancellationHistory: [{ kind: 'cancelled_deposit_retained', at: '2026-10-10T09:30:00.000Z' }],
  cancelledAt: '2026-10-10T09:30:00.000Z',
  orderStatus: 'cancelled_deposit_retained',
});

test('the backup includes archived and financially-retained accounting orders', () => {
  const backup = buildFinancialBackup(inputs({ accountingOrders: [archived, retained] }));

  assert.deepEqual(backup.orders.map((item) => item.id).sort(), ['arch', 'gone']);
  assert.equal(backup.counts.archivedOrders, 1);
  assert.equal(backup.counts.financiallyRetainedOrders, 1);
  assert.equal(backup.completeness, 'complete');
  assert.equal(backup.version, 2);
});

test('the backup carries payment, cancellation and security histories whole', () => {
  const backup = buildFinancialBackup(inputs({ accountingOrders: [archived, retained] }));

  const stored = backup.orders.find((item) => item.id === 'gone');
  assert.deepEqual(stored?.paymentHistory, retained.paymentHistory, 'payments are copied verbatim');
  assert.deepEqual(stored?.cancellationHistory, retained.cancellationHistory);
  assert.equal(stored?.cancelledAt, '2026-10-10T09:30:00.000Z');
  assert.equal(backup.orders.find((item) => item.id === 'arch')?.fulfillmentRecognizedAt, '2026-08-20T18:00:00.000Z');

  // The counts let someone inspect a file and see what is in it.
  assert.equal(backup.counts.paymentEntries, 3);
  assert.equal(backup.counts.securityMovements, 1);
  assert.equal(backup.counts.cancellationEvents, 1);
  assert.equal(backup.counts.ordersWithFulfillmentRecognition, 1);
});

test('the backup counts voided expenses and their reversals', () => {
  const expenses: CompanyFinanceEntry[] = [
    { id: 'e1', type: 'expense', category: 'إيجار', amount: 1_000, date: '2026-08-01', createdAt: '', voidedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'e2', type: 'expense', category: 'إيجار', amount: 1_000, date: '2026-09-01', createdAt: '', isReversal: true, reversalOfId: 'e1' },
    { id: 'e3', type: 'capital', category: 'رأس مال', amount: 5_000, date: '2026-08-01', createdAt: '' },
  ];
  const backup = buildFinancialBackup(inputs({ expenses }));

  assert.equal(backup.counts.expenses, 3);
  assert.equal(backup.counts.voidedExpenses, 1);
  assert.equal(backup.counts.expenseReversals, 1);
  assert.deepEqual(backup.expenses.map((entry) => entry.id), ['e1', 'e2', 'e3'], 'the void and its reversal are both kept');
});

test('the backup refuses to write anything when the financial data is incomplete', () => {
  const refusals: BackupInputs[] = [
    inputs({ historyLoading: true }),
    inputs({ historyStatus: 'error', historyMessage: 'تعذر التحميل.' }),
    inputs({ historyStatus: 'truncated' }),
    inputs({ historyStatus: undefined }),
    inputs({ expenseAccess: 'denied' }),
    inputs({ companyId: '' }),
  ];

  for (const candidate of refusals) {
    assert.throws(
      () => buildFinancialBackup(candidate),
      (error: unknown) => error instanceof IncompleteBackupError,
      `must refuse: ${JSON.stringify({ ...candidate, settings: undefined })}`,
    );
  }
  // And the only file it ever writes says it is complete.
  assert.equal(buildFinancialBackup(inputs()).completeness, 'complete');
});

test('backup counts are derived from the data, not asserted', () => {
  const counts = backupCounts({
    accountingOrders: [archived, retained], expenses: [], customers: [], suppliers: [], inventory: [], categories: [],
  });
  assert.equal(counts.orders, 2);
  assert.equal(counts.ordersWithCancellationHistory, 1);
});

// --- D3: a retried save must not make a second record -----------------------

test('a repeated submission reuses its id, so one record is created', () => {
  const first = submissionIdFor('ord', null);
  const retry = submissionIdFor('ord', first);
  const secondRetry = submissionIdFor('ord', retry);

  assert.equal(retry, first, 'a retry keeps the id the first attempt used');
  assert.equal(secondRetry, first);
  assert.equal(isSameSubmission(first, retry), true);
  // The id is the Firestore document id, so all three attempts write the same
  // document rather than creating three.
  assert.equal(new Set([first, retry, secondRetry]).size, 1);
});

test('a repeated expense submission behaves the same way', () => {
  const first = submissionIdFor('exp', undefined);
  assert.equal(submissionIdFor('exp', first), first);
  assert.ok(first.startsWith('exp_'));
});

test('a genuinely new submission gets a new id', () => {
  const first = submissionIdFor('ord', null);
  const second = submissionIdFor('ord', null);

  assert.notEqual(second, first);
  assert.equal(isSameSubmission(first, second), false);
  // An id from another collection is not reused as this one's.
  assert.notEqual(submissionIdFor('exp', first), first);
  // Ids are unique across many draws.
  assert.equal(new Set(Array.from({ length: 200 }, () => newSubmissionId('ord'))).size, 200);
});

// --- F7: production never silently selects the legacy write path ------------

test('a valid production configuration selects the multi-tenant provider', () => {
  assert.equal(resolveMultiTenantFlag('true', true), true);
  assert.equal(resolveMultiTenantFlag(' TRUE ', true), true, 'whitespace and case do not change the decision');
});

test('a missing or invalid production configuration fails loudly', () => {
  for (const value of [undefined, '', 'false', 'yes', '1', 'TRU']) {
    assert.throws(
      () => resolveMultiTenantFlag(value, true),
      (error: unknown) => error instanceof ProviderConfigurationError,
      `production must refuse ${JSON.stringify(value)}`,
    );
  }
});

test('production can never silently fall through to legacy financial writes', () => {
  // Every value that is not exactly true either selects multi-tenant or throws.
  for (const value of [undefined, '', 'false', 'FALSE', 'no', '0', 'true']) {
    let selected: boolean | 'threw';
    try { selected = resolveMultiTenantFlag(value, true); } catch { selected = 'threw'; }
    assert.notEqual(selected, false, `production must never resolve to legacy for ${JSON.stringify(value)}`);
  }
  // Outside production the old default is preserved for development and demo.
  assert.equal(resolveMultiTenantFlag(undefined, false), false);
  assert.equal(resolveMultiTenantFlag('true', false), true);
});

// --- read-only data-quality detection ---------------------------------------

test('legacy fractional money is detected and named by field', () => {
  // Still live: the order screen names these fields on the record itself, and
  // the write validator refuses new fractional amounts.
  const fractional = order({ id: 'frac', orderNumber: 'ORD-FRAC', totalPrice: 10_000.5, workerCost: 500.25 });
  const fields = legacyFractionalFinancialFields(fractional as unknown as Record<string, unknown>);

  assert.ok(fields.some((field) => field.includes('totalPrice') || field.includes('السعر')));
  assert.equal(fields.length > 0, true);
  assert.deepEqual(legacyFractionalFinancialFields(order({ totalPrice: 10_000, workerCost: 500 }) as unknown as Record<string, unknown>), []);
});

test('a stored security deposit needs nothing from a person', () => {
  const claimed = order({ id: 'sec', orderNumber: 'ORD-SEC', securityDeposit: 1_500 });
  const withLegacyMovement = order({
    id: 'ok', orderNumber: 'ORD-OK', securityDeposit: 1_500,
    paymentHistory: [{ id: 's1', amount: 1_500, date: '2026-08-04', method: 'Cash', type: 'security_deposit' }],
  });

  // The field is informational, so neither record is short of anything, and
  // neither one has been paid a thing towards its order.
  assert.equal(orderFinancialPosition(claimed).totalPaid, 0);
  assert.equal(orderFinancialPosition(withLegacyMovement).totalPaid, 0);
});

test('no legacy repair workflow is exposed anywhere in the application', () => {
  // Old records are corrected by hand from the order itself. Nothing in the
  // app surveys, plans or applies a repair, and no panel offers one.
  const reports = fs.readFileSync('src/components/reports/ReportsModule.tsx', 'utf8');
  assert.equal(reports.includes('بيانات قديمة تحتاج مراجعة يدوية'), false, 'the panel heading is gone');
  assert.equal(reports.includes('إصلاح السجلات القديمة'), false, 'the repair button is gone');
  assert.equal(reports.includes('showLegacyPanel'), false);
  assert.equal(reports.includes('repairLegacyFinancialData'), false);
  assert.equal(reports.includes('surveyLegacyDataRepairs'), false);

  for (const file of [
    'src/context/DataContext.tsx',
    'src/demo/DemoDataProvider.tsx',
    'src/multiTenant/data/MultiTenantDataProvider.tsx',
  ]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('repairLegacyFinancialData'), false, `${file} exposes no repair action`);
    assert.equal(source.includes('surveyLegacyDataRepairs'), false, `${file} exposes no repair survey`);
    assert.equal(source.includes('legacyRepair'), false, `${file} imports no repair module`);
  }

  assert.equal(fs.existsSync('src/utils/legacyRepair.ts'), false, 'the repair module is deleted');
  assert.equal(fs.existsSync('src/utils/legacyDataWarnings.ts'), false, 'its warning feed is deleted');
});

test('the monthly reconciliation survives the panel removal, with no repair action', () => {
  // What is left on the screen is the summary and the orders causing the gap.
  const reports = fs.readFileSync('src/components/reports/ReportsModule.tsx', 'utf8');
  assert.ok(reports.includes('reconcileMonthlyCash'), 'the reconciliation still runs');
  assert.ok(reports.includes('cashReconciliation.items'), 'the per-order cards still render');
  assert.ok(reports.includes('reasonText[item.reason]'), 'and each order still explains its own difference');
});

// --- R9: the invoice reconciles ---------------------------------------------

test('multiple payments, a refund, credit and security all reconcile separately', () => {
  const invoiced = order({
    totalPrice: 10_000,
    totalPaid: 10_500,
    paymentHistory: [
      { id: 'p1', amount: 4_000, date: '2026-08-02', method: 'Cash', type: 'deposit' },
      { id: 'p2', amount: 8_000, date: '2026-08-20', method: 'InstaPay', type: 'settlement' },
      { id: 'r1', amount: 1_500, date: '2026-09-05', method: 'Cash', type: 'refund' },
      { id: 's1', amount: 2_000, date: '2026-08-02', method: 'Cash', type: 'security_deposit' },
      { id: 's2', amount: 500, date: '2026-09-05', method: 'Cash', type: 'security_refund' },
    ],
    securityDeposit: 2_000,
    discountInfo: '12,000 → 10,000',
  });

  const position = orderFinancialPosition(invoiced);
  // Contract money: 4,000 + 8,000 - 1,500 = 10,500, of which 500 is owed back.
  assert.equal(position.totalPaid, 10_500);
  assert.equal(position.remainingBalance, 0);
  assert.equal(position.customerCredit, 500, 'shown separately, never as revenue');
  // The legacy security movements are not part of any figure at all.
  assert.equal(position.totalPaid, 10_500, 'the 2,000 and the 500 change nothing');

  // The invoice groups the entries the same way it displays them.
  const history = invoiced.paymentHistory;
  const contractPayments = history.filter((entry) => entry.type !== 'refund' && !String(entry.type).startsWith('security'));
  const contractRefunds = history.filter((entry) => entry.type === 'refund');
  const securityMovements = history.filter((entry) => String(entry.type).startsWith('security'));

  assert.deepEqual(contractPayments.map((entry) => entry.id), ['p1', 'p2']);
  assert.deepEqual(contractRefunds.map((entry) => entry.id), ['r1']);
  assert.deepEqual(securityMovements.map((entry) => entry.id), ['s1', 's2']);
  // Every entry is shown in exactly one group.
  assert.equal(contractPayments.length + contractRefunds.length + securityMovements.length, history.length);
  // Contract payments alone never include the security cash.
  assert.equal(contractPayments.reduce((total, entry) => total + entry.amount, 0), 12_000);
});
