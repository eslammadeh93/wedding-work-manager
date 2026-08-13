export type OrderDocument = Record<string, unknown>;

export interface WorkerOrderContactProjection {
  companyId: string;
  orderId: string;
  workerId: string;
  customerPhone: string;
  updatedAt: unknown;
}

export const enforceAssignmentContactReset = (before: OrderDocument | undefined, after: OrderDocument) => {
  const assignmentChanged = Boolean(before && before.workerId !== after.workerId);
  return assignmentChanged && after.workerCanContactCustomer === true
    ? { order: { ...after, workerCanContactCustomer: false }, resetRequired: true }
    : { order: after, resetRequired: false };
};

/** Firestore cannot hide individual fields, so worker documents never contain the phone. */
export const buildWorkerOrderProjection = (companyId: string, orderId: string, order: OrderDocument): OrderDocument => {
  // Commercial and procurement data must not be delivered to workers. Remove
  // it server-side instead of relying on the worker UI to hide it.
  const {
    customerPhone: _customerPhone,
    orderSource: _orderSource,
    supplierRentals: _supplierRentals,
    ...safeOrder
  } = order;
  return {
    ...safeOrder,
    id: orderId,
    // Derive tenancy from the trusted document path, never from payload data.
    companyId,
    // Projections are written only for current, assigned orders. Keep the
    // lifecycle marker explicit so they remain compatible with a deployed
    // rule set that additionally filters active worker orders.
    active: true,
    workerCanContactCustomer: order.workerCanContactCustomer === true,
  };
};

export const buildWorkerOrderContactProjection = (
  companyId: string,
  orderId: string,
  order: OrderDocument,
): WorkerOrderContactProjection | null => {
  const workerId = typeof order.workerId === 'string' ? order.workerId.trim() : '';
  const customerPhone = typeof order.customerPhone === 'string' ? order.customerPhone.trim() : '';
  if (order.workerCanContactCustomer !== true || !workerId || !customerPhone) return null;
  return { companyId, orderId, workerId, customerPhone, updatedAt: order.updatedAt ?? null };
};
