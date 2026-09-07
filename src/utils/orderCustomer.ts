import type { Customer, Order } from '../types';

/**
 * Customer contact details belong to the customer record.  Orders keep a
 * snapshot for historical compatibility, but every screen should prefer the
 * current customer details whenever the canonical customerId is available.
 */
export const resolveOrderCustomer = (order: Order, customersById: ReadonlyMap<string, Customer>): Order => {
  const customer = customersById.get(order.customerId);
  if (!customer || (order.customerName === customer.name && order.customerPhone === customer.phone)) return order;

  return {
    ...order,
    customerName: customer.name,
    customerPhone: customer.phone,
  };
};

export const resolveOrderCustomers = (orders: readonly Order[], customers: readonly Customer[]): Order[] => {
  const customersById = new Map(customers.map(customer => [customer.id, customer]));
  return orders.map(order => resolveOrderCustomer(order, customersById));
};
