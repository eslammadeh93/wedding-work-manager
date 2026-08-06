import type { Order } from '../types';

/**
 * Returns the amount actually collected for an order.
 *
 * `totalPaid` is the canonical value: it is recalculated whenever a payment is
 * added or the order is edited.  The fallback keeps financial summaries
 * accurate for legacy records that were saved before this field existed.
 */
export const recordedOrderPayment = (order: Pick<Order, 'totalPaid' | 'deposit' | 'paymentHistory'>): number => {
  const totalPaid = Number(order.totalPaid);
  if (Number.isFinite(totalPaid) && totalPaid >= 0) return totalPaid;

  const deposit = Number(order.deposit);
  const historyTotal = (order.paymentHistory || []).reduce((sum, payment) => {
    const amount = Number(payment.amount);
    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);

  // Old records may have an initial-payment entry that duplicates `deposit`.
  return Math.max(Number.isFinite(deposit) && deposit > 0 ? deposit : 0, historyTotal);
};

/**
 * Worker and transportation costs are recognized only after the service has
 * actually been completed. Their values remain stored on the order beforehand
 * as planned costs, but do not affect financial summaries or profit.
 */
export const completedOrderFulfillmentCosts = (order: Pick<Order, 'orderStatus' | 'workerCost' | 'transportationCost'>): number => {
  if (order.orderStatus !== 'completed') return 0;

  const workerCost = Number(order.workerCost);
  const transportationCost = Number(order.transportationCost);
  return (Number.isFinite(workerCost) && workerCost > 0 ? workerCost : 0)
    + (Number.isFinite(transportationCost) && transportationCost > 0 ? transportationCost : 0);
};
