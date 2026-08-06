import test from 'node:test';
import assert from 'node:assert/strict';
import { toInternationalPhoneDigits, toTelHref, toWhatsAppHref } from '../src/utils/phone';
import { canViewCustomerContact, mergeWorkerContact } from '../src/utils/workerContact';

test('granting and revoking contact updates the worker view immediately', () => {
  const granted = mergeWorkerContact({ workerCanContactCustomer: true }, '0100 111 2233');
  assert.equal(granted.customerPhone, '0100 111 2233');
  assert.equal(canViewCustomerContact(true, granted), true);

  const revoked = mergeWorkerContact({ ...granted, workerCanContactCustomer: false }, granted.customerPhone);
  assert.equal(revoked.customerPhone, '');
  assert.equal(canViewCustomerContact(true, revoked), false);
});

test('legacy missing permission is denied while managers still see available contact data', () => {
  const legacy = mergeWorkerContact({}, '+201001112233');
  assert.equal(legacy.customerPhone, '');
  assert.equal(canViewCustomerContact(true, legacy), false);
  assert.equal(canViewCustomerContact(false, { customerPhone: '+201001112233' }), true);
});

test('phone links normalize Arabic digits and Egyptian local numbers', () => {
  assert.equal(toInternationalPhoneDigits('٠١٠٠ ١١١ ٢٢٣٣'), '201001112233');
  assert.equal(toTelHref('0100 111 2233'), 'tel:+201001112233');
  assert.equal(toWhatsAppHref('0020 100 111 2233'), 'https://wa.me/201001112233');
});
