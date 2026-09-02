import { Order, Customer, InventoryItem, Expense, CompanySettings, AppNotification } from '../types';

export const initialCompanySettings: CompanySettings = {
  companyNameAr: 'مدير أعمال الويدينج',
  companyNameEn: 'Wedding Work Manager',
  phone: '',
  email: '',
  addressAr: '',
  addressEn: '',
  taxNumber: '',
  designUploadFolderUrl: '',
  termsAr: '1. التوقيع على هذا العقد يعتبر إقراراً بالموافقة على جميع البنود.\n2. يتم تسليم الموقع قبل الحفل بـ 12 ساعة على الأقل.\n3. يتحمل العميل مسؤولية الأضرار أو فقدان المعدات أثناء الفعالية.',
  termsEn: '1. Signing this contract signifies acceptance of all terms.\n2. Site delivery shall be made at least 12 hours prior to the event.\n3. Customer assumes responsibility for equipment loss or damage during event.',
};

export const initialInventory: InventoryItem[] = [];

export const initialCustomers: Customer[] = [];

export const initialOrders: Order[] = [];

export const initialExpenses: Expense[] = [];

export const initialNotifications: AppNotification[] = [];


