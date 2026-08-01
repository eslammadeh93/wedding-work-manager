import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from './AuthContext';
import {
  Order,
  Customer,
  InventoryItem,
  Expense,
  CompanySettings,
  AppNotification,
  CategoryItem,
  PaymentEntry,
  Worker,
  ActivityLogRecord,
} from '../types';
import {
  initialCompanySettings,
  initialInventory,
  initialCustomers,
  initialOrders,
  initialExpenses,
  initialNotifications,
} from '../data/sampleData';

const defaultCategories: CategoryItem[] = [
  { id: 'cat_1', key: 'wedding_chairs', nameEn: 'Wedding Chairs', nameAr: 'كراسي أعراس' },
  { id: 'cat_2', key: 'golden_chairs', nameEn: 'Golden Chairs', nameAr: 'كراسي ذهبية' },
  { id: 'cat_3', key: 'white_chairs', nameEn: 'White Chairs', nameAr: 'كراسي بيضاء' },
  { id: 'cat_4', key: 'tables', nameEn: 'Tables', nameAr: 'طاولات' },
  { id: 'cat_5', key: 'round_tables', nameEn: 'Round Tables', nameAr: 'طاولات دائرية' },
  { id: 'cat_6', key: 'stands', nameEn: 'Stands', nameAr: 'ستاندات وكوشات' },
  { id: 'cat_7', key: 'double_stands', nameEn: 'Double Stands', nameAr: 'ستاندات مزدوجة' },
  { id: 'cat_8', key: 'backdrops', nameEn: 'Backdrops', nameAr: 'خلفيات وكوش' },
  { id: 'cat_9', key: 'flowers', nameEn: 'Flowers', nameAr: 'ورود وزهور' },
  { id: 'cat_10', key: 'fabrics', nameEn: 'Fabrics', nameAr: 'أقمشة وديكورات' },
  { id: 'cat_11', key: 'candles', nameEn: 'Candles', nameAr: 'شموع وشمعدانات' },
  { id: 'cat_12', key: 'cylinders', nameEn: 'Cylinders & Vases', nameAr: 'أسطوانات وفازات' },
  { id: 'cat_13', key: 'lighting', nameEn: 'Lighting', nameAr: 'إضاءة وكشافات' },
  { id: 'cat_14', key: 'carpets', nameEn: 'Carpets & Runners', nameAr: 'سجاد وممرات' },
  { id: 'cat_15', key: 'accessories', nameEn: 'Accessories', nameAr: 'إكسسوارات' },
  { id: 'cat_16', key: 'other', nameEn: 'Other', nameAr: 'أخرى' },
];

interface DataContextType {
  orders: Order[];
  customers: Customer[];
  inventory: InventoryItem[];
  expenses: Expense[];
  workers: Worker[];
  settings: CompanySettings;
  notifications: AppNotification[];
  categories: CategoryItem[];
  activityLogs: ActivityLogRecord[];
  loading: boolean;
  totalCapital: number;
  totalGeneralExpenses: number;
  currentCashBalance: number;
  
  // Activity Logs
  addActivityLog: (logData: Omit<ActivityLogRecord, 'id' | 'timestamp'>) => Promise<string>;
  
  // Orders
  addOrder: (orderData: Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'remainingBalance' | 'totalPaid' | 'paymentStatus'>) => Promise<string>;
  updateOrder: (id: string, orderData: Partial<Order>) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
  addPaymentToOrder: (orderId: string, payment: Omit<PaymentEntry, 'id'>) => Promise<void>;
  
  // Workers
  addWorker: (workerData: Omit<Worker, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateWorker: (id: string, workerData: Partial<Worker>) => Promise<void>;
  deleteWorker: (id: string) => Promise<void>;
  toggleWorkerStatus: (id: string, status: 'active' | 'inactive') => Promise<void>;

  // Customers
  addCustomer: (customerData: Omit<Customer, 'id' | 'createdAt'>) => Promise<string>;
  updateCustomer: (id: string, customerData: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  
  // Inventory
  addInventoryItem: (itemData: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt' | 'reservedQuantity' | 'availableQuantity'>) => Promise<string>;
  updateInventoryItem: (id: string, itemData: Partial<InventoryItem>) => Promise<void>;
  deleteInventoryItem: (id: string) => Promise<void>;
  
  // Expenses
  addExpense: (expenseData: Omit<Expense, 'id' | 'createdAt'>) => Promise<string>;
  updateExpense: (id: string, expenseData: Partial<Expense>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  
  // Categories
  addCategory: (nameEn: string, nameAr: string) => Promise<CategoryItem>;

  // Settings
  updateSettings: (settingsData: Partial<CompanySettings>) => Promise<void>;
  
  // Utilities
  seedSampleData: () => Promise<void>;
  exportBackupJson: () => void;
  restoreBackupJson: (jsonData: string) => Promise<boolean>;
  markNotificationAsRead: (id: string) => void;
  clearAllNotifications: () => void;
  checkStockAvailability: (items: { inventoryItemId: string; quantity: number }[]) => { available: boolean; warnings: string[] };
}

const DataContext = createContext<DataContextType | undefined>(undefined);

// Firestore's real-time listener can receive the same document while a save
// request is resolving. Always merge by id so optimistic UI updates never
// render a second copy of the same record.
const upsertById = <T extends { id: string }>(items: T[], item: T): T[] => {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [item, ...items];
  return items.map((existing) => (existing.id === item.id ? item : existing));
};

const createRecordId = (prefix: string) =>
  `${prefix}_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [settings, setSettings] = useState<CompanySettings>(initialCompanySettings);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>(defaultCategories);
  const [activityLogs, setActivityLogs] = useState<ActivityLogRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Sync from Firestore or load fallback
  useEffect(() => {
    let unsubOrders: () => void = () => {};
    let unsubCustomers: () => void = () => {};
    let unsubInventory: () => void = () => {};
    let unsubExpenses: () => void = () => {};
    let unsubWorkers: () => void = () => {};
    let unsubSettings: () => void = () => {};
    let unsubCategories: () => void = () => {};
    let unsubActivityLogs: () => void = () => {};

    try {
      // Activity logs are an admin-only dataset. Workers never subscribe to
      // or receive this collection in the client.
      const canViewActivityLogs = profile?.role === 'super_admin' || profile?.role === 'admin';
      if (canViewActivityLogs) {
        unsubActivityLogs = onSnapshot(collection(db, 'activityLogs'), (snapshot) => {
          const list = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            logId: docSnap.id,
            ...docSnap.data(),
          })) as ActivityLogRecord[];
          setActivityLogs(list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
        });
      } else {
        setActivityLogs([]);
      }
      // Listener for Orders
      unsubOrders = onSnapshot(collection(db, 'orders'), (snapshot) => {
        if (!snapshot.empty) {
          const list: Order[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            list.push({ id: docSnap.id, ...data } as Order);
          });
          setOrders(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        } else {
          setOrders([]);
        }
      });

      // Listener for Workers
      unsubWorkers = onSnapshot(collection(db, 'workers'), (snapshot) => {
        if (!snapshot.empty) {
          const list: Worker[] = [];
          snapshot.forEach((docSnap) => {
            list.push({ id: docSnap.id, ...docSnap.data() } as Worker);
          });
          setWorkers(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        } else {
          setWorkers([]);
        }
      });

      // Listener for Customers
      unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
        if (!snapshot.empty) {
          const list: Customer[] = [];
          snapshot.forEach((docSnap) => {
            list.push({ id: docSnap.id, ...docSnap.data() } as Customer);
          });
          setCustomers(list);
        } else {
          setCustomers([]);
        }
      });

      // Listener for Inventory
      unsubInventory = onSnapshot(collection(db, 'inventory'), (snapshot) => {
        if (!snapshot.empty) {
          const list: InventoryItem[] = [];
          snapshot.forEach((docSnap) => {
            list.push({ id: docSnap.id, ...docSnap.data() } as InventoryItem);
          });
          setInventory(list);
        } else {
          setInventory([]);
        }
      });

      // Listener for Expenses
      unsubExpenses = onSnapshot(collection(db, 'expenses'), (snapshot) => {
        if (!snapshot.empty) {
          const list: Expense[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            list.push({
              id: docSnap.id,
              type: data.type || (data.category === 'رأس مال' ? 'capital' : 'expense'),
              category: data.category || (data.type === 'capital' ? 'رأس مال' : 'عام'),
              amount: Number(data.amount) || 0,
              date: data.date || new Date().toISOString().split('T')[0],
              addedBy: data.addedBy || '',
              notes: data.notes || data.description || '',
              ...data,
            } as Expense);
          });
          setExpenses(list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        } else {
          setExpenses([]);
        }
      });

      // Listener for Settings
      unsubSettings = onSnapshot(doc(db, 'settings', 'company'), (docSnap) => {
        if (docSnap.exists()) {
          setSettings(docSnap.data() as CompanySettings);
        } else {
          setSettings(initialCompanySettings);
        }
      });

      // Listener for Custom Categories
      unsubCategories = onSnapshot(collection(db, 'categories'), (snapshot) => {
        if (!snapshot.empty) {
          const customList: CategoryItem[] = [];
          snapshot.forEach((docSnap) => {
            customList.push({ id: docSnap.id, ...docSnap.data() } as CategoryItem);
          });
          setCategories([...defaultCategories, ...customList]);
        } else {
          setCategories(defaultCategories);
        }
      });

      setNotifications([]);
      setLoading(false);
    } catch (err) {
      console.error('Firestore listener error, fallback to local empty state:', err);
      setOrders([]);
      setWorkers([]);
      setCustomers([]);
      setInventory([]);
      setExpenses([]);
      setSettings(initialCompanySettings);
      setNotifications([]);
      setCategories(defaultCategories);
      setLoading(false);
    }

    return () => {
      unsubActivityLogs();
      unsubOrders();
      unsubWorkers();
      unsubCustomers();
      unsubInventory();
      unsubExpenses();
      unsubSettings();
      unsubCategories();
    };
  }, [profile?.role]);

  // Recalculate inventory reservations based on active orders
  const recalculateInventory = useCallback((allOrders: Order[], currentInventory: InventoryItem[]) => {
    // Statuses that actively reserve stock in warehouse
    const activeReservingStatuses = ['new', 'confirmed', 'preparing', 'out_for_delivery', 'pending', 'in_progress', 'completed'];

    const activeOrders = allOrders.filter((o) => activeReservingStatuses.includes(o.orderStatus));

    const reservedMap: Record<string, number> = {};

    activeOrders.forEach((ord) => {
      if (ord.reservedItems && Array.isArray(ord.reservedItems)) {
        ord.reservedItems.forEach((res) => {
          reservedMap[res.inventoryItemId] = (reservedMap[res.inventoryItemId] || 0) + (res.quantity || 0);
        });
      }
    });

    return currentInventory.map((item) => {
      const reserved = reservedMap[item.id] || 0;
      const available = Math.max(0, item.quantity - reserved);
      return {
        ...item,
        reservedQuantity: reserved,
        availableQuantity: available,
      };
    });
  }, []);

  // Sync inventory changes to Firestore
  const syncInventoryItemsToStore = async (updatedItems: InventoryItem[]) => {
    try {
      for (const item of updatedItems) {
        await setDoc(doc(db, 'inventory', item.id), item, { merge: true });
      }
    } catch (e) {
      console.error('Error syncing inventory:', e);
    }
  };

  // Check stock availability
  const checkStockAvailability = useCallback(
    (items: { inventoryItemId: string; quantity: number }[]) => {
      const warnings: string[] = [];
      let available = true;

      for (const requested of items) {
        const invItem = inventory.find((i) => i.id === requested.inventoryItemId);
        if (invItem) {
          if (requested.quantity > invItem.availableQuantity) {
            available = false;
            warnings.push(
              `Item "${invItem.nameAr} / ${invItem.nameEn}" requested quantity (${requested.quantity}) exceeds available quantity (${invItem.availableQuantity}).`
            );
          }
        }
      }

      return { available, warnings };
    },
    [inventory]
  );

  // Add Category
  const addCategory = async (nameEn: string, nameAr: string): Promise<CategoryItem> => {
    const key = 'custom_' + nameEn.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const newCat: CategoryItem = {
      id: 'cat_' + Date.now(),
      key,
      nameEn,
      nameAr,
      isCustom: true,
    };

    try {
      await setDoc(doc(db, 'categories', newCat.id), newCat);
    } catch (e) {
      console.warn('Saving category locally:', e);
    }

    setCategories((prev) => [...prev, newCat]);
    return newCat;
  };

  // Order Operations
  const addOrder = async (
    orderData: Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'remainingBalance' | 'totalPaid' | 'paymentStatus'>
  ): Promise<string> => {
    const newId = createRecordId('ord');
    const history = orderData.paymentHistory || [];
    
    // Calculate total paid: deposit + sum of payment history entries
    const historyPaid = history.reduce((sum, p) => sum + (p.amount || 0), 0);
    const depositPaid = orderData.deposit || 0;
    const totalPaid = Math.max(depositPaid, historyPaid);
    const remainingBalance = Math.max(0, orderData.totalPrice - totalPaid);

    let paymentStatus: 'unpaid' | 'partially_paid' | 'fully_paid' = 'unpaid';
    if (totalPaid >= orderData.totalPrice && orderData.totalPrice > 0) {
      paymentStatus = 'fully_paid';
    } else if (totalPaid > 0) {
      paymentStatus = 'partially_paid';
    }

    const now = new Date().toISOString();

    const newOrder: Order = {
      ...orderData,
      id: newId,
      totalPaid,
      remainingBalance,
      paymentStatus,
      paymentHistory: history,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await setDoc(doc(db, 'orders', newId), newOrder);
    } catch (e) {
      console.warn('Saving order locally:', e);
    }

    const updatedOrders = upsertById(orders, newOrder);
    setOrders(updatedOrders);

    // Recalculate inventory
    const updatedInventory = recalculateInventory(updatedOrders, inventory);
    setInventory(updatedInventory);
    await syncInventoryItemsToStore(updatedInventory);

    return newId;
  };

  const updateOrder = async (id: string, orderData: Partial<Order>) => {
    const existing = orders.find((o) => o.id === id);
    if (!existing) return;

    const totalPrice = orderData.totalPrice !== undefined ? orderData.totalPrice : existing.totalPrice;
    const deposit = orderData.deposit !== undefined ? orderData.deposit : existing.deposit;
    const paymentHistory = orderData.paymentHistory !== undefined ? orderData.paymentHistory : existing.paymentHistory || [];

    const historyPaid = paymentHistory.reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalPaid = Math.max(deposit, historyPaid);
    const remainingBalance = Math.max(0, totalPrice - totalPaid);

    let paymentStatus: 'unpaid' | 'partially_paid' | 'fully_paid' = 'unpaid';
    if (totalPaid >= totalPrice && totalPrice > 0) {
      paymentStatus = 'fully_paid';
    } else if (totalPaid > 0) {
      paymentStatus = 'partially_paid';
    }

    const now = new Date().toISOString();

    const updated: Order = {
      ...existing,
      ...orderData,
      totalPrice,
      deposit,
      totalPaid,
      remainingBalance,
      paymentStatus,
      paymentHistory,
      updatedAt: now,
    };

    try {
      await setDoc(doc(db, 'orders', id), updated, { merge: true });
    } catch (e) {
      console.warn('Updating order locally:', e);
    }

    const updatedOrders = orders.map((o) => (o.id === id ? updated : o));
    setOrders(updatedOrders);

    // Recalculate inventory
    const updatedInventory = recalculateInventory(updatedOrders, inventory);
    setInventory(updatedInventory);
    await syncInventoryItemsToStore(updatedInventory);
  };

  const addPaymentToOrder = async (orderId: string, payment: Omit<PaymentEntry, 'id'>) => {
    const existing = orders.find((o) => o.id === orderId);
    if (!existing) return;

    const newPaymentEntry: PaymentEntry = {
      ...payment,
      id: 'pay_' + Date.now(),
    };

    const updatedHistory = [...(existing.paymentHistory || []), newPaymentEntry];
    await updateOrder(orderId, { paymentHistory: updatedHistory });
  };

  const deleteOrder = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'orders', id));
    } catch (e) {
      console.warn('Deleting order locally:', e);
    }

    const updatedOrders = orders.filter((o) => o.id !== id);
    setOrders(updatedOrders);

    const updatedInventory = recalculateInventory(updatedOrders, inventory);
    setInventory(updatedInventory);
    await syncInventoryItemsToStore(updatedInventory);
  };

  // Workers Operations
  const addWorker = async (
    workerData: Omit<Worker, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<string> => {
    const newId = createRecordId('wrk');
    const now = new Date().toISOString();
    const newWorker: Worker = {
      ...workerData,
      id: newId,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await setDoc(doc(db, 'workers', newId), newWorker);
    } catch (e) {
      console.warn('Saving worker locally:', e);
    }

    setWorkers((prev) => upsertById(prev, newWorker));
    return newId;
  };

  const updateWorker = async (id: string, workerData: Partial<Worker>) => {
    const now = new Date().toISOString();
    const updates = { ...workerData, updatedAt: now };

    try {
      await setDoc(doc(db, 'workers', id), updates, { merge: true });
    } catch (e) {
      console.warn('Updating worker locally:', e);
    }

    setWorkers((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...updates } : w))
    );
  };

  const deleteWorker = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'workers', id));
    } catch (e) {
      console.warn('Deleting worker locally:', e);
    }
    setWorkers((prev) => prev.filter((w) => w.id !== id));
  };

  const toggleWorkerStatus = async (id: string, status: 'active' | 'inactive') => {
    await updateWorker(id, { status });
  };

  // Customers Operations
  const addCustomer = async (customerData: Omit<Customer, 'id' | 'createdAt'>): Promise<string> => {
    const newId = createRecordId('cust');
    const newCustomer: Customer = {
      ...customerData,
      id: newId,
      createdAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'customers', newId), newCustomer);
    } catch (e) {
      console.warn('Saving customer locally:', e);
    }

    setCustomers((prev) => upsertById(prev, newCustomer));
    return newId;
  };

  const updateCustomer = async (id: string, customerData: Partial<Customer>) => {
    try {
      await setDoc(doc(db, 'customers', id), customerData, { merge: true });
    } catch (e) {
      console.warn('Updating customer locally:', e);
    }
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...customerData } : c)));
  };

  const deleteCustomer = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'customers', id));
    } catch (e) {
      console.warn('Deleting customer locally:', e);
    }
    setCustomers((prev) => prev.filter((c) => c.id !== id));
  };

  // Inventory Operations
  const addInventoryItem = async (
    itemData: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt' | 'reservedQuantity' | 'availableQuantity'>
  ): Promise<string> => {
    const newId = createRecordId('inv');
    const now = new Date().toISOString();
    const newItem: InventoryItem = {
      ...itemData,
      id: newId,
      reservedQuantity: 0,
      availableQuantity: itemData.quantity,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await setDoc(doc(db, 'inventory', newId), newItem);
    } catch (e) {
      console.warn('Saving inventory item locally:', e);
    }

    const newInventoryList = [...inventory, newItem];
    const recalculated = recalculateInventory(orders, newInventoryList);
    setInventory(recalculated);
    return newId;
  };

  const updateInventoryItem = async (id: string, itemData: Partial<InventoryItem>) => {
    const existing = inventory.find((i) => i.id === id);
    if (!existing) return;

    const now = new Date().toISOString();
    const updated: InventoryItem = {
      ...existing,
      ...itemData,
      updatedAt: now,
    };

    try {
      await setDoc(doc(db, 'inventory', id), updated, { merge: true });
    } catch (e) {
      console.warn('Updating inventory locally:', e);
    }

    const updatedList = inventory.map((i) => (i.id === id ? updated : i));
    const recalculated = recalculateInventory(orders, updatedList);
    setInventory(recalculated);
  };

  const deleteInventoryItem = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'inventory', id));
    } catch (e) {
      console.warn('Deleting inventory item locally:', e);
    }
    setInventory((prev) => prev.filter((i) => i.id !== id));
  };

  // Expenses Operations
  const addExpense = async (expenseData: Omit<Expense, 'id' | 'createdAt'>): Promise<string> => {
    const newId = createRecordId('exp');
    const newExpense: Expense = {
      ...expenseData,
      id: newId,
      createdAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'expenses', newId), newExpense);
    } catch (e) {
      console.warn('Saving expense locally:', e);
    }

    setExpenses((prev) => upsertById(prev, newExpense));
    return newId;
  };

  const updateExpense = async (id: string, expenseData: Partial<Expense>) => {
    try {
      await setDoc(doc(db, 'expenses', id), expenseData, { merge: true });
    } catch (e) {
      console.warn('Updating expense locally:', e);
    }
    setExpenses((prev) => prev.map((ex) => (ex.id === id ? { ...ex, ...expenseData } : ex)));
  };

  const deleteExpense = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'expenses', id));
    } catch (e) {
      console.warn('Deleting expense locally:', e);
    }
    setExpenses((prev) => prev.filter((ex) => ex.id !== id));
  };

  // Settings Operations
  const updateSettings = async (settingsData: Partial<CompanySettings>) => {
    const newSettings = { ...settings, ...settingsData };
    try {
      await setDoc(doc(db, 'settings', 'company'), newSettings, { merge: true });
    } catch (e) {
      console.warn('Updating settings locally:', e);
    }
    setSettings(newSettings);
  };

  // Reset to empty state
  const seedSampleData = async () => {
    setLoading(true);
    try {
      await setDoc(doc(db, 'settings', 'company'), initialCompanySettings);
      setSettings(initialCompanySettings);
      setCustomers([]);
      setOrders([]);
      setInventory([]);
      setExpenses([]);
      setNotifications([]);
      setCategories(defaultCategories);
    } catch (err) {
      console.error('Error resetting data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Export Backup
  const exportBackupJson = () => {
    const backupObj = {
      exportDate: new Date().toISOString(),
      settings,
      customers,
      inventory,
      orders,
      expenses,
      categories,
    };
    const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Wedding_ERP_Backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Restore Backup
  const restoreBackupJson = async (jsonData: string): Promise<boolean> => {
    try {
      const parsed = JSON.parse(jsonData);
      if (parsed.settings && parsed.orders && parsed.inventory) {
        if (parsed.settings) await updateSettings(parsed.settings);
        if (Array.isArray(parsed.customers)) {
          for (const c of parsed.customers) await setDoc(doc(db, 'customers', c.id), c);
          setCustomers(parsed.customers);
        }
        if (Array.isArray(parsed.inventory)) {
          for (const i of parsed.inventory) await setDoc(doc(db, 'inventory', i.id), i);
          setInventory(parsed.inventory);
        }
        if (Array.isArray(parsed.orders)) {
          for (const o of parsed.orders) await setDoc(doc(db, 'orders', o.id), o);
          setOrders(parsed.orders);
        }
        if (Array.isArray(parsed.expenses)) {
          for (const e of parsed.expenses) await setDoc(doc(db, 'expenses', e.id), e);
          setExpenses(parsed.expenses);
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error('Failed to restore backup JSON:', e);
      return false;
    }
  };

  const addActivityLog = async (logData: Omit<ActivityLogRecord, 'id' | 'timestamp'>): Promise<string> => {
    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const timestamp = new Date().toISOString();
    const newRecord: ActivityLogRecord = {
      id: logId,
      logId,
      ...logData,
      timestamp,
    };

    try {
      await setDoc(doc(db, 'activityLogs', logId), newRecord);
    } catch (err) {
      console.error('Error saving activity log to Firestore:', err);
    }

    setActivityLogs((prev) => [newRecord, ...prev.filter((item) => item.id !== logId)]);
    return logId;
  };

  const markNotificationAsRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const clearAllNotifications = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const totalCapital = expenses
    .filter((e) => e.type === 'capital')
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  const totalGeneralExpenses = expenses
    .filter((e) => e.type !== 'capital')
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  const currentCashBalance = totalCapital - totalGeneralExpenses;

  return (
    <DataContext.Provider
      value={{
        orders,
        customers,
        inventory,
        expenses,
        workers,
        settings,
        notifications,
        categories,
        activityLogs,
        loading,
        totalCapital,
        totalGeneralExpenses,
        currentCashBalance,
        addActivityLog,
        addOrder,
        updateOrder,
        deleteOrder,
        addPaymentToOrder,
        addWorker,
        updateWorker,
        deleteWorker,
        toggleWorkerStatus,
        addCustomer,
        updateCustomer,
        deleteCustomer,
        addInventoryItem,
        updateInventoryItem,
        deleteInventoryItem,
        addExpense,
        updateExpense,
        deleteExpense,
        addCategory,
        updateSettings,
        seedSampleData,
        exportBackupJson,
        restoreBackupJson,
        markNotificationAsRead,
        clearAllNotifications,
        checkStockAvailability,
      }}
    >
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
