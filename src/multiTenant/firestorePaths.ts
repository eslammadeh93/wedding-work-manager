const documentId = (value: string, label: string): string => {
  if (!value || value.includes('/')) throw new Error(`${label} must be a non-empty Firestore document ID.`);
  return value;
};

const companyRoot = (companyId: string) => `companies/${documentId(companyId, 'companyId')}`;
const companyCollection = (companyId: string, collectionName: string) =>
  `${companyRoot(companyId)}/${collectionName}`;

/** Central source of truth for future multi-tenant Firestore paths. */
export const firestorePaths = {
  platformUser: (uid: string) => `platformUsers/${documentId(uid, 'uid')}`,
  company: companyRoot,
  companyMember: (companyId: string, uid: string) => `${companyRoot(companyId)}/members/${documentId(uid, 'uid')}`,
  companyCollection,
  orders: (companyId: string) => companyCollection(companyId, 'orders'),
  customers: (companyId: string) => companyCollection(companyId, 'customers'),
  workers: (companyId: string) => companyCollection(companyId, 'workers'),
  inventory: (companyId: string) => companyCollection(companyId, 'inventory'),
  expenses: (companyId: string) => companyCollection(companyId, 'expenses'),
  categories: (companyId: string) => companyCollection(companyId, 'categories'),
  activityLogs: (companyId: string) => companyCollection(companyId, 'activityLogs'),
  notifications: (companyId: string) => companyCollection(companyId, 'notifications'),
  members: (companyId: string) => companyCollection(companyId, 'members'),
  order: (companyId: string, orderId: string) => `${companyRoot(companyId)}/orders/${documentId(orderId, 'orderId')}`,
  customer: (companyId: string, customerId: string) => `${companyRoot(companyId)}/customers/${documentId(customerId, 'customerId')}`,
  worker: (companyId: string, workerId: string) => `${companyRoot(companyId)}/workers/${documentId(workerId, 'workerId')}`,
  inventoryItem: (companyId: string, itemId: string) => `${companyRoot(companyId)}/inventory/${documentId(itemId, 'itemId')}`,
  expense: (companyId: string, expenseId: string) => `${companyRoot(companyId)}/expenses/${documentId(expenseId, 'expenseId')}`,
  category: (companyId: string, categoryId: string) => `${companyRoot(companyId)}/categories/${documentId(categoryId, 'categoryId')}`,
  activityLog: (companyId: string, logId: string) => `${companyRoot(companyId)}/activityLogs/${documentId(logId, 'logId')}`,
  settings: (companyId: string) => `${companyRoot(companyId)}/settings/main`,
  notification: (companyId: string, notificationId: string) => `${companyRoot(companyId)}/notifications/${documentId(notificationId, 'notificationId')}`,
  platformAuditLog: (logId: string) => `platformAuditLogs/${documentId(logId, 'logId')}`,
} as const;
