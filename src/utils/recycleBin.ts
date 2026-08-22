import type { Customer, InventoryItem, Order, RecycleBinItem } from '../types';

export const isSoftDeleted = (record: { deletedAt?: string | null }) => Boolean(record.deletedAt);

export const deletionMetadata = (now = new Date()) => {
  const deletedAt = now.toISOString();
  const purgeAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return { deletedAt, purgeAt };
};

export const recycleBinItems = (orders: Order[], customers: Customer[], inventory: InventoryItem[]): RecycleBinItem[] => [
  ...orders.filter(isSoftDeleted).map(order => ({ id: order.id, type: 'order' as const, title: order.orderNumber || order.customerName, deletedAt: order.deletedAt!, purgeAt: order.purgeAt || order.deletedAt! })),
  ...customers.filter(isSoftDeleted).map(customer => ({ id: customer.id, type: 'customer' as const, title: customer.name, deletedAt: customer.deletedAt!, purgeAt: customer.purgeAt || customer.deletedAt! })),
  ...inventory.filter(isSoftDeleted).map(item => ({ id: item.id, type: 'inventory' as const, title: item.nameAr || item.nameEn || item.itemCode, deletedAt: item.deletedAt!, purgeAt: item.purgeAt || item.deletedAt! })),
].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
