export type Language = 'ar' | 'en';

export type OrderStatus =
  | 'new'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'completed'
  | 'returned'
  | 'cancelled'
  /** The booking was cancelled, but its recorded deposit remains company income. */
  | 'cancelled_deposit_retained'
  | 'pending' // legacy alias for new/preparing
  | 'in_progress'; // legacy alias for preparing

export type PaymentStatus = 'unpaid' | 'partially_paid' | 'fully_paid';

/** Where the order lead originated. Legacy orders without a value are shown as "other". */
export type OrderSource = 'organic' | 'campaign' | 'other';

export type PredefinedCategory =
  | 'wedding_chairs'
  | 'golden_chairs'
  | 'white_chairs'
  | 'tables'
  | 'round_tables'
  | 'stands'
  | 'double_stands'
  | 'backdrops'
  | 'flowers'
  | 'fabrics'
  | 'candles'
  | 'cylinders'
  | 'lighting'
  | 'carpets'
  | 'accessories'
  | 'other'
  | 'chairs'
  | 'decoration';

export type InventoryCategory = PredefinedCategory | string;

export type ItemCondition = 'new' | 'good' | 'needs_repair' | 'damaged' | 'fair' | 'maintenance';

export interface OrderItemReservation {
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
}

/** A rented service or item supplied externally for one wedding order. */
export interface OrderSupplierRental {
  id: string;
  supplierId: string;
  /** Snapshot retained so historical orders remain readable if a contact changes. */
  supplierName: string;
  serviceType: string;
  itemDescription: string;
  quantity?: number;
  notes?: string;
}

export interface DesignImageItem {
  url: string;
  createdAt: string;
}

export interface OrderAttachment {
  id: string;
  name: string;
  url: string;
  type: 'contract' | 'image' | 'file' | 'pdf' | 'other';
}

export type PaymentType = 'deposit' | 'settlement';

export interface PaymentEntry {
  id: string;
  amount: number;
  date: string;
  method: 'cash' | 'credit_card' | 'bank_transfer' | 'cheque' | 'online' | 'other' | string;
  /** Deposit at booking or settlement payment tied to the execution date. */
  type?: PaymentType;
  notes?: string;
}

export interface OrderActivityLog {
  id: string;
  workerId: string;
  workerName: string;
  action: 'arrived' | 'finished' | string;
  actionText: string;
  timestamp: string;
}

export interface ActivityLogRecord {
  id: string;
  logId?: string;
  orderId: string;
  orderNumber: string;
  workerId: string;
  workerName: string;
  action: 'opened' | 'arrived' | 'finished' | string;
  actionText?: string;
  timestamp: string;
  customerName: string;
  eventDate: string;
}

export interface WorkerMovement {
  id: string;
  companyId: string;
  orderId: string;
  orderNumber: string;
  workerId: string;
  workerUid?: string;
  workerName: string;
  action: 'arrived' | 'completed';
  type: 'worker_arrived' | 'worker_completed';
  createdAt: unknown;
  createdByUid: string;
  createdByRole: 'worker';
}

/** A standalone operational task; it is not linked to a wedding order. */
export interface WorkTask {
  id: string;
  companyId?: string;
  title: string;
  details?: string;
  executionDate: string; // YYYY-MM-DD
  workerId: string;
  workerName: string;
  status: 'pending' | 'completed';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface Order {
  id: string;
  /** Tenant owning this order. The Firestore path remains the security boundary. */
  companyId?: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  bookingDate?: string; // YYYY-MM-DD (Date when booked & deposit paid)
  weddingDate: string; // YYYY-MM-DD (Event Date)
  eventDate?: string; // YYYY-MM-DD (Alias for weddingDate)
  deliveryDate: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD
  eventLocation: string;
  locationLink?: string; // رابط موقع التنفيذ (Google Maps)
  salesEmployee?: string;
  /** Lead source. This is intentionally omitted from the worker-safe order projection. */
  orderSource?: OrderSource;
  executorName?: string; // المنفذ / Executor
  workerId?: string; // Worker Firestore Document ID
  workerName?: string; // Worker display name
  /** Missing on legacy orders and therefore treated as false. */
  workerCanContactCustomer?: boolean;
  totalPrice: number;
  deposit: number;
  securityDeposit?: number; // التأمين / Security Deposit
  workerCost?: number; // أجرة العامل
  transportationCost?: number; // الانتقالات
  otherExpenses?: number; // مصاريف أخرى
  totalPaid: number;
  remainingBalance: number; // calculated: totalPrice - totalPaid
  paymentStatus: PaymentStatus;
  paymentMethod?: string;
  paymentHistory: PaymentEntry[];
  orderStatus: OrderStatus;
  notes?: string;
  reservedItems: OrderItemReservation[];
  /** External rental/service lines. The same supplier may appear on multiple lines. */
  supplierRentals?: OrderSupplierRental[];
  attachments: OrderAttachment[];
  designImageUrl?: string;
  designImages?: DesignImageItem[];
  activityLogs?: OrderActivityLog[];
  createdAt: string;
  updatedAt: string;
  /** Set by the archive job after a finished order has been inactive for six months. */
  archivedAt?: string | null;
  /** Precomputed at write time so the archive job can query without scanning all orders. */
  archiveEligibleAt?: string;
  deletedAt?: string | null;
  purgeAt?: string | null;
}

export interface Worker {
  id: string;
  /** Firebase Authentication UID for legacy-mode worker accounts only. */
  authUid?: string;
  fullName: string;
  username: string;
  loginCode: string;
  jobTitle: string;
  phone: string;
  notes?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  /** Tenant owning this customer. The Firestore path remains the security boundary. */
  companyId?: string;
  /** Orders associated with this customer; Order.customerId is the canonical link. */
  orderIds?: string[];
  name: string;
  phone: string;
  secondaryPhone?: string;
  email?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
  purgeAt?: string | null;
}

/** A supplier or external contact the company can hire for an event. */
export interface Supplier {
  id: string;
  /** Tenant owning this contact. The Firestore path remains the security boundary. */
  companyId?: string;
  name: string;
  contactPerson?: string;
  phone: string;
  secondaryPhone?: string;
  whatsapp?: string;
  service: string;
  /** Primary city, neighbourhood, or area where this supplier operates. */
  area: string;
  /** Additional areas, stored as a clean list for future matching/filtering. */
  serviceAreas?: string[];
  address?: string;
  locationLink?: string;
  priceNotes?: string;
  notes?: string;
  rating?: number;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  /** Present on company-scoped inventory documents. */
  companyId?: string;
  itemCode: string;
  nameEn: string;
  nameAr: string;
  category: InventoryCategory;
  imageUrl?: string;
  quantity: number; // Total quantity
  totalQuantity?: number; // Canonical total for multi-tenant inventory
  availableQuantity: number; // Quantity currently in warehouse
  reservedQuantity: number; // Quantity reserved in active orders
  minStockLevel: number; // Threshold for low stock warning
  storageLocation: string; // Warehouse Location
  condition: ItemCondition;
  rentalPricePerUnit?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  purgeAt?: string | null;
}

export type RecycleBinItemType = 'order' | 'customer' | 'inventory';
export interface RecycleBinItem {
  id: string;
  type: RecycleBinItemType;
  title: string;
  deletedAt: string;
  purgeAt: string;
}

export type FinanceType = 'capital' | 'expense';

export interface CompanyFinanceEntry {
  id: string;
  type: FinanceType;
  category: string;
  amount: number;
  date: string; // YYYY-MM-DD
  addedBy?: string;
  notes?: string;
  description?: string;
  invoiceImageUrl?: string;
  linkedOrderId?: string;
  linkedOrderNumber?: string;
  createdAt: string;
}

export type Expense = CompanyFinanceEntry;

export interface CategoryItem {
  id: string;
  key: string;
  nameEn: string;
  nameAr: string;
  isCustom?: boolean;
}

export interface AppNotification {
  id: string;
  type: 'upcoming_wedding' | 'pending_payment' | 'low_inventory' | 'worker_opened' | 'worker_arrived' | 'worker_completed' | 'worker_order_assignment' | 'worker_order_today' | 'worker_order_tomorrow' | 'worker_task_assignment';
  titleEn?: string;
  titleAr?: string;
  messageEn?: string;
  messageAr?: string;
  title?: string;
  body?: string;
  date?: string;
  createdAt?: unknown;
  read: boolean;
  linkModule?: string;
  referenceId?: string;
  orderId?: string;
  workerId?: string;
  movementId?: string;
  taskId?: string;
  targetUid?: string;
}

export interface CompanySettings {
  companyNameEn: string;
  companyNameAr: string;
  phone: string;
  email: string;
  addressEn: string;
  addressAr: string;
  taxNumber?: string;
  logoUrl?: string;
  termsEn?: string;
  termsAr?: string;
}

export type UserRole = 'super_admin' | 'admin' | 'manager' | 'employee' | 'worker';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  role: UserRole;
  isActive: boolean;
  workerId?: string;
  workerName?: string;
  createdAt?: string;
  updatedAt?: string;
  lastLogin?: string;
}
