import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import type { CompanyFinanceEntry, CompanySettings, Order, PaymentEntry } from '../src/types';
import { calculateFinancePeriodCash, calculateMonthlyCash, calculateSafeBalanceToDate } from '../src/utils/monthlyCash';
import { orderFinancialPosition, resolveOrderPaymentState } from '../src/utils/orderPaymentState';
import { refundPaymentEntry } from '../src/utils/financialRetention';
import { buildFinancialBackup, type BackupInputs } from '../src/utils/financialBackup';

const order = (changes: Partial<Order>): Order => ({
  id: 'order-1', orderNumber: 'ORD-1', customerId: 'c1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-08-02', weddingDate: '2026-08-20', eventDate: '2026-08-20', deliveryDate: '2026-08-20', eventLocation: '',
  totalPrice: 10_000, deposit: 0, totalPaid: 0, remainingBalance: 10_000, paymentStatus: 'unpaid',
  paymentHistory: [], orderStatus: 'confirmed', reservedItems: [], attachments: [], createdAt: '2026-08-02', updatedAt: '2026-08-02',
  ...changes,
});

const pay = (id: string, amount: number, date: string, type: PaymentEntry['type'] = 'deposit'): PaymentEntry =>
  ({ id, amount, date, method: 'Cash', type });

/**
 * A security movement as old records still store it. Nothing writes these any
 * more; they exist only to prove that stored ones count for nothing.
 */
const legacySecurity = (
  id: string,
  amount: number,
  date: string,
  type: 'security_deposit' | 'security_refund',
): PaymentEntry => ({ id, amount, date, method: 'Cash', type, notes: 'سجل قديم' });

const backupInputs = (orders: Order[]): BackupInputs => ({
  companyId: 'company-1',
  historyStatus: 'complete',
  historyLoading: false,
  expenseAccess: 'granted',
  accountingOrders: orders,
  expenses: [], customers: [], suppliers: [], inventory: [], categories: [],
  settings: {} as CompanySettings,
});

const AUG = [2026, 7] as const;
const SEP = [2026, 8] as const;
const noEntries: CompanyFinanceEntry[] = [];

// --- The security deposit is informational only -----------------------------

test('the securityDeposit field changes no figure on the order', () => {
  const base = order({ totalPaid: 5_000, paymentHistory: [pay('p1', 5_000, '2026-08-02')] });
  const withSecurity = { ...base, securityDeposit: 1_000 };

  const position = orderFinancialPosition(withSecurity);
  assert.equal(position.totalPaid, 5_000);
  assert.equal(position.remainingBalance, 5_000);
  assert.equal(position.paymentStatus, 'partially_paid');
  assert.equal(position.customerCredit, 0);
  assert.deepEqual(position, orderFinancialPosition(base), 'identical to the same order without one');
});

test('editing the securityDeposit changes nothing financially', () => {
  const at1000 = order({
    totalPaid: 5_000, securityDeposit: 1_000, paymentHistory: [pay('p1', 5_000, '2026-08-02')],
  });
  const at2000 = { ...at1000, securityDeposit: 2_000 };

  assert.deepEqual(orderFinancialPosition(at2000), orderFinancialPosition(at1000));

  const before = calculateMonthlyCash([at1000], noEntries, ...AUG);
  const after = calculateMonthlyCash([at2000], noEntries, ...AUG);
  assert.equal(after.netOrderCash, before.netOrderCash);
  assert.equal(after.expectedOrderProfit, before.expectedOrderProfit);
  assert.equal(after.grossMonthlyIncome, before.grossMonthlyIncome);
  assert.equal(after.expectedSafeBalance, before.expectedSafeBalance);

  const treasuryBefore = calculateFinancePeriodCash([at1000], noEntries, '2026-08', '2026-08');
  const treasuryAfter = calculateFinancePeriodCash([at2000], noEntries, '2026-08', '2026-08');
  assert.deepEqual(treasuryAfter, treasuryBefore, 'treasury and carried balance are untouched');
});

test('the worked example: 10,000 priced, 5,000 paid, 1,000 security', () => {
  const example = order({
    totalPrice: 10_000, totalPaid: 5_000, securityDeposit: 1_000,
    paymentHistory: [pay('p1', 5_000, '2026-08-02')],
  });

  const position = orderFinancialPosition(example);
  assert.equal(position.totalPaid, 5_000);
  assert.equal(position.remainingBalance, 5_000);
  assert.equal(position.customerCredit, 0);

  const summary = calculateMonthlyCash([example], noEntries, ...AUG);
  assert.equal(summary.netOrderCash, 5_000, 'contract payments only');
  assert.equal(summary.expectedOrderProfit, 10_000, 'contract price less costs only');
  assert.equal(
    calculateFinancePeriodCash([example], noEntries, '2026-08', '2026-08').totalTreasuryBalance,
    5_000,
    'no 1,000 from the security amount',
  );
});

// --- Legacy stored movements contribute zero --------------------------------

test('a stored legacy security_deposit movement contributes zero financially', () => {
  const plain = order({ totalPaid: 5_000, paymentHistory: [pay('p1', 5_000, '2026-08-02')] });
  const withLegacy = order({
    totalPaid: 5_000, securityDeposit: 1_000,
    paymentHistory: [pay('p1', 5_000, '2026-08-02'), legacySecurity('s1', 1_000, '2026-08-04', 'security_deposit')],
  });

  assert.deepEqual(orderFinancialPosition(withLegacy), orderFinancialPosition(plain));

  const a = calculateMonthlyCash([withLegacy], noEntries, ...AUG);
  const b = calculateMonthlyCash([plain], noEntries, ...AUG);
  assert.equal(a.netOrderCash, b.netOrderCash);
  assert.equal(a.netOrderCash, 5_000);
  assert.equal(a.expectedOrderProfit, b.expectedOrderProfit);
  assert.equal(a.grossMonthlyIncome, b.grossMonthlyIncome, 'it is not revenue either');

  const treasury = calculateFinancePeriodCash([withLegacy], noEntries, '2026-08', '2026-08');
  assert.equal(treasury.totalTreasuryBalance, 5_000, 'the safe total ignores the movement');
  assert.equal(treasury.totalTreasuryBalance, treasury.remainingOperatingBalance + treasury.netOrderCash);
  assert.equal(calculateSafeBalanceToDate([withLegacy], noEntries, new Date(2026, 7, 31)), 5_000);
});

test('a stored legacy security_refund movement contributes zero financially', () => {
  const lifecycle = [order({
    totalPaid: 0, securityDeposit: 1_000,
    paymentHistory: [
      legacySecurity('s1', 1_000, '2026-08-05', 'security_deposit'),
      legacySecurity('s2', 700, '2026-09-11', 'security_refund'),
    ],
  })];

  const august = calculateFinancePeriodCash(lifecycle, noEntries, '2026-08', '2026-08');
  const september = calculateFinancePeriodCash(lifecycle, noEntries, '2026-09', '2026-09');

  assert.equal(august.netOrderCash, 0);
  assert.equal(august.totalTreasuryBalance, 0);
  assert.equal(september.openingCarriedBalance, 0, 'nothing was ever carried in from the receipt');
  assert.equal(september.netOrderCash, 0, 'and nothing leaves when it is returned');
  assert.equal(september.totalTreasuryBalance, 0);

  for (const [year, month] of [AUG, SEP]) {
    const summary = calculateMonthlyCash(lifecycle, noEntries, year, month);
    assert.equal(summary.netOrderCash, 0, 'no security money is ever order cash');
    assert.equal(summary.collections.length, 0, 'security entries are not cash collections');
  }
  assert.equal(calculateMonthlyCash(lifecycle, noEntries, ...AUG).expectedOrderProfit, 10_000, 'the contract margin only');
  assert.equal(orderFinancialPosition(lifecycle[0]).totalPaid, 0, 'and none of it is paid towards the order');
});

test('legacy security movements stay stored and are preserved in the backup', () => {
  const stored = order({
    totalPaid: 5_000, securityDeposit: 1_000,
    paymentHistory: [
      pay('p1', 5_000, '2026-08-02'),
      legacySecurity('s1', 1_000, '2026-08-04', 'security_deposit'),
      legacySecurity('s2', 400, '2026-09-11', 'security_refund'),
    ],
  });

  const backup = buildFinancialBackup(backupInputs([stored]));
  assert.equal(backup.counts.securityMovements, 2, 'both legacy movements are counted');
  const restored = backup.orders.find((item) => item.id === stored.id);
  assert.deepEqual(restored?.paymentHistory, stored.paymentHistory, 'stored byte-for-byte');
});

// --- B5: discount metadata --------------------------------------------------

test('the discount note changes no calculation at all', () => {
  const plain = order({ totalPaid: 4_000, paymentHistory: [pay('p1', 4_000, '2026-08-02')] });
  const annotated = { ...plain, discountInfo: 'Original 12,000 → final 10,000 (‑17%)' };

  assert.deepEqual(orderFinancialPosition(annotated), orderFinancialPosition(plain));
  const a = calculateMonthlyCash([annotated], noEntries, ...AUG);
  const b = calculateMonthlyCash([plain], noEntries, ...AUG);
  assert.equal(a.netOrderCash, b.netOrderCash);
  assert.equal(a.expectedOrderProfit, b.expectedOrderProfit);
  assert.equal(annotated.totalPrice, plain.totalPrice);
  assert.equal(
    calculateFinancePeriodCash([annotated], noEntries, '2026-08', '2026-08').totalTreasuryBalance,
    calculateFinancePeriodCash([plain], noEntries, '2026-08', '2026-08').totalTreasuryBalance,
  );
});

// --- B5: overpayment / customer credit --------------------------------------

test('Example C: an overpayment becomes customer credit, not contract value', () => {
  const overpaid = order({
    totalPaid: 10_500, remainingBalance: 0, paymentStatus: 'fully_paid',
    paymentHistory: [pay('p1', 10_500, '2026-08-02', 'settlement')],
  });

  const position = orderFinancialPosition(overpaid);
  assert.equal(position.totalPaid, 10_500, 'the extra 500 is not clamped away');
  assert.equal(position.remainingBalance, 0);
  assert.equal(position.paymentStatus, 'fully_paid');
  assert.equal(position.customerCredit, 500);

  const summary = calculateMonthlyCash([overpaid], noEntries, ...AUG);
  assert.equal(summary.expectedOrderProfit, 10_000, 'margin starts from the contract price only');
  assert.equal(summary.netOrderCash, 10_500, 'but all the cash really arrived');
  assert.equal(calculateFinancePeriodCash([overpaid], noEntries, '2026-08', '2026-08').totalTreasuryBalance, 10_500);
});

test('Example D: refunding customer credit clears it without rewriting the receipt', () => {
  const receipt = pay('p1', 10_500, '2026-08-02', 'settlement');
  const refund = refundPaymentEntry('r1', 500, '2026-09-09', 'Cash', 'Overpayment returned');
  const refunded = order({ totalPaid: 10_000, remainingBalance: 0, paymentStatus: 'fully_paid', paymentHistory: [receipt, refund] });

  const position = orderFinancialPosition(refunded);
  assert.equal(position.customerCredit, 0, 'nothing is owed back any more');
  assert.equal(position.totalPaid, 10_000);
  assert.equal(position.remainingBalance, 0);

  // August keeps the receipt exactly as reported; September carries the outflow.
  assert.equal(calculateMonthlyCash([refunded], noEntries, ...AUG).netOrderCash, 10_500);
  assert.equal(calculateMonthlyCash([refunded], noEntries, ...SEP).netOrderCash, -500);
  const stored = refunded.paymentHistory.find((entry) => entry.id === 'p1');
  assert.deepEqual(stored, receipt, 'the original receipt is byte-for-byte untouched');
});

test('recording an overpayment through the canonical resolver keeps the credit visible', () => {
  const stored = { deposit: 2_000, totalPaid: 2_000, totalPrice: 10_000, paymentHistory: [pay('p1', 2_000, '2026-08-02')] };

  const resolved = resolveOrderPaymentState(stored, {
    paymentHistory: [...stored.paymentHistory, pay('p2', 9_000, '2026-08-20', 'settlement')],
    totalPrice: 10_000,
  });

  assert.equal(resolved.totalPaid, 11_000);
  assert.equal(resolved.remainingBalance, 0);
  assert.equal(resolved.paymentStatus, 'fully_paid');
  assert.equal(orderFinancialPosition({ ...stored, ...resolved, paymentHistory: resolved.paymentHistory }).customerCredit, 1_000);
});

test('an overpayment is unaffected by a security amount or a legacy movement', () => {
  const both = order({
    totalPaid: 10_500, remainingBalance: 0, paymentStatus: 'fully_paid', securityDeposit: 1_000,
    paymentHistory: [
      pay('p1', 10_500, '2026-08-02', 'settlement'),
      legacySecurity('s1', 1_000, '2026-08-03', 'security_deposit'),
    ],
  });

  const position = orderFinancialPosition(both);
  assert.equal(position.customerCredit, 500);
  assert.equal(position.totalPaid, 10_500);

  const summary = calculateMonthlyCash([both], noEntries, ...AUG);
  assert.equal(summary.netOrderCash, 10_500);
  assert.equal(summary.expectedOrderProfit, 10_000);
  // The safe shows the contract cash only: 11,500 was never a financial figure.
  assert.equal(calculateFinancePeriodCash([both], noEntries, '2026-08', '2026-08').totalTreasuryBalance, 10_500);
});

// --- the security UI surface stays informational-only ------------------------

test('no security receipt or refund action is offered anywhere in the UI', () => {
  const sources = [
    'src/components/orders/OrderDetailModal.tsx',
    'src/components/orders/OrderInvoicePrint.tsx',
    'src/components/reports/ReportsModule.tsx',
  ].map((file) => fs.readFileSync(file, 'utf8'));

  for (const source of sources) {
    assert.equal(source.includes('استلام تأمين'), false, 'no "receive security" control or label');
    assert.equal(source.includes('إعادة تأمين'), false, 'no "return security" control or label');
    assert.equal(source.includes('securityDepositEntry'), false);
    assert.equal(source.includes('securityRefundEntry'), false);
    assert.equal(source.includes('securityHeld'), false, 'no held-security figure');
  }
});

test('the informational security field is still shown on the order and the invoice', () => {
  const details = fs.readFileSync('src/components/orders/OrderDetailSections.tsx', 'utf8');
  const invoice = fs.readFileSync('src/components/orders/OrderInvoicePrint.tsx', 'utf8');
  const form = fs.readFileSync('src/components/orders/OrderModal.tsx', 'utf8');

  assert.ok(details.includes("t('securityDeposit')"), 'order details shows the field');
  assert.ok(details.includes('order.securityDeposit'), 'and shows the stored value itself');
  assert.ok(invoice.includes('التأمين'), 'the invoice prints it under its Arabic label');
  assert.ok(invoice.includes('order.securityDeposit'));
  assert.ok(form.includes("t('securityDeposit')"), 'the new/edit form keeps the input');
});

test('the order form keeps the remaining amount on the top financial row', () => {
  const source = fs.readFileSync('src/components/orders/OrderModal.tsx', 'utf8');
  // The financial row is the four-column grid holding the price; it ends where
  // the next grid begins.
  const priceAt = source.indexOf("t('totalPrice')");
  const rowStart = source.lastIndexOf('lg:grid-cols-4', priceAt);
  const rowEnd = source.indexOf('sm:grid-cols-3', priceAt);
  assert.ok(priceAt > -1 && rowStart > -1 && rowEnd > rowStart, 'the financial row must be locatable');
  const row = source.slice(rowStart, rowEnd);
  const totalPrice = row.indexOf("t('totalPrice')");
  const deposit = row.indexOf("t('deposit')");
  const security = row.indexOf("t('securityDeposit')");
  const remaining = row.indexOf("t('remainingBalance')");
  const discount = row.indexOf('بيان الخصم (اختياري)');

  for (const [label, index] of Object.entries({ totalPrice, deposit, security, remaining, discount })) {
    assert.ok(index > -1, `${label} must still be in the financial row`);
  }
  assert.ok(totalPrice < deposit && deposit < security && security < remaining, 'remaining sits with the other three');
  assert.ok(remaining < discount, 'the discount note comes after, not between');
  assert.ok(!row.slice(remaining, discount).includes('<input'), 'remaining balance is not editable');
});
