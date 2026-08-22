import type { ActivityLogRecord, InventoryItem, Order } from '../types';

export type ImportantAlertType = 'upcoming_order' | 'overdue_payment' | 'low_inventory' | 'missing_worker_arrival';

export interface ImportantAlert {
  id: string;
  type: ImportantAlertType;
  severity: 'info' | 'warning' | 'danger';
  titleAr: string;
  titleEn: string;
  detailsAr: string;
  detailsEn: string;
  /** The dashboard module to open when this alert is selected. */
  module: 'orders' | 'inventory';
  referenceId?: string;
  sortDate: string;
}

interface ImportantAlertsInput {
  orders: Order[];
  inventory: InventoryItem[];
  activityLogs: ActivityLogRecord[];
  now?: Date;
}

const inactiveStatuses = new Set(['completed', 'returned', 'cancelled', 'cancelled_deposit_retained']);

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normaliseDate(value?: string) {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

function eventDateOf(order: Order) {
  return normaliseDate(order.eventDate || order.weddingDate);
}

function amountOf(order: Order) {
  const remaining = Number(order.remainingBalance);
  if (Number.isFinite(remaining)) return Math.max(0, remaining);
  return Math.max(0, Number(order.totalPrice || 0) - Number(order.totalPaid ?? order.deposit ?? 0));
}

/**
 * Produces dashboard-only operational alerts from company data. Persisted
 * notifications remain separate, so the alert centre is always up to date.
 */
export function getImportantAlerts({ orders, inventory, activityLogs, now = new Date() }: ImportantAlertsInput): ImportantAlert[] {
  const today = toLocalDateKey(now);
  const inSevenDays = new Date(now);
  inSevenDays.setDate(now.getDate() + 7);
  const sevenDaysFromToday = toLocalDateKey(inSevenDays);
  const alerts: ImportantAlert[] = [];

  const arrivedOrderIds = new Set(
    activityLogs
      .filter((log) => log.action === 'arrived' || log.action === 'worker_reported_arrival')
      .map((log) => log.orderId),
  );

  orders.forEach((order) => {
    if (inactiveStatuses.has(order.orderStatus)) return;

    const eventDate = eventDateOf(order);
    const orderLabel = order.orderNumber || order.id;
    const customerName = order.customerName || '';

    if (eventDate && eventDate >= today && eventDate <= sevenDaysFromToday) {
      alerts.push({
        id: `upcoming-order-${order.id}`,
        type: 'upcoming_order',
        severity: 'info',
        titleAr: 'أوردر قادم خلال 7 أيام',
        titleEn: 'Order due within 7 days',
        detailsAr: `${orderLabel} · ${customerName} · ${eventDate}`,
        detailsEn: `${orderLabel} · ${customerName} · ${eventDate}`,
        module: 'orders',
        referenceId: order.id,
        sortDate: eventDate,
      });
    }

    const remaining = amountOf(order);
    if (eventDate && eventDate < today && remaining > 0) {
      alerts.push({
        id: `overdue-payment-${order.id}`,
        type: 'overdue_payment',
        severity: 'danger',
        titleAr: 'دفعة متأخرة',
        titleEn: 'Overdue payment',
        detailsAr: `${orderLabel} · متبقي ${remaining.toLocaleString('ar-EG')}`,
        detailsEn: `${orderLabel} · ${remaining.toLocaleString('en-US')} remaining`,
        module: 'orders',
        referenceId: order.id,
        sortDate: eventDate,
      });
    }

    if (eventDate && eventDate <= today && order.workerId && !arrivedOrderIds.has(order.id)) {
      alerts.push({
        id: `missing-worker-arrival-${order.id}`,
        type: 'missing_worker_arrival',
        severity: 'danger',
        titleAr: 'لم يُسجل وصول العامل',
        titleEn: 'Worker arrival not recorded',
        detailsAr: `${orderLabel} · ${order.workerName || 'العامل المكلّف'} · ${eventDate}`,
        detailsEn: `${orderLabel} · ${order.workerName || 'Assigned worker'} · ${eventDate}`,
        module: 'orders',
        referenceId: order.id,
        sortDate: eventDate,
      });
    }
  });

  inventory.forEach((item) => {
    const available = Number(item.availableQuantity || 0);
    const minimum = Number(item.minStockLevel || 0);
    if (available > 0 && (minimum <= 0 || available > minimum)) return;

    alerts.push({
      id: `low-inventory-${item.id}`,
      type: 'low_inventory',
      severity: available <= 0 ? 'danger' : 'warning',
      titleAr: available <= 0 ? 'نفد المخزون' : 'نقص في المخزون',
      titleEn: available <= 0 ? 'Out of stock' : 'Low inventory',
      detailsAr: `${item.nameAr || item.nameEn} · المتاح ${available.toLocaleString('ar-EG')}${minimum > 0 ? ` من حد ${minimum.toLocaleString('ar-EG')}` : ''}`,
      detailsEn: `${item.nameEn || item.nameAr} · ${available.toLocaleString('en-US')} available${minimum > 0 ? ` of ${minimum.toLocaleString('en-US')} minimum` : ''}`,
      module: 'inventory',
      sortDate: today,
    });
  });

  const severityOrder = { danger: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.sortDate.localeCompare(b.sortDate));
}
