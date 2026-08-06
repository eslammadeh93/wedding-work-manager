import type { CategoryItem, Customer, Expense, InventoryItem, Order, Worker } from '../types';

export const normalizeSearchText = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase();

export type SearchRecord<T extends object> = Partial<T> & Record<string, unknown>;

export interface GlobalSearchSources {
  orders?: readonly unknown[] | null;
  customers?: readonly unknown[] | null;
  workers?: readonly unknown[] | null;
  inventory?: readonly unknown[] | null;
  expenses?: readonly unknown[] | null;
  categories?: readonly unknown[] | null;
}

export interface GlobalSearchResults {
  orders: SearchRecord<Order>[];
  customers: SearchRecord<Customer>[];
  workers: SearchRecord<Worker>[];
  inventory: SearchRecord<InventoryItem>[];
  expenses: SearchRecord<Expense>[];
  categories: SearchRecord<CategoryItem>[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const matchesAnyField = (
  record: Record<string, unknown>,
  normalizedQuery: string,
  fields: readonly string[],
): boolean => fields.some((field) => normalizeSearchText(record[field]).includes(normalizedQuery));

const filterRecords = <T extends object>(
  source: readonly unknown[] | null | undefined,
  normalizedQuery: string,
  fields: readonly string[],
): SearchRecord<T>[] => {
  if (!normalizedQuery || !Array.isArray(source)) return [];

  return source.filter(
    (item): item is SearchRecord<T> => isRecord(item) && matchesAnyField(item, normalizedQuery, fields),
  );
};

const ORDER_FIELDS = [
  'orderNumber', 'customerName', 'customerPhone', 'eventLocation', 'weddingDate',
  'eventDate', 'bookingDate', 'deliveryDate', 'returnDate', 'executorName',
  'workerName', 'totalPrice', 'deposit', 'totalPaid', 'remainingBalance', 'notes',
] as const;

const CUSTOMER_FIELDS = [
  'name', 'phone', 'secondaryPhone', 'email', 'address', 'notes', 'createdAt',
] as const;

const WORKER_FIELDS = [
  'fullName', 'username', 'phone', 'jobTitle', 'loginCode', 'notes', 'status',
] as const;

const INVENTORY_FIELDS = [
  'itemCode', 'nameAr', 'nameEn', 'category', 'storageLocation', 'condition',
  'quantity', 'totalQuantity', 'availableQuantity', 'reservedQuantity',
  'minStockLevel', 'rentalPricePerUnit', 'notes', 'createdAt', 'updatedAt',
] as const;

const EXPENSE_FIELDS = [
  'description', 'notes', 'category', 'amount', 'date', 'addedBy', 'type',
  'linkedOrderId', 'linkedOrderNumber', 'createdAt',
] as const;

const CATEGORY_FIELDS = ['key', 'nameEn', 'nameAr'] as const;

export const searchGlobalData = (
  sources: GlobalSearchSources,
  query: unknown,
): GlobalSearchResults => {
  const normalizedQuery = normalizeSearchText(query);

  return {
    orders: filterRecords<Order>(sources.orders, normalizedQuery, ORDER_FIELDS),
    customers: filterRecords<Customer>(sources.customers, normalizedQuery, CUSTOMER_FIELDS),
    workers: filterRecords<Worker>(sources.workers, normalizedQuery, WORKER_FIELDS),
    inventory: filterRecords<InventoryItem>(sources.inventory, normalizedQuery, INVENTORY_FIELDS),
    expenses: filterRecords<Expense>(sources.expenses, normalizedQuery, EXPENSE_FIELDS),
    categories: filterRecords<CategoryItem>(sources.categories, normalizedQuery, CATEGORY_FIELDS),
  };
};
