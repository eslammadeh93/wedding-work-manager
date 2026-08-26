import type { ActivityLogRecord, AppNotification, CategoryItem, CompanySettings, Customer, Expense, InventoryItem, Order, Supplier, Worker, WorkTask } from '../types';

export interface DemoStore {
  settings: CompanySettings;
  orders: Order[];
  workTasks: WorkTask[];
  customers: Customer[];
  suppliers: Supplier[];
  inventory: InventoryItem[];
  expenses: Expense[];
  workers: Worker[];
  categories: CategoryItem[];
  notifications: AppNotification[];
  activityLogs: ActivityLogRecord[];
}

const dateAfter = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

const timestampBefore = (offsetDays: number) => {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  return date.toISOString();
};

/** A fresh, entirely fictional workspace. Never source this data from Firebase. */
export const createDemoStore = (): DemoStore => {
  const now = new Date().toISOString();
  const customers: Customer[] = [
    { id: 'demo_customer_1', name: 'سارة أحمد', phone: '01000000001', email: 'sara@example.test', address: 'القاهرة الجديدة', notes: 'حفل مسائي', orderIds: ['demo_order_1'], createdAt: timestampBefore(12), updatedAt: timestampBefore(12) },
    { id: 'demo_customer_2', name: 'نور محمد', phone: '01000000002', email: 'nour@example.test', address: 'الشيخ زايد', notes: 'تحتاج معاينة قبل التنفيذ', orderIds: ['demo_order_2'], createdAt: timestampBefore(8), updatedAt: timestampBefore(8) },
    { id: 'demo_customer_3', name: 'عمر خالد', phone: '01000000003', email: 'omar@example.test', address: 'التجمع الخامس', orderIds: ['demo_order_3'], createdAt: timestampBefore(3), updatedAt: timestampBefore(3) },
    { id: 'demo_customer_4', name: 'مريم سمير', phone: '01000000004', email: 'mariam@example.test', address: 'المعادي', notes: 'ديكور أبيض بسيط', orderIds: ['demo_order_4'], createdAt: timestampBefore(18), updatedAt: timestampBefore(2) },
    { id: 'demo_customer_5', name: 'يوسف عادل', phone: '01000000005', email: 'youssef@example.test', address: 'مدينة نصر', notes: 'حفل خارجي', orderIds: ['demo_order_5'], createdAt: timestampBefore(16), updatedAt: timestampBefore(1) },
    { id: 'demo_customer_6', name: 'ليلى حسن', phone: '01000000006', email: 'laila@example.test', address: '6 أكتوبر', notes: 'ورد طبيعي', orderIds: ['demo_order_6'], createdAt: timestampBefore(25), updatedAt: timestampBefore(4) },
    { id: 'demo_customer_7', name: 'كريم شريف', phone: '01000000007', email: 'karim@example.test', address: 'العبور', notes: 'التجهيز قبل الظهر', orderIds: ['demo_order_7'], createdAt: timestampBefore(28), updatedAt: timestampBefore(6) },
    { id: 'demo_customer_8', name: 'هنا طارق', phone: '01000000008', email: 'hana@example.test', address: 'الرحاب', notes: 'تأكيد قائمة الضيوف', orderIds: ['demo_order_8'], createdAt: timestampBefore(9), updatedAt: timestampBefore(1) },
    { id: 'demo_customer_9', name: 'أدهم ومي', phone: '01000000009', email: 'adham@example.test', address: 'الهرم', notes: 'زفاف عائلي', orderIds: ['demo_order_9'], createdAt: timestampBefore(6), updatedAt: timestampBefore(1) },
    { id: 'demo_customer_10', name: 'دينا فؤاد', phone: '01000000010', email: 'dina@example.test', address: 'الشروق', notes: 'مطلوب إضاءة إضافية', orderIds: ['demo_order_10'], createdAt: timestampBefore(2), updatedAt: timestampBefore(1) },
  ];
  const inventory: InventoryItem[] = [
    { id: 'demo_inventory_1', itemCode: 'CHR-001', nameAr: 'كراسي ذهبية', nameEn: 'Golden Chairs', category: 'golden_chairs', quantity: 250, totalQuantity: 250, availableQuantity: 180, reservedQuantity: 70, minStockLevel: 30, storageLocation: 'المخزن الرئيسي', condition: 'good', rentalPricePerUnit: 45, createdAt: timestampBefore(30), updatedAt: now },
    { id: 'demo_inventory_2', itemCode: 'TBL-001', nameAr: 'طاولات دائرية', nameEn: 'Round Tables', category: 'round_tables', quantity: 35, totalQuantity: 35, availableQuantity: 22, reservedQuantity: 13, minStockLevel: 5, storageLocation: 'المخزن الرئيسي', condition: 'good', rentalPricePerUnit: 250, createdAt: timestampBefore(30), updatedAt: now },
    { id: 'demo_inventory_3', itemCode: 'DEC-001', nameAr: 'ستاند ورود', nameEn: 'Flower Stands', category: 'flowers', quantity: 18, totalQuantity: 18, availableQuantity: 4, reservedQuantity: 14, minStockLevel: 5, storageLocation: 'غرفة الديكور', condition: 'needs_repair', rentalPricePerUnit: 550, createdAt: timestampBefore(20), updatedAt: now },
    { id: 'demo_inventory_4', itemCode: 'LGT-001', nameAr: 'وحدات إضاءة', nameEn: 'Lighting Units', category: 'lighting', quantity: 40, totalQuantity: 40, availableQuantity: 31, reservedQuantity: 9, minStockLevel: 8, storageLocation: 'المخزن الرئيسي', condition: 'new', rentalPricePerUnit: 180, createdAt: timestampBefore(20), updatedAt: now },
    { id: 'demo_inventory_5', itemCode: 'CHR-002', nameAr: 'كراسي بيضاء', nameEn: 'White Chairs', category: 'white_chairs', quantity: 180, totalQuantity: 180, availableQuantity: 128, reservedQuantity: 52, minStockLevel: 25, storageLocation: 'المخزن الرئيسي', condition: 'good', rentalPricePerUnit: 35, createdAt: timestampBefore(27), updatedAt: now },
    { id: 'demo_inventory_6', itemCode: 'BCK-001', nameAr: 'خلفية مرايا', nameEn: 'Mirror Backdrop', category: 'backdrops', quantity: 6, totalQuantity: 6, availableQuantity: 5, reservedQuantity: 1, minStockLevel: 2, storageLocation: 'غرفة الديكور', condition: 'good', rentalPricePerUnit: 1800, createdAt: timestampBefore(20), updatedAt: now },
    { id: 'demo_inventory_7', itemCode: 'LGT-002', nameAr: 'سلاسل إضاءة', nameEn: 'Fairy Lights', category: 'lighting', quantity: 24, totalQuantity: 24, availableQuantity: 6, reservedQuantity: 18, minStockLevel: 6, storageLocation: 'غرفة الديكور', condition: 'good', rentalPricePerUnit: 280, createdAt: timestampBefore(18), updatedAt: now },
    { id: 'demo_inventory_8', itemCode: 'CAR-001', nameAr: 'ممر أبيض', nameEn: 'White Aisle Runner', category: 'carpets', quantity: 10, totalQuantity: 10, availableQuantity: 8, reservedQuantity: 2, minStockLevel: 2, storageLocation: 'المخزن الرئيسي', condition: 'good', rentalPricePerUnit: 450, createdAt: timestampBefore(17), updatedAt: now },
    { id: 'demo_inventory_9', itemCode: 'ACC-001', nameAr: 'شمعدانات كريستال', nameEn: 'Crystal Candles', category: 'accessories', quantity: 32, totalQuantity: 32, availableQuantity: 24, reservedQuantity: 8, minStockLevel: 6, storageLocation: 'غرفة الديكور', condition: 'fair', rentalPricePerUnit: 90, createdAt: timestampBefore(15), updatedAt: now },
    { id: 'demo_inventory_10', itemCode: 'TBL-002', nameAr: 'طاولات كيك', nameEn: 'Cake Tables', category: 'tables', quantity: 12, totalQuantity: 12, availableQuantity: 9, reservedQuantity: 3, minStockLevel: 3, storageLocation: 'المخزن الرئيسي', condition: 'new', rentalPricePerUnit: 320, createdAt: timestampBefore(14), updatedAt: now },
  ];
  const workers: Worker[] = [
    { id: 'demo_worker_1', fullName: 'أحمد سامي', username: 'ahmed.demo', loginCode: '1234', jobTitle: 'مشرف تجهيزات', phone: '01000000011', status: 'active', notes: 'بيانات تجريبية', createdAt: timestampBefore(60), updatedAt: now },
    { id: 'demo_worker_2', fullName: 'محمود علي', username: 'mahmoud.demo', loginCode: '1234', jobTitle: 'فني ديكور', phone: '01000000012', status: 'active', notes: 'بيانات تجريبية', createdAt: timestampBefore(45), updatedAt: now },
    { id: 'demo_worker_3', fullName: 'خالد هشام', username: 'khaled.demo', loginCode: '1234', jobTitle: 'فني إضاءة', phone: '01000000013', status: 'active', notes: 'بيانات تجريبية', createdAt: timestampBefore(40), updatedAt: now },
    { id: 'demo_worker_4', fullName: 'منى عادل', username: 'mona.demo', loginCode: '1234', jobTitle: 'منسقة ورود', phone: '01000000014', status: 'active', notes: 'بيانات تجريبية', createdAt: timestampBefore(35), updatedAt: now },
    { id: 'demo_worker_5', fullName: 'إسلام وليد', username: 'islam.demo', loginCode: '1234', jobTitle: 'سائق ونقل', phone: '01000000015', status: 'active', notes: 'بيانات تجريبية', createdAt: timestampBefore(28), updatedAt: now },
    { id: 'demo_worker_6', fullName: 'ريم أشرف', username: 'reem.demo', loginCode: '1234', jobTitle: 'مساعدة تجهيزات', phone: '01000000016', status: 'inactive', notes: 'بيانات تجريبية', createdAt: timestampBefore(22), updatedAt: now },
  ];
  const orders: Order[] = [
    { id: 'demo_order_1', orderNumber: 'DEM-1001', customerId: 'demo_customer_1', customerName: 'سارة أحمد', customerPhone: '01000000001', bookingDate: dateAfter(-12), weddingDate: dateAfter(4), eventDate: dateAfter(4), deliveryDate: dateAfter(3), returnDate: dateAfter(5), eventLocation: 'قاعة اللوتس - القاهرة الجديدة', salesEmployee: 'فريق المبيعات', orderSource: 'organic', executorName: 'أحمد سامي', workerId: 'demo_worker_1', workerName: 'أحمد سامي', workerCanContactCustomer: true, totalPrice: 28000, deposit: 10000, totalPaid: 10000, remainingBalance: 18000, paymentStatus: 'partially_paid', paymentMethod: 'cash', paymentHistory: [{ id: 'demo_payment_1', amount: 10000, date: dateAfter(-12), method: 'cash', type: 'deposit' }], orderStatus: 'confirmed', reservedItems: [{ inventoryItemId: 'demo_inventory_1', inventoryItemName: 'كراسي ذهبية', quantity: 70 }, { inventoryItemId: 'demo_inventory_2', inventoryItemName: 'طاولات دائرية', quantity: 12 }], attachments: [], notes: 'تنسيق ذهبي وأبيض', createdAt: timestampBefore(12), updatedAt: now },
    { id: 'demo_order_2', orderNumber: 'DEM-1002', customerId: 'demo_customer_2', customerName: 'نور محمد', customerPhone: '01000000002', bookingDate: dateAfter(-8), weddingDate: dateAfter(10), eventDate: dateAfter(10), deliveryDate: dateAfter(9), returnDate: dateAfter(11), eventLocation: 'فندق النخبة - الشيخ زايد', salesEmployee: 'فريق المبيعات', orderSource: 'campaign', executorName: 'محمود علي', workerId: 'demo_worker_2', workerName: 'محمود علي', workerCanContactCustomer: true, totalPrice: 42500, deposit: 15000, totalPaid: 15000, remainingBalance: 27500, paymentStatus: 'partially_paid', paymentMethod: 'bank_transfer', paymentHistory: [{ id: 'demo_payment_2', amount: 15000, date: dateAfter(-8), method: 'bank_transfer', type: 'deposit' }], orderStatus: 'preparing', reservedItems: [{ inventoryItemId: 'demo_inventory_3', inventoryItemName: 'ستاند ورود', quantity: 10 }, { inventoryItemId: 'demo_inventory_4', inventoryItemName: 'وحدات إضاءة', quantity: 9 }], attachments: [], notes: 'تصميم ورد طبيعي', createdAt: timestampBefore(8), updatedAt: now },
    { id: 'demo_order_3', orderNumber: 'DEM-1003', customerId: 'demo_customer_3', customerName: 'عمر خالد', customerPhone: '01000000003', bookingDate: dateAfter(-3), weddingDate: dateAfter(18), eventDate: dateAfter(18), deliveryDate: dateAfter(17), returnDate: dateAfter(19), eventLocation: 'قاعة رويال - التجمع الخامس', salesEmployee: 'فريق المبيعات', orderSource: 'other', totalPrice: 19000, deposit: 0, totalPaid: 0, remainingBalance: 19000, paymentStatus: 'unpaid', paymentHistory: [], orderStatus: 'new', reservedItems: [], attachments: [], notes: 'بانتظار تأكيد العميل', createdAt: timestampBefore(3), updatedAt: now },
  ];
  const makeOrder = (number: number, eventOffset: number, totalPrice: number, deposit: number, status: Order['orderStatus'], workerIndex: number, location: string, source: Order['orderSource']): Order => {
    const customer = customers[number - 1]; const worker = workerIndex ? workers[workerIndex - 1] : undefined; const eventDate = dateAfter(eventOffset);
    return { id: `demo_order_${number}`, orderNumber: `DEM-${1000 + number}`, customerId: customer.id, customerName: customer.name, customerPhone: customer.phone, bookingDate: dateAfter(-30 + number * 3), weddingDate: eventDate, eventDate, deliveryDate: dateAfter(eventOffset - 1), returnDate: dateAfter(eventOffset + 1), eventLocation: location, salesEmployee: 'فريق المبيعات', orderSource: source, executorName: worker?.fullName, workerId: worker?.id, workerName: worker?.fullName, workerCanContactCustomer: Boolean(worker), totalPrice, deposit, totalPaid: deposit, remainingBalance: totalPrice - deposit, paymentStatus: deposit >= totalPrice ? 'fully_paid' : deposit > 0 ? 'partially_paid' : 'unpaid', paymentMethod: deposit ? 'cash' : undefined, paymentHistory: deposit ? [{ id: `demo_payment_${number}`, amount: deposit, date: dateAfter(-30 + number * 3), method: 'cash', type: 'deposit' }] : [], orderStatus: status, reservedItems: number % 2 === 0 ? [{ inventoryItemId: 'demo_inventory_5', inventoryItemName: 'كراسي بيضاء', quantity: 40 }, { inventoryItemId: 'demo_inventory_7', inventoryItemName: 'سلاسل إضاءة', quantity: 6 }] : [{ inventoryItemId: 'demo_inventory_6', inventoryItemName: 'خلفية مرايا', quantity: 1 }, { inventoryItemId: 'demo_inventory_9', inventoryItemName: 'شمعدانات كريستال', quantity: 8 }], attachments: [], notes: 'بيانات أوردر تجريبية للعرض', createdAt: timestampBefore(30 - number * 2), updatedAt: now };
  };
  orders.push(
    makeOrder(4, 2, 33500, 20000, 'out_for_delivery', 3, 'فندق جراند - المعادي', 'organic'),
    makeOrder(5, 7, 26000, 8000, 'confirmed', 4, 'حديقة الأوركيد - مدينة نصر', 'campaign'),
    makeOrder(6, -5, 38000, 38000, 'completed', 5, 'قاعة لايف - أكتوبر', 'organic'),
    makeOrder(7, -12, 22000, 22000, 'completed', 2, 'قاعة ريفيرا - العبور', 'other'),
    makeOrder(8, 14, 46000, 15000, 'confirmed', 1, 'فندق بالم - الرحاب', 'campaign'),
    makeOrder(9, 21, 31000, 5000, 'new', 3, 'قاعة الأندلس - الهرم', 'organic'),
    makeOrder(10, 28, 27500, 0, 'pending', 4, 'قاعة روز - الشروق', 'other'),
  );
  return {
    settings: { companyNameAr: 'ليالي الزفاف للتجهيزات', companyNameEn: 'Layali Wedding Events', phone: '01000000000', email: 'hello@layali-demo.test', addressAr: 'القاهرة، مصر', addressEn: 'Cairo, Egypt', taxNumber: 'DEMO-0000', termsAr: 'هذه بيانات تجريبية للعرض فقط.', termsEn: 'This is fictional demonstration data only.' },
    customers,
    inventory,
    workers,
    orders,
    suppliers: [
      { id: 'demo_supplier_1', name: 'زهور النيل', contactPerson: 'منى عادل', phone: '01000000021', whatsapp: '01000000021', service: 'ورود وتنسيق', area: 'القاهرة', serviceAreas: ['القاهرة الجديدة', 'الشيخ زايد'], status: 'active', rating: 5, createdAt: timestampBefore(40), updatedAt: now },
      { id: 'demo_supplier_2', name: 'إضاءات برايت', contactPerson: 'كريم حسن', phone: '01000000022', service: 'إضاءة وصوت', area: 'الجيزة', serviceAreas: ['الجيزة', 'القاهرة'], status: 'active', rating: 4, createdAt: timestampBefore(25), updatedAt: now },
      { id: 'demo_supplier_3', name: 'مفروشات إليت', contactPerson: 'شادي نبيل', phone: '01000000023', whatsapp: '01000000023', service: 'مفروشات وكراسي', area: 'القاهرة الجديدة', serviceAreas: ['القاهرة الجديدة', 'الرحاب'], status: 'active', rating: 5, priceNotes: 'أسعار تجريبية', createdAt: timestampBefore(30), updatedAt: now },
      { id: 'demo_supplier_4', name: 'حلويات السرايا', contactPerson: 'هالة سامح', phone: '01000000024', service: 'كيك وحلويات', area: 'مدينة نصر', serviceAreas: ['مدينة نصر', 'المعادي'], status: 'active', rating: 4, createdAt: timestampBefore(22), updatedAt: now },
      { id: 'demo_supplier_5', name: 'نقل إكسبريس', contactPerson: 'عمر سيد', phone: '01000000025', service: 'نقل وتجهيز', area: 'العبور', serviceAreas: ['القاهرة', 'الجيزة'], status: 'inactive', rating: 4, createdAt: timestampBefore(19), updatedAt: now },
      { id: 'demo_supplier_6', name: 'ديكور فيجن', contactPerson: 'رامي فتحي', phone: '01000000026', service: 'خلفيات وستاندات', area: '6 أكتوبر', serviceAreas: ['6 أكتوبر', 'الشيخ زايد'], status: 'active', rating: 5, createdAt: timestampBefore(12), updatedAt: now },
    ],
    expenses: [
      { id: 'demo_expense_1', type: 'capital', category: 'رأس مال', amount: 120000, date: dateAfter(-30), addedBy: 'مدير الديمو', notes: 'بيانات تجريبية', createdAt: timestampBefore(30) },
      { id: 'demo_expense_2', type: 'expense', category: 'نقل', amount: 3200, date: dateAfter(-2), addedBy: 'مدير الديمو', notes: 'بيانات تجريبية', createdAt: timestampBefore(2) },
      { id: 'demo_expense_3', type: 'expense', category: 'صيانة', amount: 1850, date: dateAfter(-7), addedBy: 'مدير الديمو', notes: 'صيانة تجريبية', createdAt: timestampBefore(7) },
      { id: 'demo_expense_4', type: 'expense', category: 'ورود ومستلزمات', amount: 6500, date: dateAfter(-10), addedBy: 'مدير الديمو', notes: 'توريد تجريبي', createdAt: timestampBefore(10) },
      { id: 'demo_expense_5', type: 'expense', category: 'رواتب', amount: 14500, date: dateAfter(-15), addedBy: 'مدير الديمو', notes: 'رواتب فريق التجهيز', createdAt: timestampBefore(15) },
      { id: 'demo_expense_6', type: 'expense', category: 'تسويق وإعلانات', amount: 4200, date: dateAfter(-20), addedBy: 'مدير الديمو', notes: 'حملة تجريبية', createdAt: timestampBefore(20) },
      { id: 'demo_expense_7', type: 'expense', category: 'إيجار مخزن', amount: 9000, date: dateAfter(-28), addedBy: 'مدير الديمو', notes: 'إيجار شهري', createdAt: timestampBefore(28) },
      { id: 'demo_expense_8', type: 'expense', category: 'ضيافة', amount: 1250, date: dateAfter(-35), addedBy: 'مدير الديمو', notes: 'مصروفات متنوعة', createdAt: timestampBefore(35) },
      { id: 'demo_expense_9', type: 'capital', category: 'رأس مال', amount: 50000, date: dateAfter(-60), addedBy: 'مدير الديمو', notes: 'زيادة رأس مال', createdAt: timestampBefore(60) },
    ],
    categories: [
      { id: 'demo_cat_1', key: 'golden_chairs', nameEn: 'Golden Chairs', nameAr: 'كراسي ذهبية' },
      { id: 'demo_cat_2', key: 'round_tables', nameEn: 'Round Tables', nameAr: 'طاولات دائرية' },
      { id: 'demo_cat_3', key: 'flowers', nameEn: 'Flowers', nameAr: 'ورود وزهور' },
      { id: 'demo_cat_4', key: 'lighting', nameEn: 'Lighting', nameAr: 'إضاءة وكشافات' },
      { id: 'demo_cat_5', key: 'white_chairs', nameEn: 'White Chairs', nameAr: 'كراسي بيضاء' },
      { id: 'demo_cat_6', key: 'backdrops', nameEn: 'Backdrops', nameAr: 'خلفيات وكوش' },
      { id: 'demo_cat_7', key: 'carpets', nameEn: 'Carpets', nameAr: 'سجاد وممرات' },
      { id: 'demo_cat_8', key: 'accessories', nameEn: 'Accessories', nameAr: 'إكسسوارات' },
    ],
    workTasks: [
      { id: 'demo_task_1', title: 'مراجعة تجهيزات قاعة اللوتس', details: 'تأكيد حجز الكراسي والطاولات', executionDate: dateAfter(2), workerId: 'demo_worker_1', workerName: 'أحمد سامي', status: 'pending', createdAt: timestampBefore(1), updatedAt: now },
      { id: 'demo_task_2', title: 'تجهيز وحدات الإضاءة', details: 'اختبار الإضاءة قبل التحميل', executionDate: dateAfter(4), workerId: 'demo_worker_3', workerName: 'خالد هشام', status: 'pending', createdAt: timestampBefore(2), updatedAt: now },
      { id: 'demo_task_3', title: 'معاينة فندق النخبة', details: 'تحديد مسار النقل', executionDate: dateAfter(6), workerId: 'demo_worker_2', workerName: 'محمود علي', status: 'pending', createdAt: timestampBefore(3), updatedAt: now },
      { id: 'demo_task_4', title: 'تنسيق الورد الطبيعي', details: 'مراجعة لون الورد مع العميلة', executionDate: dateAfter(8), workerId: 'demo_worker_4', workerName: 'منى عادل', status: 'pending', createdAt: timestampBefore(4), updatedAt: now },
      { id: 'demo_task_5', title: 'تسليم تجهيزات الحفل', details: 'تأكيد الاستلام من القاعة', executionDate: dateAfter(-1), workerId: 'demo_worker_5', workerName: 'إسلام وليد', status: 'completed', createdAt: timestampBefore(5), updatedAt: now, completedAt: timestampBefore(1) },
      { id: 'demo_task_6', title: 'تنظيف وإعادة المخزون', details: 'فرز القطع المحتاجة للصيانة', executionDate: dateAfter(-3), workerId: 'demo_worker_6', workerName: 'ريم أشرف', status: 'completed', createdAt: timestampBefore(6), updatedAt: now, completedAt: timestampBefore(2) },
      { id: 'demo_task_7', title: 'تأكيد سيارة النقل', details: 'التواصل مع السائق قبل الموعد', executionDate: dateAfter(12), workerId: 'demo_worker_5', workerName: 'إسلام وليد', status: 'pending', createdAt: timestampBefore(1), updatedAt: now },
      { id: 'demo_task_8', title: 'تجهيز كوشة المرايا', details: 'فحص القطع والزجاج', executionDate: dateAfter(15), workerId: 'demo_worker_2', workerName: 'محمود علي', status: 'pending', createdAt: timestampBefore(1), updatedAt: now },
    ],
    notifications: [
      { id: 'demo_notification_1', type: 'upcoming_wedding', titleAr: 'موعد قريب', messageAr: 'حفل سارة أحمد خلال أيام.', read: false, linkModule: 'orders', referenceId: 'demo_order_1', orderId: 'demo_order_1', createdAt: now },
      { id: 'demo_notification_2', type: 'pending_payment', titleAr: 'دفعة معلقة', messageAr: 'متبقي مبلغ في طلب DEM-1002.', read: false, linkModule: 'orders', referenceId: 'demo_order_2', orderId: 'demo_order_2', createdAt: timestampBefore(1) },
      { id: 'demo_notification_3', type: 'low_inventory', titleAr: 'مخزون منخفض', messageAr: 'ستاندات الورود قاربت على النفاد.', read: false, linkModule: 'inventory', createdAt: timestampBefore(1) },
      { id: 'demo_notification_4', type: 'worker_arrived', titleAr: 'وصول العامل', messageAr: 'أحمد سامي وصل للموقع.', read: true, linkModule: 'orders', referenceId: 'demo_order_4', orderId: 'demo_order_4', createdAt: timestampBefore(2) },
    ],
    activityLogs: orders.slice(0, 8).flatMap((order, index) => [{ id: `demo_log_${index}_1`, logId: `demo_log_${index}_1`, orderId: order.id, orderNumber: order.orderNumber, workerId: workers[index % 5].id, workerName: workers[index % 5].fullName, action: 'opened', actionText: 'تمت مراجعة تفاصيل الطلب', timestamp: timestampBefore(index + 1), customerName: order.customerName, eventDate: order.eventDate || order.weddingDate }, { id: `demo_log_${index}_2`, logId: `demo_log_${index}_2`, orderId: order.id, orderNumber: order.orderNumber, workerId: workers[index % 5].id, workerName: workers[index % 5].fullName, action: index % 2 ? 'arrived' : 'finished', actionText: index % 2 ? 'تم الوصول للموقع' : 'تم إنهاء التجهيز', timestamp: timestampBefore(index + 1), customerName: order.customerName, eventDate: order.eventDate || order.weddingDate }]),
  };
};
