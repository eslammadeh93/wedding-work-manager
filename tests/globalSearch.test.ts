import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSearchText, searchGlobalData } from '../src/utils/globalSearch';

test('normalizeSearchText safely normalizes null, undefined, numbers, dates, Arabic and English', () => {
  assert.equal(normalizeSearchText(undefined), '');
  assert.equal(normalizeSearchText(null), '');
  assert.equal(normalizeSearchText(1200), '1200');
  assert.equal(normalizeSearchText('  WEDDING Hall  '), 'wedding hall');
  assert.equal(normalizeSearchText('  قاعة النور  '), 'قاعة النور');
});

test('typing the first Arabic or English character never throws with incomplete legacy records', () => {
  const legacySources = {
    orders: [null, undefined, {}, { id: 'o1', customerName: undefined, eventLocation: 'Cairo' }],
    customers: [{ id: 'c1', name: undefined, phone: null }, { id: 'c2', name: 'أحمد' }],
    workers: [{ id: 'w1', fullName: undefined, phone: null }, { id: 'w2', fullName: 'John' }],
    inventory: [{ id: 'i1', nameAr: undefined, nameEn: null, itemCode: 'A-10' }],
    expenses: [{ id: 'e1', title: null, description: undefined, category: null, notes: 'قديم' }],
    categories: [{ id: 'cat1', nameAr: undefined, nameEn: null, key: 'chairs' }],
  };

  assert.doesNotThrow(() => searchGlobalData(legacySources, 'a'));
  assert.doesNotThrow(() => searchGlobalData(legacySources, 'أ'));
  assert.equal(searchGlobalData(legacySources, 'c').orders.length, 1);
  assert.equal(searchGlobalData(legacySources, 'أ').customers.length, 1);
  assert.equal(searchGlobalData(legacySources, 'j').workers.length, 1);
});

test('searches every global-search source and normalizes numeric and date fields', () => {
  const sources = {
    orders: [{ id: 'o1', orderNumber: 'ORD-9', weddingDate: '2026-08-20', totalPrice: 7500 }],
    customers: [{ id: 'c1', email: 'CLIENT@EXAMPLE.COM' }],
    workers: [{ id: 'w1', username: 'PHOTOGRAPHER' }],
    inventory: [{ id: 'i1', nameAr: 'كراسي ذهبية', quantity: 120 }],
    expenses: [{ id: 'e1', description: null, amount: 450, date: '2026-08-06' }],
    categories: [{ id: 'cat1', nameEn: 'Flowers', nameAr: 'ورود' }],
  };

  assert.equal(searchGlobalData(sources, 'ord').orders.length, 1);
  assert.equal(searchGlobalData(sources, 'example').customers.length, 1);
  assert.equal(searchGlobalData(sources, 'photo').workers.length, 1);
  assert.equal(searchGlobalData(sources, 'ذهبية').inventory.length, 1);
  assert.equal(searchGlobalData(sources, 450).expenses.length, 1);
  assert.equal(searchGlobalData(sources, '2026-08-20').orders.length, 1);
  assert.equal(searchGlobalData(sources, 'flowers').categories.length, 1);
});

test('skips invalid array entries and keeps valid partial records searchable by available fields', () => {
  const results = searchGlobalData({
    orders: [null, 'bad record', 10, [], { id: 'partial', notes: 'available detail' }],
  }, 'detail');

  assert.equal(results.orders.length, 1);
  assert.equal(results.orders[0].id, 'partial');
});
