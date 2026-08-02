export type Language = 'ar' | 'en';

export type OrderStatus =
  | 'new'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'completed'
  | 'returned'
  | 'cancelled'
  | 'pending' // legacy alias for new/preparing
  | 'in_progress'; // legacy alias for preparing

export type PaymentStatus = 'unpaid' | 'partially_paid' | 'fully_paid';

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

export interface PaymentEntry {
  id: string;
  amount: number;
  date: string;
  method: 'cash' | 'credit_card' | 'bank_transfer' | 'cheque' | 'online' | 'other' | string;
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

export interface Order {
  id: string;
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
  executorName?: string; // المنفذ / Executor
  workerId?: string; // Worker Firestore Document ID
  workerName?: string; // Worker display name
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
  attachments: OrderAttachment[];
  designImageUrl?: string;
  designImages?: DesignImageItem[];
  activityLogs?: OrderActivityLog[];
  createdAt: string;
  updatedAt: string;
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
  name: string;
  phone: string;
  secondaryPhone?: string;
  email?: string;
  address?: string;
  notes?: string;
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  itemCode: string;
  nameEn: string;
  nameAr: string;
  category: InventoryCategory;
  imageUrl?: string;
  quantity: number; // Total quantity
  availableQuantity: number; // Quantity currently in warehouse
  reservedQuantity: number; // Quantity reserved in active orders
  minStockLevel: number; // Threshold for low stock warning
  storageLocation: string; // Warehouse Location
  condition: ItemCondition;
  rentalPricePerUnit?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
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
  type: 'upcoming_wedding' | 'pending_payment' | 'low_inventory';
  titleEn: string;
  titleAr: string;
  messageEn: string;
  messageAr: string;
  date: string;
  read: boolean;
  linkModule?: string;
  referenceId?: string;
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
