export interface WorkerContactOrder {
  workerCanContactCustomer?: boolean;
  customerPhone?: string;
}

export const canViewCustomerContact = (isWorker: boolean, order: WorkerContactOrder) =>
  !isWorker || (order.workerCanContactCustomer === true && Boolean(order.customerPhone?.trim()));

/** The realtime merger actively removes a previously granted number on revocation. */
export const mergeWorkerContact = <T extends WorkerContactOrder>(order: T, customerPhone?: string): T & { customerPhone: string } => ({
  ...order,
  customerPhone: order.workerCanContactCustomer === true ? customerPhone?.trim() || '' : '',
});
