import type { Order } from '../types';
import { canonicalRecordedPaid } from './orderPaymentState';

/**
 * Returns the amount actually collected for an order.
 *
 * `totalPaid` is the canonical value: it is recalculated by
 * `resolveOrderPaymentState` whenever a payment is added or the order is
 * edited.  Reading it through `canonicalRecordedPaid` keeps the answer safe
 * for legacy records: a stored total that is lower than the payments actually
 * recorded can never hide collected money, and a stored total that is higher
 * (history written before the app kept one) is still honoured.
 */
export const recordedOrderPayment = (order: Pick<Order, 'totalPaid' | 'deposit' | 'paymentHistory'>): number =>
  canonicalRecordedPaid(order);

/**
 * Whether the order's worker and transportation costs have been financially
 * recognized.
 *
 * Recognition happens on completion and is then permanent: `fulfillmentRecognizedAt`
 * is stamped the first time the order completes. An operational status change
 * afterwards - most importantly `completed` -> `returned` - must not un-spend
 * money that was already recognized, because that would make a closed month's
 * cash and profit go back up. Records written before the stamp existed fall
 * back to the current status, which is the old behaviour.
 */
export const fulfillmentCostsRecognized = (
  order: Pick<Order, 'orderStatus'> & { fulfillmentRecognizedAt?: string | null },
): boolean => order.orderStatus === 'completed' || Boolean(order.fulfillmentRecognizedAt);

/**
 * Worker and transportation costs are recognized only after the service has
 * actually been completed. Their values remain stored on the order beforehand
 * as planned costs, but do not affect financial summaries or profit.
 */
export const completedOrderFulfillmentCosts = (
  order: Pick<Order, 'orderStatus' | 'workerCost' | 'transportationCost'> & { fulfillmentRecognizedAt?: string | null },
): number => {
  if (!fulfillmentCostsRecognized(order)) return 0;

  const workerCost = Number(order.workerCost);
  const transportationCost = Number(order.transportationCost);
  return (Number.isFinite(workerCost) && workerCost > 0 ? workerCost : 0)
    + (Number.isFinite(transportationCost) && transportationCost > 0 ? transportationCost : 0);
};
