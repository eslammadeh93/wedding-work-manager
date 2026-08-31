import React, { useState } from 'react';
import { X, Plus, Trash2, Calendar, MapPin, DollarSign, Package, FileText, AlertTriangle, UserCheck, Image, Upload, ExternalLink, Receipt, ChevronDown, Check, Wrench } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import { Order, OrderItemReservation, OrderSupplierRental, PaymentStatus, OrderStatus, DesignImageItem, Worker, OrderSource, OrderAttachment } from '../../types';
import { localDateString } from '../../utils/localDate';
import { sanitizePhoneInput, toInternationalPhoneDigits } from '../../utils/phone';
import { recordedOrderPayment } from '../../utils/orderPayments';

interface OrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialOrder?: Order | null;
}

/**
 * A new order stays only in the browser until the user submits it. This lets
 * us restore in-progress work without accidentally creating a real order.
 */
interface NewOrderDraft {
  orderNumber?: string;
  selectedCustomerId?: string;
  customerName?: string;
  customerPhone?: string;
  bookingDate?: string;
  weddingDate?: string;
  deliveryDate?: string;
  returnDate?: string;
  eventLocation?: string;
  locationLink?: string;
  salesEmployee?: string;
  responsibleId?: string;
  responsibleName?: string;
  responsiblePhone?: string;
  orderSource?: OrderSource;
  workerId?: string;
  workerName?: string;
  workerCanContactCustomer?: boolean;
  totalPrice?: number;
  deposit?: number;
  securityDeposit?: number;
  workerCost?: number;
  transportationCost?: number;
  otherExpenses?: number;
  paymentMethod?: string;
  paymentStatus?: PaymentStatus;
  orderStatus?: OrderStatus;
  notes?: string;
  designImages?: DesignImageItem[];
  reservedItems?: OrderItemReservation[];
  supplierRentals?: OrderSupplierRental[];
  attachmentUrlInput?: string;
  attachmentType?: 'contract' | 'image' | 'file';
  attachments?: OrderAttachment[];
}

const readNewOrderDraft = (storageKey: string): NewOrderDraft | null => {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) as NewOrderDraft : null;
  } catch {
    // Browser storage is optional; failure must never prevent order entry.
    return null;
  }
};

const WorkerSearchableSelect: React.FC<{
  selectedWorkerId: string;
  selectedWorkerName: string;
  onSelectWorker: (workerId: string, workerName: string) => void;
  workers: Worker[];
}> = ({ selectedWorkerId, selectedWorkerName, onSelectWorker, workers }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState(selectedWorkerName || '');
  const containerRef = React.useRef<HTMLDivElement>(null);

  const activeWorkers = React.useMemo(() => {
    return (workers || []).filter((w) => w.status === 'active');
  }, [workers]);

  // When the field contains the currently assigned worker, opening the menu
  // must show every active worker. Only text explicitly changed by the user
  // is treated as a search query.
  const filterQuery = search === selectedWorkerName ? '' : search.trim().toLowerCase();
  const filtered = activeWorkers.filter(
    (w) =>
      !filterQuery ||
      w.fullName.toLowerCase().includes(filterQuery) ||
      (w.jobTitle && w.jobTitle.toLowerCase().includes(filterQuery))
  );

  React.useEffect(() => {
    setSearch(selectedWorkerName || '');
  }, [selectedWorkerName]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder="اختر العامل / المنفذ من قائمة العمال..."
        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 ltr:pr-9 rtl:pl-9 font-semibold"
      />
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="absolute inset-y-0 ltr:right-0 rtl:left-0 flex items-center px-2.5 cursor-pointer text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
      >
        <ChevronDown className="w-4 h-4" />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 max-h-52 overflow-y-auto bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl py-1">
          <button
            type="button"
            onClick={() => { onSelectWorker('', ''); setSearch(''); setIsOpen(false); }}
            className="w-full px-3.5 py-2.5 text-right text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 border-b border-slate-100 dark:border-slate-700"
          >
            إلغاء إسناد العامل
          </button>
          {filtered.length > 0 ? (
            filtered.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  onSelectWorker(w.id, w.fullName);
                  setSearch(w.fullName);
                  setIsOpen(false);
                }}
                className={`w-full text-right rtl:text-right ltr:text-left px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:text-amber-600 dark:hover:text-amber-400 transition-colors flex items-center justify-between border-b border-slate-100 dark:border-slate-800/50 last:border-0 ${
                  selectedWorkerId === w.id ? 'bg-amber-50/80 dark:bg-amber-950/30 font-bold text-amber-600 dark:text-amber-400' : ''
                }`}
              >
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">{w.fullName}</div>
                  <div className="text-[10px] text-slate-400">{w.jobTitle || 'عامل'}</div>
                </div>
                {selectedWorkerId === w.id && <Check className="w-4 h-4 text-amber-500 shrink-0" />}
              </button>
            ))
          ) : (
            <div className="px-3.5 py-3 text-xs text-slate-400 italic text-center">
              لا يوجد عمال مفعلين مطابقين للبحث
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const OrderModal: React.FC<OrderModalProps> = ({
  isOpen,
  onClose,
  initialOrder,
}) => {
  const { t, language } = useLanguage();
  const { orders, customers, suppliers, inventory, workers, settings, addOrder, updateOrder, checkStockAvailability } = useData();
  const { authSession, user } = useAuth();

  const isEdit = !!initialOrder;
  const canManageWorkerContact = authSession?.role === 'manager' || authSession?.role === 'company_super_admin';
  const draftStorageKey = React.useMemo(() => {
    const ownerId = authSession?.companyId || authSession?.uid || user?.uid || 'legacy';
    return `wedding_order_draft:${ownerId}`;
  }, [authSession?.companyId, authSession?.uid, user?.uid]);
  const [initialDraft] = useState<NewOrderDraft | null>(() => isEdit ? null : readNewOrderDraft(draftStorageKey));

  // Form State
  const [orderNumber, setOrderNumber] = useState(
    initialOrder?.orderNumber || initialDraft?.orderNumber || `WED-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState(initialOrder?.customerId || initialDraft?.selectedCustomerId || '');
  const [customerName, setCustomerName] = useState(initialOrder?.customerName || initialDraft?.customerName || '');
  const [customerPhone, setCustomerPhone] = useState(initialOrder?.customerPhone || initialDraft?.customerPhone || '');
  const [bookingDate, setBookingDate] = useState(
    initialOrder?.bookingDate || initialDraft?.bookingDate || localDateString()
  );
  const [weddingDate, setWeddingDate] = useState(
    initialOrder?.weddingDate || initialDraft?.weddingDate || localDateString()
  );
  const [deliveryDate, setDeliveryDate] = useState(
    initialOrder?.deliveryDate || initialDraft?.deliveryDate || localDateString()
  );
  const [returnDate, setReturnDate] = useState(
    initialOrder?.returnDate || initialDraft?.returnDate || ''
  );
  const [eventLocation, setEventLocation] = useState(initialOrder?.eventLocation || initialDraft?.eventLocation || '');
  const [locationLink, setLocationLink] = useState(initialOrder?.locationLink || initialDraft?.locationLink || '');
  const [salesEmployee, setSalesEmployee] = useState(initialOrder?.salesEmployee || initialDraft?.salesEmployee || '');
  const [responsibleId, setResponsibleId] = useState(initialOrder?.responsibleId || initialDraft?.responsibleId || '');
  const [responsibleName, setResponsibleName] = useState(initialOrder?.responsibleName || initialOrder?.salesEmployee || initialDraft?.responsibleName || initialDraft?.salesEmployee || '');
  const [responsiblePhone, setResponsiblePhone] = useState(initialOrder?.responsiblePhone || initialDraft?.responsiblePhone || '');
  const [orderSource, setOrderSource] = useState<OrderSource>(initialOrder?.orderSource || initialDraft?.orderSource || 'other');
  
  // Worker assignment
  const [workerId, setWorkerId] = useState(initialOrder?.workerId || initialDraft?.workerId || '');
  const [workerName, setWorkerName] = useState(initialOrder?.workerName || initialOrder?.executorName || initialDraft?.workerName || '');
  const [workerCanContactCustomer, setWorkerCanContactCustomer] = useState(initialOrder?.workerCanContactCustomer === true || initialDraft?.workerCanContactCustomer === true);
  const [totalPrice, setTotalPrice] = useState<number>(initialOrder?.totalPrice ?? initialDraft?.totalPrice ?? 0);
  const [deposit, setDeposit] = useState<number>(initialOrder?.deposit ?? initialDraft?.deposit ?? 0);
  const [securityDeposit, setSecurityDeposit] = useState<number>(initialOrder?.securityDeposit ?? initialDraft?.securityDeposit ?? 0);
  const [workerCost, setWorkerCost] = useState<number>(initialOrder?.workerCost ?? initialDraft?.workerCost ?? 0);
  const [transportationCost, setTransportationCost] = useState<number>(initialOrder?.transportationCost ?? initialDraft?.transportationCost ?? 0);
  const [otherExpenses, setOtherExpenses] = useState<number>(initialOrder?.otherExpenses ?? initialDraft?.otherExpenses ?? 0);
  const [paymentMethod, setPaymentMethod] = useState(initialOrder?.paymentMethod || initialDraft?.paymentMethod || 'InstaPay');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    initialOrder?.paymentStatus || initialDraft?.paymentStatus || 'unpaid'
  );
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(
    initialOrder?.orderStatus || initialDraft?.orderStatus || 'new'
  );
  const [notes, setNotes] = useState(initialOrder?.notes || initialDraft?.notes || '');
  const [designImages, setDesignImages] = useState<DesignImageItem[]>(() => {
    if (initialOrder?.designImages && initialOrder.designImages.length > 0) {
      return initialOrder.designImages;
    }
    if (initialOrder?.designImageUrl && initialOrder.designImageUrl.trim()) {
      return [{ url: initialOrder.designImageUrl.trim(), createdAt: initialOrder.createdAt || new Date().toISOString() }];
    }
    return initialDraft?.designImages?.length ? initialDraft.designImages : [{ url: '', createdAt: new Date().toISOString() }];
  });

  const handleAddDesignImage = () => {
    setDesignImages((prev) => [...prev, { url: '', createdAt: new Date().toISOString() }]);
  };

  const handleUpdateDesignImage = (index: number, url: string) => {
    setDesignImages((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], url };
      return updated;
    });
  };

  const handleRemoveDesignImage = (index: number) => {
    setDesignImages((prev) => {
      if (prev.length <= 1) {
        return [{ url: '', createdAt: new Date().toISOString() }];
      }
      return prev.filter((_, i) => i !== index);
    });
  };
  const [reservedItems, setReservedItems] = useState<OrderItemReservation[]>(
    initialOrder?.reservedItems || initialDraft?.reservedItems || []
  );
  const [supplierRentals, setSupplierRentals] = useState<OrderSupplierRental[]>(initialOrder?.supplierRentals || initialDraft?.supplierRentals || []);
  const [attachmentUrlInput, setAttachmentUrlInput] = useState(initialDraft?.attachmentUrlInput || '');
  const [attachmentType, setAttachmentType] = useState<'contract' | 'image' | 'file'>(initialDraft?.attachmentType || 'contract');
  const [attachments, setAttachments] = useState<OrderAttachment[]>(initialOrder?.attachments || initialDraft?.attachments || []);
  const [stockWarning, setStockWarning] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const persistDraft = React.useCallback(() => {
    if (isEdit) return;
    const draft: NewOrderDraft = {
      orderNumber, selectedCustomerId, customerName, customerPhone,
      bookingDate, weddingDate, deliveryDate, returnDate, eventLocation,
      locationLink, salesEmployee, responsibleId, responsibleName, responsiblePhone, orderSource, workerId, workerName,
      workerCanContactCustomer, totalPrice, deposit, securityDeposit,
      workerCost, transportationCost, otherExpenses, paymentMethod,
      paymentStatus, orderStatus, notes, designImages, reservedItems,
      supplierRentals, attachmentUrlInput, attachmentType, attachments,
    };
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify(draft));
    } catch {
      // Storage can be disabled by the browser. The order form remains usable.
    }
  }, [
    isEdit, draftStorageKey, orderNumber, selectedCustomerId, customerName,
    customerPhone, bookingDate, weddingDate, deliveryDate, returnDate,
    eventLocation, locationLink, salesEmployee, responsibleId, responsibleName, responsiblePhone, orderSource, workerId,
    workerName, workerCanContactCustomer, totalPrice, deposit, securityDeposit,
    workerCost, transportationCost, otherExpenses, paymentMethod, paymentStatus,
    orderStatus, notes, designImages, reservedItems, supplierRentals,
    attachmentUrlInput, attachmentType, attachments,
  ]);

  React.useEffect(() => {
    persistDraft();
  }, [persistDraft]);

  React.useEffect(() => {
    if (isEdit) return;
    window.addEventListener('beforeunload', persistDraft);
    return () => window.removeEventListener('beforeunload', persistDraft);
  }, [isEdit, persistDraft]);

  const clearDraft = () => {
    if (isEdit) return;
    try {
      localStorage.removeItem(draftStorageKey);
    } catch {
      // Storage cleanup is best-effort and should not affect a saved order.
    }
  };

  const handleClose = () => {
    persistDraft();
    onClose();
  };

  const handleStartFreshOrder = () => {
    clearDraft();
    setOrderNumber(`WED-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`);
    setSelectedCustomerId('');
    setCustomerName('');
    setCustomerPhone('');
    setBookingDate(localDateString());
    setWeddingDate(localDateString());
    setDeliveryDate(localDateString());
    setReturnDate('');
    setEventLocation('');
    setLocationLink('');
    setSalesEmployee('');
    setOrderSource('other');
    setWorkerId('');
    setWorkerName('');
    setWorkerCanContactCustomer(false);
    setTotalPrice(0);
    setDeposit(0);
    setSecurityDeposit(0);
    setWorkerCost(0);
    setTransportationCost(0);
    setOtherExpenses(0);
    setPaymentMethod('InstaPay');
    setPaymentStatus('unpaid');
    setOrderStatus('new');
    setNotes('');
    setDesignImages([{ url: '', createdAt: new Date().toISOString() }]);
    setReservedItems([]);
    setSupplierRentals([]);
    setAttachmentUrlInput('');
    setAttachmentType('contract');
    setAttachments([]);
    setStockWarning(null);
  };

  const phoneMatches = React.useMemo(() => {
    const typedPhone = toInternationalPhoneDigits(customerPhone);
    if (typedPhone.length < 3) return [];

    return customers
      .filter((customer) => {
        const savedPhone = toInternationalPhoneDigits(customer.phone);
        return Boolean(savedPhone) && (savedPhone.includes(typedPhone) || typedPhone.includes(savedPhone));
      })
      .slice(0, 5);
  }, [customers, customerPhone]);

  if (!isOpen) return null;

  // The deposit is only the first payment. On an existing order use every
  // recorded payment so this number remains accurate after settlement.
  const paymentRecordedSoFar = initialOrder
    ? Math.max(recordedOrderPayment(initialOrder), Number(deposit) || 0)
    : Number(deposit) || 0;
  const remainingBalance = Math.max(0, totalPrice - paymentRecordedSoFar);
  const totalOrderExpenses = (Number(workerCost) || 0) + (Number(transportationCost) || 0) + (Number(otherExpenses) || 0);
  const expectedNetProfit = (Number(totalPrice) || 0) - totalOrderExpenses;

  const handleCustomerSelect = (id: string) => {
    setSelectedCustomerId(id);
    const found = customers.find((c) => c.id === id);
    if (found) {
      setCustomerName(found.name);
      setCustomerPhone(sanitizePhoneInput(found.phone));
    }
  };

  const handleCustomerPhoneChange = (value: string) => {
    const phone = sanitizePhoneInput(value);
    setCustomerPhone(phone);
    const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
    if (selectedCustomer && toInternationalPhoneDigits(selectedCustomer.phone) !== toInternationalPhoneDigits(phone)) {
      setSelectedCustomerId('');
    }
  };

  const handleAddReservedItem = (invId: string) => {
    const invItem = inventory.find((i) => i.id === invId);
    if (!invItem) return;

    if (reservedItems.some((r) => r.inventoryItemId === invId)) return;

    const itemName = language === 'ar' ? invItem.nameAr : invItem.nameEn;
    const newItems = [
      ...reservedItems,
      {
        inventoryItemId: invId,
        inventoryItemName: itemName,
        quantity: 1,
      },
    ];

    const check = checkStockAvailability(newItems);
    if (!check.available) {
      setStockWarning(check.warnings.join('\n'));
    } else {
      setStockWarning(null);
    }

    setReservedItems(newItems);
  };

  const handleUpdateReservedQty = (invId: string, qty: number) => {
    const updated = reservedItems.map((r) =>
      r.inventoryItemId === invId ? { ...r, quantity: Math.max(1, qty) } : r
    );

    const check = checkStockAvailability(updated);
    if (!check.available) {
      setStockWarning(check.warnings.join('\n'));
    } else {
      setStockWarning(null);
    }

    setReservedItems(updated);
  };

  const handleRemoveReservedItem = (invId: string) => {
    const updated = reservedItems.filter((r) => r.inventoryItemId !== invId);
    const check = checkStockAvailability(updated);
    if (!check.available) {
      setStockWarning(check.warnings.join('\n'));
    } else {
      setStockWarning(null);
    }
    setReservedItems(updated);
  };

  const addSupplierRental = () => {
    setSupplierRentals((current) => [...current, {
      id: `supplier_rental_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`,
      supplierId: '', supplierName: '', serviceType: '', itemDescription: '', quantity: 1, notes: '',
    }]);
  };

  const updateSupplierRental = (id: string, changes: Partial<OrderSupplierRental>) => {
    setSupplierRentals((current) => current.map((line) => line.id === id ? { ...line, ...changes } : line));
  };

  const selectSupplierForRental = (id: string, supplierId: string) => {
    const supplier = suppliers.find((item) => item.id === supplierId);
    if (!supplier) return;
    const line = supplierRentals.find((item) => item.id === id);
    updateSupplierRental(id, {
      supplierId: supplier.id,
      supplierName: supplier.name,
      // Start with the supplier's registered service, while allowing it to
      // be customized for the exact service used in this order.
      serviceType: line?.serviceType || supplier.service || '',
    });
  };

  const removeSupplierRental = (id: string) => setSupplierRentals((current) => current.filter((line) => line.id !== id));

  const handleAddAttachment = () => {
    if (!attachmentUrlInput.trim()) return;
    setAttachments([
      ...attachments,
      {
        id: 'att_' + Date.now(),
        name: attachmentType === 'contract' ? 'Wedding_Contract.pdf' : 'Design_File.jpg',
        url: attachmentUrlInput.trim(),
        type: attachmentType,
      },
    ]);
    setAttachmentUrlInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);

    try {
    if (workerName.trim()) {
      try {
        const existing = JSON.parse(localStorage.getItem('wedding_saved_executors') || '[]');
        if (!existing.includes(workerName.trim())) {
          localStorage.setItem('wedding_saved_executors', JSON.stringify([...existing, workerName.trim()]));
        }
      } catch (err) {
        console.error(err);
      }
    }

    const cleanedDesignImages = designImages.filter((img) => img.url.trim().length > 0);
    const firstDesignImageUrl = cleanedDesignImages[0]?.url || '';

    const payload = {
      orderNumber,
      customerId: selectedCustomerId,
      customerName,
      customerPhone,
      bookingDate,
      weddingDate,
      eventDate: weddingDate,
      deliveryDate,
      // An empty string intentionally clears a previously saved return date.
      // Some orders do not require dismantling/return.
      returnDate: returnDate || '',
      eventLocation,
      locationLink: locationLink.trim(),
      salesEmployee: responsibleName.trim() || salesEmployee.trim(),
      responsibleId: responsibleId.trim(),
      responsibleName: responsibleName.trim(),
      responsiblePhone: responsiblePhone.trim(),
      orderSource,
      workerId: workerId.trim(),
      workerName: workerName.trim(),
      executorName: workerName.trim(),
      workerCanContactCustomer: workerId.trim() ? workerCanContactCustomer : false,
      totalPrice: Number(totalPrice),
      deposit: Number(deposit),
      securityDeposit: Number(securityDeposit) || 0,
      workerCost: Number(workerCost) || 0,
      transportationCost: Number(transportationCost) || 0,
      otherExpenses: Number(otherExpenses) || 0,
      paymentMethod,
      paymentStatus,
      orderStatus,
      notes,
      designImageUrl: firstDesignImageUrl,
      designImages: cleanedDesignImages,
      reservedItems,
      supplierRentals: supplierRentals.map((line) => ({
        ...line,
        serviceType: line.serviceType.trim(),
        itemDescription: line.itemDescription.trim(),
        notes: line.notes?.trim() || '',
        quantity: Math.max(1, Number(line.quantity) || 1),
      })),
      attachments,
      paymentHistory: initialOrder?.paymentHistory || [
        {
          id: 'pay_init_' + Date.now(),
          amount: Number(deposit),
          // Booking date is explicitly the date the deposit was received; using
          // today's date makes historical monthly cash reports inaccurate.
          date: bookingDate || localDateString(),
          method: paymentMethod,
          type: 'deposit',
          notes: 'Initial Deposit Payment',
        },
      ],
    };

    if (isEdit && initialOrder) {
      await updateOrder(initialOrder.id, payload);
    } else {
      await addOrder(
        payload,
        selectedCustomerId ? undefined : {
          name: customerName.trim(),
          phone: customerPhone,
          notes: `Created via Order ${orderNumber}`,
        },
      );
    }
    clearDraft();
    onClose();
    } catch (error) {
      setStockWarning(error instanceof Error ? error.message : 'تعذر حفظ الطلب. حاول مرة أخرى.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div onClick={handleClose} className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[90vh] flex flex-col my-auto animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-slate-900 dark:text-white text-lg flex items-center gap-2 whitespace-nowrap">
              <FileText className="w-5 h-5 text-amber-500" />
              <span>{isEdit ? t('editOrder') : t('newOrder')}</span>
            </h3>
            <button
              onClick={handleClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {!isEdit && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <span className="inline-flex min-h-10 items-center justify-center rounded-xl bg-amber-100 px-3 text-center text-xs font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                حفظ تلقائي كمسودة
              </span>
              <button
                type="button"
                onClick={handleStartFreshOrder}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-700 shadow-sm transition-colors hover:bg-rose-100 dark:border-rose-900/70 dark:bg-rose-950/25 dark:text-rose-300 dark:hover:bg-rose-950/45"
                title="حذف المسودة وبدء أوردر جديد فارغ"
              >
                <Trash2 className="h-4 w-4" />
                <span>مسح المسودة</span>
              </button>
            </div>
          )}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Section 1: Order Basics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="-order-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('orderNumber')}
              </label>
              <input
                type="text"
                required
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 font-mono font-bold"
              />
            </div>

            <div className="-order-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('selectCustomer')}
              </label>
              <select
                value={selectedCustomerId}
                onChange={(e) => handleCustomerSelect(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 mb-2"
              >
                <option value="">-- {t('newCustomer')} --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>
            </div>

            <div className="-order-3">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('customerName')}
              </label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. Sarah Al-Ahmad"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="order-first sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('phoneNumber')}
              </label>
              <input
                type="text"
                required
                value={customerPhone}
                onChange={(e) => handleCustomerPhoneChange(e.target.value)}
                placeholder="01xxxxxxxxx"
                inputMode="tel"
                autoFocus={!isEdit}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
              />
              {!selectedCustomerId && phoneMatches.length > 0 && (
                <div className="mt-2 overflow-hidden rounded-xl border border-amber-200 bg-amber-50/70 dark:border-amber-900/70 dark:bg-amber-950/20">
                  <p className="px-3 py-2 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                    {language === 'ar' ? 'عميل موجود بنفس الرقم أو رقم قريب — اختره لملء البيانات:' : 'Existing customer match — select to fill their details:'}
                  </p>
                  {phoneMatches.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => handleCustomerSelect(customer.id)}
                      className="flex w-full items-center justify-between gap-3 border-t border-amber-200/80 px-3 py-2.5 text-right text-xs transition-colors hover:bg-amber-100 dark:border-amber-900/70 dark:hover:bg-amber-950/50"
                    >
                      <span className="font-bold text-slate-800 dark:text-slate-100">{customer.name}</span>
                      <span className="font-mono font-semibold text-amber-700 dark:text-amber-300" dir="ltr">{customer.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5 text-indigo-500" />
                <span>المسؤول عن الأوردر</span>
              </label>
              <select
                value={responsibleId || (responsibleName ? '__legacy__' : '')}
                onChange={(e) => {
                  const selectedId = e.target.value;
                  const person = (settings.orderResponsibles || []).find((item) => item.id === selectedId);
                  setResponsibleId(person?.id || '');
                  setResponsibleName(person?.name || '');
                  setResponsiblePhone(person?.phone || '');
                  setSalesEmployee(person?.name || '');
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">بدون مسؤول</option>
                {responsibleName && !responsibleId && <option value="__legacy__">{responsibleName}</option>}
                {(settings.orderResponsibles || []).filter((person) => !person.deletedAt).map((person) => <option key={person.id} value={person.id}>{person.name}{person.phone ? ` — ${person.phone}` : ''}</option>)}
              </select>
              {(settings.orderResponsibles || []).filter((person) => !person.deletedAt).length === 0 && <p className="mt-1 text-[11px] text-slate-500">أضف المسؤولين من صفحة إدارة الموظفين أولًا.</p>}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {language === 'ar' ? 'مصدر الأوردر' : 'Order source'}
              </label>
              <select
                value={orderSource}
                onChange={(e) => setOrderSource(e.target.value as OrderSource)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 font-semibold"
              >
                <option value="organic">{language === 'ar' ? 'أورجانيك' : 'Organic'}</option>
                <option value="campaign">{language === 'ar' ? 'كامبين' : 'Campaign'}</option>
                <option value="other">{language === 'ar' ? 'أخرى' : 'Other'}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                <Wrench className="w-3.5 h-3.5 text-amber-500" />
                <span>{isEdit ? 'تغيير العامل المسند' : `${t('executor')} / العامل المسند`}</span>
              </label>
              <WorkerSearchableSelect
                selectedWorkerId={workerId}
                selectedWorkerName={workerName}
                onSelectWorker={(wId, wName) => {
                  if (isEdit && wId !== workerId) {
                    setWorkerCanContactCustomer(false);
                    window.alert('تغيير العامل المسند سيوقف صلاحية رؤية رقم العميلة والتواصل معها. يمكنك تفعيلها يدويًا للعامل الجديد بعد الحفظ.');
                  } else if (!wId) {
                    setWorkerCanContactCustomer(false);
                  }
                  setWorkerId(wId);
                  setWorkerName(wName);
                }}
                workers={workers}
              />
              <p className="mt-1 text-[11px] text-slate-500">اكتب للبحث ثم اختر العامل من القائمة حتى يتم حفظ الـWorker ID الصحيح.</p>
              {canManageWorkerContact && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                  <label className="flex cursor-pointer items-start justify-between gap-3">
                    <span>
                      <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">السماح للعامل برؤية رقم العميلة والتواصل معها</span>
                      <span className="mt-1 block text-[11px] leading-5 text-slate-500 dark:text-slate-400">عند التفعيل، سيتمكن العامل المسند من رؤية رقم العميلة واستخدام الاتصال وWhatsApp.</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={workerCanContactCustomer}
                      aria-label="السماح للعامل برؤية رقم العميلة والتواصل معها"
                      disabled={!workerId}
                      onClick={() => setWorkerCanContactCustomer(value => !value)}
                      className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${workerCanContactCustomer ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                    >
                      <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${workerCanContactCustomer ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </label>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-rose-500" />
                <span>{t('eventLocation')}</span>
              </label>
              <input
                type="text"
                required
                value={eventLocation}
                onChange={(e) => setEventLocation(e.target.value)}
                placeholder={t('enterLocation')}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="col-span-1 sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-amber-500" />
                  <span>{t('installationLocation')} ({t('locationLink')})</span>
                </span>
                {locationLink.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      const url = locationLink.trim().startsWith('http') ? locationLink.trim() : `https://${locationLink.trim()}`;
                      window.open(url, '_blank');
                    }}
                    className="text-amber-600 hover:text-amber-700 dark:text-amber-400 font-bold text-xs flex items-center gap-1 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{t('openLocation')}</span>
                  </button>
                )}
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={locationLink}
                  onChange={(e) => setLocationLink(e.target.value)}
                  placeholder="https://maps.google.com/..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
                />
                {locationLink.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      const url = locationLink.trim().startsWith('http') ? locationLink.trim() : `https://${locationLink.trim()}`;
                      window.open(url, '_blank');
                    }}
                    className="px-3.5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>{t('openLocation')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Dates (Booking, Event, Delivery, Return) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-emerald-500" />
                <span>{t('bookingDate')}</span>
              </label>
              <input
                type="date"
                required
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-amber-500" />
                <span>{t('eventDate')}</span>
              </label>
              <input
                type="date"
                required
                value={weddingDate}
                onChange={(e) => setWeddingDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-blue-500" />
                <span>{t('deliveryDate')}</span>
              </label>
              <input
                type="date"
                required
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1 whitespace-nowrap">
                <Calendar className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                <span className="flex items-center gap-1">
                  <span>{t('returnDate')}</span>
                </span>
                {returnDate && (
                  <button
                    type="button"
                    onClick={() => setReturnDate('')}
                    title={language === 'ar' ? 'إلغاء التاريخ' : 'Clear date'}
                    aria-label={language === 'ar' ? 'إلغاء التاريخ' : 'Clear date'}
                    className="ms-auto p-0.5 text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </label>
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 font-medium"
              />
            </div>
          </div>

          {/* Section 3: Financials & Status */}
          <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 rounded-2xl border border-amber-200/60 dark:border-amber-900/40 space-y-4">
            <h4 className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
              <DollarSign className="w-4 h-4" />
              <span>Financials & Payments</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('totalPrice')}
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={totalPrice}
                  onChange={(e) => setTotalPrice(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-bold outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('deposit')}
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={deposit}
                  onChange={(e) => setDeposit(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-bold outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('securityDeposit')} ({language === 'ar' ? 'التأمين' : 'Security Deposit'})
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={securityDeposit}
                  onChange={(e) => setSecurityDeposit(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 text-slate-900 dark:text-white text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('remainingBalance')}
                </label>
                <div className="w-full px-3.5 py-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-100/60 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 text-sm font-extrabold">
                  ${remainingBalance.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('paymentMethod')}
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="InstaPay">InstaPay (انستا باي)</option>
                  <option value="Cash">Cash (كاش / نقدي)</option>
                  <option value="E-Wallet">E-Wallet (محفظة إلكترونية)</option>
                  <option value="PayPal">PayPal (بايبال)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('paymentStatus')}
                </label>
                <select
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="unpaid">{t('unpaid')}</option>
                  <option value="partially_paid">{t('partiallyPaid')}</option>
                  <option value="fully_paid">{t('fullyPaid')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('orderStatus')}
                </label>
                <select
                  value={orderStatus}
                  onChange={(e) => setOrderStatus(e.target.value as OrderStatus)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-semibold outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="new">{t('statusNew')}</option>
                  <option value="confirmed">{t('statusConfirmed')}</option>
                  <option value="preparing">{t('statusPreparing')}</option>
                  <option value="out_for_delivery">{t('statusOutForDelivery')}</option>
                  <option value="completed">{t('statusCompleted')}</option>
                  <option value="returned">{t('statusReturned')}</option>
                  <option value="cancelled">{t('statusCancelled')}</option>
                  <option value="cancelled_deposit_retained">{t('statusCancelledDepositRetained')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section: Order Expenses / مصروفات الطلب */}
          <div className="p-4 bg-rose-50/40 dark:bg-rose-950/20 rounded-2xl border border-rose-200/60 dark:border-rose-900/40 space-y-4">
            <h4 className="text-xs font-bold text-rose-800 dark:text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
              <Receipt className="w-4 h-4 text-rose-500" />
              <span>{t('orderExpensesSection')}</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('workerCost')}
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={workerCost}
                  onChange={(e) => setWorkerCost(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-bold outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('transportationCost')}
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={transportationCost}
                  onChange={(e) => setTransportationCost(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-bold outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('otherExpenses')}
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={otherExpenses}
                  onChange={(e) => setOtherExpenses(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-bold outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('totalOrderExpenses')}
                </label>
                <div className="w-full px-3.5 py-2.5 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-100/60 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200 text-sm font-extrabold">
                  ${totalOrderExpenses.toLocaleString()}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('expectedNetProfit')}
                </label>
                <div className="w-full px-3.5 py-2.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-100/60 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 text-sm font-extrabold">
                  ${expectedNetProfit.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Section: Suppliers & external rentals */}
          <div className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900/50 dark:bg-violet-950/15">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-1.5 text-xs font-black text-slate-800 dark:text-slate-100"><Wrench className="h-4 w-4 text-violet-600 dark:text-violet-400" /> الموردين والتأجير الخارجي</h3>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">أضف كل بند منفصلًا؛ يمكنك اختيار نفس المورد في أكثر من بند.</p>
              </div>
              <button type="button" onClick={addSupplierRental} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-violet-700"><Plus className="h-3.5 w-3.5" /> إضافة بند</button>
            </div>
            {supplierRentals.length === 0 ? <p className="rounded-xl border border-dashed border-violet-200 bg-white/70 p-3 text-xs text-slate-500 dark:border-violet-900/60 dark:bg-slate-900/40 dark:text-slate-400">اضغط «إضافة بند» لاختيار المورد وتسجيل الخدمة أو الشيء المستأجر.</p> : <div className="space-y-3">
              {supplierRentals.map((line, index) => <div key={line.id} className="rounded-xl border border-violet-100 bg-white p-3 dark:border-violet-900/50 dark:bg-slate-900">
                <div className="mb-3 flex items-center justify-between"><span className="text-[11px] font-black text-violet-700 dark:text-violet-300">بند تأجير #{index + 1}</span><button type="button" onClick={() => removeSupplierRental(line.id)} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30" title="حذف البند"><Trash2 className="h-4 w-4" /></button></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">المورد *<select required value={line.supplierId} onChange={(event) => selectSupplierForRental(line.id, event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"><option value="">اختر المورد</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} — {supplier.service}{supplier.status === 'inactive' ? ' (موقوف)' : ''}</option>)}</select></label>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">نوع الخدمة *<input required value={line.serviceType} onChange={(event) => updateSupplierRental(line.id, { serviceType: event.target.value })} placeholder="مثال: إضاءة، ورد، كراسي" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">البند المستأجر *<input required value={line.itemDescription} onChange={(event) => updateSupplierRental(line.id, { itemDescription: event.target.value })} placeholder="مثال: 200 كرسي شيافاري ذهبي" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">الكمية<input type="number" min="1" value={line.quantity || 1} onChange={(event) => updateSupplierRental(line.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
                </div>
                <label className="mt-3 block text-xs font-bold text-slate-700 dark:text-slate-300">ملاحظات البند<input value={line.notes || ''} onChange={(event) => updateSupplierRental(line.id, { notes: event.target.value })} placeholder="مقاس، لون، موعد استلام أو تفاصيل إضافية" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
              </div>)}
            </div>}
          </div>

          {/* Section: Design Image / صورة التصميم */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
                <Image className="w-4 h-4 text-indigo-500" />
                <span>{t('designImageSection')}</span>
              </h4>

              <div className="flex items-center gap-2">
                {/* 2. Upload Design Image */}
                <button
                  type="button"
                  onClick={() => {
                    window.open('https://drive.google.com/drive/u/1/folders/1mkwZJhpDPTZHiC-RZE8E31xXAF6Rsjh8', '_blank');
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shrink-0 shadow-xs cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{t('uploadDesignImage')}</span>
                </button>

                {/* Circular "+" Button */}
                <button
                  type="button"
                  onClick={handleAddDesignImage}
                  title={t('addDesignImageLink')}
                  className="w-8 h-8 rounded-full bg-amber-500 hover:bg-amber-600 text-white transition-colors flex items-center justify-center shrink-0 shadow-xs cursor-pointer font-bold"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* List of Design Image Links */}
            <div className="space-y-3 pt-1">
              {designImages.map((item, index) => (
                <div key={index} className="flex flex-col md:flex-row items-stretch md:items-end gap-2.5">
                  {/* 1. Design Image Link */}
                  <div className="flex-1">
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t('designImageUrl')} {designImages.length > 1 ? `#${index + 1}` : ''}
                    </label>
                    <input
                      type="url"
                      value={item.url}
                      onChange={(e) => handleUpdateDesignImage(index, e.target.value)}
                      placeholder={t('pasteDriveLink')}
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 text-left dir-ltr"
                    />
                  </div>

                  {/* Buttons: [ فتح ] and [ حذف ] */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (item.url && item.url.trim().length > 0) {
                          window.open(item.url.trim(), '_blank');
                        } else {
                          alert(t('noLink'));
                        }
                      }}
                      className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1 shrink-0 shadow-xs cursor-pointer h-[38px]"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>{t('openLink')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRemoveDesignImage(index)}
                      className="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold transition-colors flex items-center justify-center gap-1 shrink-0 cursor-pointer h-[38px]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t('deleteLink')}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Reserved Inventory Equipment */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Package className="w-4 h-4 text-emerald-500" />
                <span>{t('reservedInventory')}</span>
              </label>

              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleAddReservedItem(e.target.value);
                    e.target.value = '';
                  }
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 outline-none cursor-pointer"
              >
                <option value="">+ {t('addReservedItem')}</option>
                {inventory.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    [{inv.itemCode || 'INV'}] {language === 'ar' ? inv.nameAr : inv.nameEn} ({t('availableQuantity')}: {inv.availableQuantity})
                  </option>
                ))}
              </select>
            </div>

            {stockWarning && (
              <div className="p-3 bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 rounded-xl text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span className="whitespace-pre-line">{stockWarning}</span>
              </div>
            )}

            {reservedItems.length === 0 ? (
              <p className="text-xs text-slate-400 italic p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl">
                No equipment reserved for this order yet.
              </p>
            ) : (
              <div className="space-y-2">
                {reservedItems.map((res) => {
                  const invInfo = inventory.find((i) => i.id === res.inventoryItemId);
                  return (
                    <div
                      key={res.inventoryItemId}
                      className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-between gap-3 border border-slate-200 dark:border-slate-700"
                    >
                      <span className="text-xs font-bold text-slate-900 dark:text-white flex-1 truncate">
                        {res.inventoryItemName}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">Qty:</span>
                        <input
                          type="number"
                          min="1"
                          value={res.quantity}
                          onChange={(e) =>
                            handleUpdateReservedQty(res.inventoryItemId, Number(e.target.value))
                          }
                          className="w-16 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs text-center font-bold"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveReservedItem(res.inventoryItemId)}
                          className="p-1 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-950/40 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 5: Notes & Contract Attachments */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('notes')}
              </label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Special decoration instructions, Kosha theme, lighting choices..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('attachments')} ({t('contract')}, {t('images')}, {t('files')})
              </label>
              <div className="flex gap-2 mb-2">
                <select
                  value={attachmentType}
                  onChange={(e) => setAttachmentType(e.target.value as any)}
                  className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                >
                  <option value="contract">{t('contract')}</option>
                  <option value="image">{t('images')}</option>
                  <option value="file">{t('files')}</option>
                </select>

                <input
                  type="url"
                  value={attachmentUrlInput}
                  onChange={(e) => setAttachmentUrlInput(e.target.value)}
                  placeholder="https://example.com/contract.pdf or design.jpg"
                  className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddAttachment}
                  className="px-3 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="relative group px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200"
                    >
                      {att.type === 'contract' ? <FileText className="w-4 h-4" /> : <Image className="w-4 h-4" />}
                      <span>{att.type === 'contract' ? 'Contract' : 'Image'}</span>
                      <button
                        type="button"
                        onClick={() => setAttachments(attachments.filter((a) => a.id !== att.id))}
                        className="text-rose-500 hover:text-rose-700"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Submit Action */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-md shadow-amber-500/20"
            >
              {isSaving ? 'جارٍ الحفظ...' : t('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
