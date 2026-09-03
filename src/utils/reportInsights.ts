import type { Expense, Order } from '../types';
import { completedOrderFulfillmentCosts, recordedOrderPayment } from './orderPayments';
import { orderCashCollections } from './monthlyCash';

export interface MonthlyComparisonItem {
  month: number;
  orderCount: number;
  revenue: number;
  directCosts: number;
  netProfit: number;
  operatingExpenses: number;
}

export interface ServiceProfitabilityItem {
  service: string;
  orderCount: number;
  revenue: number;
  directCosts: number;
  netProfit: number;
}

export interface CustomerSourceItem {
  source: 'organic' | 'campaign' | 'other';
  orderCount: number;
  revenue: number;
  collected: number;
  netProfit: number;
}

const sourceOf = (value: Order['orderSource']): CustomerSourceItem['source'] =>
  value === 'organic' || value === 'campaign' ? value : 'other';

const eventDateOf = (order: Order) => order.eventDate || order.weddingDate || '';
const directCostsOf = (order: Order) => completedOrderFulfillmentCosts(order) + Number(order.otherExpenses || 0);

/** Supplier service lines are the only explicit service classifications today.
 * Orders without one are reported as the company's standard equipment/setup service. */
export const serviceTypesOf = (order: Order, language: 'ar' | 'en') => {
  const services = [...new Set((order.supplierRentals || [])
    .map((item) => item.serviceType?.trim())
    .filter((item): item is string => Boolean(item)))];
  return services.length ? services : [language === 'ar' ? 'تجهيزات وتركيبات' : 'Equipment & setup'];
};

export function buildMonthlyComparison(orders: Order[], expenses: Expense[], year: number): MonthlyComparisonItem[] {
  return Array.from({ length: 12 }, (_, month) => {
    const monthOrders = orders.filter((order) => {
      const date = new Date(eventDateOf(order));
      return date.getFullYear() === year && date.getMonth() === month;
    });
    const operatingExpenses = expenses
      .filter((expense) => {
        const date = new Date(expense.date);
        return date.getFullYear() === year && date.getMonth() === month && expense.type !== 'capital';
      })
      .reduce((total, expense) => total + Number(expense.amount || 0), 0);
    const revenue = monthOrders.reduce((total, order) => total + Number(order.totalPrice || 0), 0);
    const directCosts = monthOrders.reduce((total, order) => total + directCostsOf(order), 0);
    return { month, orderCount: monthOrders.length, revenue, directCosts, netProfit: revenue - directCosts, operatingExpenses };
  });
}

export function buildServiceProfitability(orders: Order[], language: 'ar' | 'en'): ServiceProfitabilityItem[] {
  const groups = new Map<string, ServiceProfitabilityItem>();
  orders.forEach((order) => {
    const services = serviceTypesOf(order, language);
    const revenueShare = Number(order.totalPrice || 0) / services.length;
    const costShare = directCostsOf(order) / services.length;
    services.forEach((service) => {
      const current = groups.get(service) || { service, orderCount: 0, revenue: 0, directCosts: 0, netProfit: 0 };
      current.orderCount += 1;
      current.revenue += revenueShare;
      current.directCosts += costShare;
      current.netProfit += revenueShare - costShare;
      groups.set(service, current);
    });
  });
  return [...groups.values()].sort((a, b) => b.netProfit - a.netProfit);
}

export function buildCustomerSourceBreakdown(orders: Order[]): CustomerSourceItem[] {
  const groups = new Map<CustomerSourceItem['source'], CustomerSourceItem>();
  orders.forEach((order) => {
    const source = sourceOf(order.orderSource);
    const current = groups.get(source) || { source, orderCount: 0, revenue: 0, collected: 0, netProfit: 0 };
    current.orderCount += 1;
    current.revenue += Number(order.totalPrice || 0);
    current.collected += recordedOrderPayment(order);
    current.netProfit += Number(order.totalPrice || 0) - directCostsOf(order);
    groups.set(source, current);
  });
  const sources: CustomerSourceItem['source'][] = ['organic', 'campaign', 'other'];
  return sources.map((source) => groups.get(source) || { source, orderCount: 0, revenue: 0, collected: 0, netProfit: 0 });
}

/**
 * Net cash by acquisition source for one calendar month.  This deliberately
 * mirrors the headline safe calculation: completed orders contribute only
 * payments collected in their completion month, less direct costs, while
 * future orders contribute money actually collected in the month. A retained
 * cancellation contributes its retained deposit, never its contract value.
 */
export function buildMonthlySourceCashNet(orders: Order[], year: number, month: number): Record<CustomerSourceItem['source'], number> {
  const result: Record<CustomerSourceItem['source'], number> = { organic: 0, campaign: 0, other: 0 };
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const isInMonth = (value?: string) => Boolean(value?.startsWith(monthPrefix));

  orders.forEach((order) => {
    const source = sourceOf(order.orderSource);
    const status = order.orderStatus;
    const eventIsInMonth = isInMonth(eventDateOf(order));
    const completedThisMonth = status === 'completed' && eventIsInMonth;
    const collectionsThisMonth = orderCashCollections(order)
      .filter((collection) => isInMonth(collection.date));

    if (completedThisMonth) {
      result[source] += collectionsThisMonth.reduce((total, collection) => total + collection.amount, 0) - directCostsOf(order);
    }

    // A completed order is represented by its execution-month result only.
    // When it completes later, its current-month deposit remains an advance.
    if (!completedThisMonth && status !== 'cancelled') {
      result[source] += collectionsThisMonth.reduce((total, collection) => total + collection.amount, 0);
    }

    // Before completion, other expenses are attributed to the execution month.
    // Retained cancellations do not have a future-order expense deduction.
    if (!completedThisMonth && status !== 'cancelled' && status !== 'cancelled_deposit_retained' && eventIsInMonth) {
      result[source] -= Number(order.otherExpenses || 0);
    }
  });

  return result;
}
