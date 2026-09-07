import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOrderCustomers } from '../src/utils/orderCustomer';
import type { Customer, Order } from '../src/types';

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 'ord-1', customerId: 'cus-1', customerName: 'الاسم القديم', customerPhone: '01000000000',
  orderNumber: 'ORD-1', weddingDate: '2026-09-10', deliveryDate: '2026-09-10', eventLocation: '',
  totalPrice: 0, deposit: 0, totalPaid: 0, remainingBalance: 0, paymentStatus: 'unpaid', paymentHistory: [],
  orderStatus: 'new', reservedItems: [], attachments: [], createdAt: '', updatedAt: '', ...overrides,
});

const customer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'cus-1', name: 'الاسم الجديد', phone: '01111111111', createdAt: '', ...overrides,
});

test('uses the latest customer name and phone for its linked order', () => {
  assert.deepEqual(resolveOrderCustomers([order()], [customer()])[0], order({
    customerName: 'الاسم الجديد', customerPhone: '01111111111',
  }));
});

test('keeps legacy orders unchanged when their customer record is unavailable', () => {
  const legacyOrder = order();
  assert.equal(resolveOrderCustomers([legacyOrder], [customer({ id: 'another-customer' })])[0], legacyOrder);
});
