import type { OrderStatus } from '../types';

type OrderStatusTranslationKey =
  | 'statusNew'
  | 'statusConfirmed'
  | 'statusPreparing'
  | 'statusOutForDelivery'
  | 'statusCompleted'
  | 'statusReturned'
  | 'statusCancelled'
  | 'statusCancelledDepositRetained'
  | 'statusPending'
  | 'statusInProgress';

const orderStatusTranslationKeys: Record<OrderStatus, OrderStatusTranslationKey> = {
  new: 'statusNew',
  confirmed: 'statusConfirmed',
  preparing: 'statusPreparing',
  out_for_delivery: 'statusOutForDelivery',
  completed: 'statusCompleted',
  returned: 'statusReturned',
  cancelled: 'statusCancelled',
  cancelled_deposit_retained: 'statusCancelledDepositRetained',
  pending: 'statusPending',
  in_progress: 'statusInProgress',
};

export function getOrderStatusLabel(
  status: OrderStatus,
  translate: (key: OrderStatusTranslationKey) => string,
) {
  return translate(orderStatusTranslationKeys[status]);
}
