import type { Expense, Order } from '../types';
import { completedOrderFulfillmentCosts, recordedOrderPayment } from './orderPayments';

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
