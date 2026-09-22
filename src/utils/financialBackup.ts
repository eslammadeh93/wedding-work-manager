import type { CategoryItem, CompanyFinanceEntry, CompanySettings, Customer, InventoryItem, Order, Supplier } from '../types';
import { financialHistoryIsComplete, type FinancialHistoryStatus } from '../multiTenant/data/financialHistory';
import type { ExpenseAccess } from './financialAvailability';

/**
 * Building the financial backup file.
 *
 * A backup is only worth having if you can tell whether it is complete. The
 * previous export serialised the operational order listener, which holds at
 * most seventy-five recent orders, so the file looked like a backup and was
 * missing nearly every archived, deleted-but-retained and older record - and
 * nothing in it said so.
 *
 * Two things follow. The dataset written is the full accounting one, and an
 * export whose inputs are loading, failed, truncated or unreadable refuses to
 * produce a file at all rather than writing a short one labelled successful.
 */
export class IncompleteBackupError extends Error {
  readonly code = 'INCOMPLETE_FINANCIAL_BACKUP';
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteBackupError';
  }
}

export interface BackupInputs {
  companyId: string;
  historyStatus: FinancialHistoryStatus | undefined;
  historyLoading: boolean;
  historyMessage?: string;
  expenseAccess: ExpenseAccess;
  accountingOrders: readonly Order[];
  expenses: readonly CompanyFinanceEntry[];
  customers: readonly Customer[];
  suppliers: readonly Supplier[];
  inventory: readonly InventoryItem[];
  categories: readonly CategoryItem[];
  settings: CompanySettings;
}

/** Counts that let someone inspect a file and see what it actually contains. */
export interface BackupCounts {
  orders: number;
  archivedOrders: number;
  financiallyRetainedOrders: number;
  paymentEntries: number;
  cancellationEvents: number;
  securityMovements: number;
  ordersWithCancellationHistory: number;
  ordersWithFulfillmentRecognition: number;
  expenses: number;
  voidedExpenses: number;
  expenseReversals: number;
  customers: number;
  suppliers: number;
  inventory: number;
  categories: number;
}

export interface FinancialBackup {
  version: 2;
  companyId: string;
  exportDate: string;
  /** Always `complete`: an incomplete dataset throws instead of being written. */
  completeness: 'complete';
  counts: BackupCounts;
  settings: CompanySettings;
  orders: Order[];
  expenses: CompanyFinanceEntry[];
  customers: Customer[];
  suppliers: Supplier[];
  inventory: InventoryItem[];
  categories: CategoryItem[];
}

const isSecurityEntry = (type: string | undefined) => type === 'security_deposit' || type === 'security_refund';

export const backupCounts = (inputs: Pick<BackupInputs,
  'accountingOrders' | 'expenses' | 'customers' | 'suppliers' | 'inventory' | 'categories'>): BackupCounts => {
  const orders = inputs.accountingOrders;
  return {
    orders: orders.length,
    archivedOrders: orders.filter((order) => Boolean(order.archivedAt)).length,
    financiallyRetainedOrders: orders.filter((order) => order.financiallyRetained === true || Boolean(order.deletedAt)).length,
    paymentEntries: orders.reduce((total, order) => total + (order.paymentHistory || []).length, 0),
    cancellationEvents: orders.reduce((total, order) => total + (order.cancellationHistory || []).length, 0),
    securityMovements: orders.reduce((total, order) => total
      + (order.paymentHistory || []).filter((entry) => isSecurityEntry(entry.type)).length, 0),
    ordersWithCancellationHistory: orders.filter((order) => (order.cancellationHistory || []).length > 0).length,
    ordersWithFulfillmentRecognition: orders.filter((order) => Boolean(order.fulfillmentRecognizedAt)).length,
    expenses: inputs.expenses.length,
    voidedExpenses: inputs.expenses.filter((entry) => Boolean(entry.voidedAt)).length,
    expenseReversals: inputs.expenses.filter((entry) => entry.isReversal === true).length,
    customers: inputs.customers.length,
    suppliers: inputs.suppliers.length,
    inventory: inputs.inventory.length,
    categories: inputs.categories.length,
  };
};

/**
 * Refuses rather than writing a partial file. Orders are taken whole, so the
 * payment, cancellation and security histories embedded in them come with
 * them; nothing is summarised or stripped on the way out.
 */
export const buildFinancialBackup = (inputs: BackupInputs, now = new Date()): FinancialBackup => {
  if (inputs.historyLoading) {
    throw new IncompleteBackupError('السجل المالي ما زال قيد التحميل. انتظر حتى يكتمل قبل أخذ نسخة احتياطية.');
  }
  if (inputs.historyStatus === 'error') {
    throw new IncompleteBackupError(inputs.historyMessage || 'تعذر تحميل السجل المالي، فلا يمكن أخذ نسخة احتياطية كاملة.');
  }
  if (inputs.historyStatus === 'truncated') {
    throw new IncompleteBackupError(inputs.historyMessage || 'السجل المالي غير مكتمل، فلا يمكن أخذ نسخة احتياطية كاملة.');
  }
  if (!financialHistoryIsComplete(inputs.historyStatus)) {
    throw new IncompleteBackupError('السجل المالي غير جاهز بعد. أعد المحاولة بعد اكتمال التحميل.');
  }
  if (inputs.expenseAccess !== 'granted') {
    // Without the expense ledger the file would be missing capital, operating
    // costs and every void and reversal, with nothing to say so.
    throw new IncompleteBackupError('النسخة الاحتياطية تحتاج صلاحية عرض المالية والمصروفات.');
  }
  if (!inputs.companyId) throw new IncompleteBackupError('تعذر تحديد الشركة الحالية.');

  return {
    version: 2,
    companyId: inputs.companyId,
    exportDate: now.toISOString(),
    completeness: 'complete',
    counts: backupCounts(inputs),
    settings: inputs.settings,
    orders: [...inputs.accountingOrders],
    expenses: [...inputs.expenses],
    customers: [...inputs.customers],
    suppliers: [...inputs.suppliers],
    inventory: [...inputs.inventory],
    categories: [...inputs.categories],
  };
};
