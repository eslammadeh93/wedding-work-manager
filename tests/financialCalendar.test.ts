import assert from 'node:assert/strict';
import test from 'node:test';
import type { Order } from '../src/types';
import {
  availableFinancialYears,
  financialDateKey,
  financialMonthKey,
  financialYear,
  isInFinancialMonth,
  monthAnchor,
  monthKeyOf,
  orderFinancialDates,
  recentMonthWindows,
  shiftMonths,
} from '../src/utils/financialCalendar';

const order = (changes: Partial<Order>): Order => ({
  id: 'order-1', orderNumber: 'ORD-1', customerId: 'c1', customerName: 'عميل', customerPhone: '',
  bookingDate: '2026-08-02', weddingDate: '2026-08-20', eventDate: '2026-08-20', deliveryDate: '2026-08-20', eventLocation: '',
  totalPrice: 2000, deposit: 500, totalPaid: 500, remainingBalance: 1500, paymentStatus: 'partially_paid',
  paymentHistory: [], orderStatus: 'confirmed', reservedItems: [], attachments: [], createdAt: '2026-08-02', updatedAt: '2026-08-02',
  ...changes,
});

// --- month anchoring -------------------------------------------------------

test('the month before March 31 is February, not March again', () => {
  // `setMonth(getMonth() - 1)` on 31 March asks for 31 February, which rolls
  // forward into March, so the previous month came back as March.
  const march31 = new Date(2026, 2, 31);
  const previous = shiftMonths(monthAnchor(march31.getFullYear(), march31.getMonth()), -1);

  assert.equal(previous.getFullYear(), 2026);
  assert.equal(previous.getMonth(), 1, 'February');
  assert.equal(monthKeyOf(previous.getFullYear(), previous.getMonth()), '2026-02');
});

test('the month before January is the previous December', () => {
  const previous = shiftMonths(monthAnchor(2026, 0), -1);
  assert.equal(monthKeyOf(previous.getFullYear(), previous.getMonth()), '2025-12');

  const next = shiftMonths(monthAnchor(2026, 11), 1);
  assert.equal(monthKeyOf(next.getFullYear(), next.getMonth()), '2027-01');
});

const keyOf = (anchor: Date) => monthKeyOf(anchor.getFullYear(), anchor.getMonth());

test('leap-year February is handled from every neighbouring day', () => {
  // 2028 is a leap year, 2026 is not.
  assert.equal(keyOf(shiftMonths(monthAnchor(2028, 2), -1)), '2028-02', 'March back to February in a leap year');
  assert.equal(keyOf(shiftMonths(monthAnchor(2028, 1), 1)), '2028-03', 'February forward to March');
  assert.equal(keyOf(shiftMonths(monthAnchor(2026, 2), -1)), '2026-02', 'and in a non-leap year');
  // A 29 February date-only value is classified on its own day, not shifted.
  assert.equal(financialDateKey('2028-02-29'), '2028-02-29');
  assert.equal(financialMonthKey('2028-02-29'), '2028-02');
  assert.equal(isInFinancialMonth('2028-02-29', 2028, 1), true);
});

test('a six-month window is chronological, complete and free of duplicates', () => {
  for (const from of [new Date(2026, 2, 31), new Date(2026, 0, 31), new Date(2026, 6, 31), new Date(2026, 11, 31)]) {
    const windows = recentMonthWindows(6, from);
    const keys = windows.map((window) => window.key);

    assert.equal(keys.length, 6);
    assert.equal(new Set(keys).size, 6, `duplicate month from ${from.toDateString()}: ${keys.join(', ')}`);
    assert.deepEqual([...keys].sort(), keys, `months are not chronological from ${from.toDateString()}`);
    assert.equal(keys[5], monthKeyOf(from.getFullYear(), from.getMonth()), 'the window ends with the current month');
  }
});

test('a six-month window crosses the year boundary correctly', () => {
  assert.deepEqual(
    recentMonthWindows(6, new Date(2026, 1, 15)).map((window) => window.key),
    ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'],
  );
});

test('no month is skipped when walking back a full year from a 31st', () => {
  const keys = recentMonthWindows(13, new Date(2026, 6, 31)).map((window) => window.key);
  assert.equal(new Set(keys).size, 13, 'every month appears exactly once');
  assert.deepEqual(keys, [
    '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
  ]);
});

// --- date-only values ------------------------------------------------------

test('a YYYY-MM-DD value never shifts into another calendar day', () => {
  // Parsing '2026-01-01' as an instant is midnight UTC, which reads as
  // 2025-12-31 in any western zone: the wrong day, month and year at once.
  for (const value of ['2026-01-01', '2026-08-31', '2028-02-29', '2026-12-31']) {
    assert.equal(financialDateKey(value), value);
  }
  assert.equal(financialMonthKey('2026-01-01'), '2026-01');
  assert.equal(financialYear('2026-01-01'), 2026);
  assert.equal(isInFinancialMonth('2026-01-01', 2026, 0), true);
  assert.equal(isInFinancialMonth('2026-01-01', 2025, 11), false, 'it must not fall back into December');
});

test('the date-only reading is identical under UTC+14, UTC-12 and Cairo', () => {
  const original = process.env.TZ;
  const results: string[] = [];
  try {
    for (const timeZone of ['Pacific/Kiritimati', 'Etc/GMT+12', 'Africa/Cairo', 'UTC']) {
      process.env.TZ = timeZone;
      results.push([
        financialDateKey('2026-01-01'),
        financialMonthKey('2026-01-01'),
        String(financialYear('2026-01-01')),
        financialDateKey('2026-08-31'),
        String(isInFinancialMonth('2026-03-01', 2026, 2)),
      ].join('|'));
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
  assert.equal(new Set(results).size, 1, `timezone changed the classification: ${results.join(' vs ')}`);
  assert.equal(results[0], '2026-01-01|2026-01|2026|2026-08-31|true');

  // Control: the naive parse really does move across these zones, so the
  // assertion above cannot quietly pass because the timezone never changed.
  const naive: string[] = [];
  try {
    for (const timeZone of ['Pacific/Kiritimati', 'Etc/GMT+12']) {
      process.env.TZ = timeZone;
      const parsed = new Date('2026-01-01');
      naive.push(`${parsed.getFullYear()}-${parsed.getMonth() + 1}-${parsed.getDate()}`);
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
  assert.equal(new Set(naive).size, 2, 'the test environment must really switch timezones for this to mean anything');
  assert.deepEqual(naive, ['2026-1-1', '2025-12-31'], 'and the naive reading loses a day, a month and a year');
});

test('a full ISO instant is still read as a real moment', () => {
  assert.equal(financialDateKey('2026-08-20T18:42:11.000Z')?.length, 10);
  assert.equal(financialDateKey('not a date'), null);
  assert.equal(financialDateKey(''), null);
  assert.equal(financialDateKey(undefined), null);
});

// --- available years -------------------------------------------------------

const today = new Date(2026, 5, 1);

test('a year whose only activity was a payment is discovered', () => {
  const booked = order({
    eventDate: '2027-02-14', weddingDate: '2027-02-14', bookingDate: '2025-11-03', createdAt: '2025-11-03',
    paymentHistory: [{ id: 'pay_1', amount: 1_000, date: '2025-11-03', method: 'Cash', type: 'deposit' }],
  });

  const years = availableFinancialYears([booked], [], today);

  assert.ok(years.includes(2025), 'the deposit year must be selectable');
  assert.ok(years.includes(2027), 'the event year too');
  assert.deepEqual(years, [2027, 2026, 2025]);
});

test('a year whose only activity was a refund is discovered', () => {
  const refunded = order({
    eventDate: '2026-06-12', weddingDate: '2026-06-12', bookingDate: '2026-06-01', createdAt: '2026-06-01',
    orderStatus: 'cancelled',
    paymentHistory: [
      { id: 'pay_1', amount: 900, date: '2026-06-01', method: 'Cash', type: 'deposit' },
      { id: 'refund_1', amount: 900, date: '2028-01-09', method: 'Cash', type: 'refund' },
    ],
  });

  assert.ok(availableFinancialYears([refunded], [], today).includes(2028), 'the year the money left must be selectable');
});

test('a year whose only activity was an expense or capital movement is discovered', () => {
  const years = availableFinancialYears([], [{ date: '2023-04-18' }, { date: '2024-01-01' }], today);
  assert.deepEqual(years, [2026, 2024, 2023]);
});

test('a booking-year cost with a later event contributes its year', () => {
  const carried = order({
    eventDate: '2028-03-04', weddingDate: '2028-03-04', bookingDate: '2026-09-02', createdAt: '2026-09-02',
    otherExpenses: 250, paymentHistory: [],
  });
  assert.deepEqual(orderFinancialDates(carried).sort(), ['2026-09-02', '2028-03-04']);

  // Without a booking cost the booking date adds no year of its own.
  const noCost = order({ ...carried, otherExpenses: 0 });
  assert.deepEqual(orderFinancialDates(noCost), ['2028-03-04']);
});

test('the current year is always offered and years never repeat', () => {
  const years = availableFinancialYears(
    [order({ eventDate: '2026-08-20', paymentHistory: [{ id: 'p', amount: 10, date: '2026-08-20', method: 'Cash' }] })],
    [{ date: '2026-08-30' }],
    today,
  );
  assert.deepEqual(years, [2026]);
  assert.equal(new Set(years).size, years.length);
});

test('zero-amount payments and unusable dates contribute nothing', () => {
  const noisy = order({
    eventDate: '2026-08-20',
    paymentHistory: [
      { id: 'zero', amount: 0, date: '2019-01-01', method: 'Cash' },
      { id: 'bad', amount: 50, date: 'whenever', method: 'Cash' },
    ],
  });
  assert.deepEqual(orderFinancialDates(noisy), ['2026-08-20']);
  assert.deepEqual(availableFinancialYears([noisy], [], today), [2026]);
});
