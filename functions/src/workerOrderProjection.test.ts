import test from 'node:test';
import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildWorkerOrderContactProjection, buildWorkerOrderProjection, enforceAssignmentContactReset } from './workerOrderProjection.js';

test('worker projection never contains the customer phone', () => {
  const view = buildWorkerOrderProjection('company-1', 'order-1', { workerId: 'worker-1', customerPhone: '+201001112233', workerCanContactCustomer: true, orderSource: 'campaign' });
  assert.equal('customerPhone' in view, false);
  assert.equal('orderSource' in view, false);
  assert.equal(view.active, true);
  assert.equal(view.workerCanContactCustomer, true);
});

test('legacy orders without the permission default to false and expose no contact', () => {
  const order = { workerId: 'worker-1', customerPhone: '+201001112233' };
  assert.equal(buildWorkerOrderProjection('company-1', 'order-1', order).workerCanContactCustomer, false);
  assert.equal(buildWorkerOrderContactProjection('company-1', 'order-1', order), null);
});

test('contact projection exists only for an assigned worker with explicit permission', () => {
  assert.deepEqual(buildWorkerOrderContactProjection('company-1', 'order-1', { workerId: 'worker-1', customerPhone: '+201001112233', workerCanContactCustomer: true, updatedAt: 'now' }), {
    companyId: 'company-1', orderId: 'order-1', workerId: 'worker-1', customerPhone: '+201001112233', updatedAt: 'now',
  });
  assert.equal(buildWorkerOrderContactProjection('company-1', 'order-1', { workerId: '', customerPhone: '+201001112233', workerCanContactCustomer: true }), null);
  assert.equal(buildWorkerOrderContactProjection('company-1', 'order-1', { workerId: 'worker-2', customerPhone: '+201001112233', workerCanContactCustomer: false }), null);
});

test('changing the assigned worker always resets permission before projection', () => {
  const result = enforceAssignmentContactReset(
    { workerId: 'worker-1', workerCanContactCustomer: true },
    { workerId: 'worker-2', workerCanContactCustomer: true },
  );
  assert.equal(result.resetRequired, true);
  assert.equal(result.order.workerCanContactCustomer, false);
  assert.equal(buildWorkerOrderContactProjection('company-1', 'order-1', result.order), null);
});

test('safe worker projection derives its company ID from the trusted path', () => {
  assert.deepEqual(buildWorkerOrderProjection('company-1', 'order-1', {
    companyId: 'wrong-company', workerId: 'worker-1', customerPhone: '+201001112233', workerCanContactCustomer: true,
  }), {
    companyId: 'company-1', id: 'order-1', workerId: 'worker-1', active: true, workerCanContactCustomer: true,
  });
});

const waitFor = async (predicate: () => Promise<boolean>, message: string) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
};

test('Firestore trigger creates and revokes the exact worker contact projection path', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  const app = getApps().find(existing => existing.name === 'worker-order-projection-test')
    || initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'wedding-manager-local' }, 'worker-order-projection-test');
  const db = getFirestore(app);
  const companyId = `projection-test-${Date.now()}`;
  const orderId = 'order-contact-flow';
  const orderRef = db.doc(`companies/${companyId}/orders/${orderId}`);
  const workerOrderRef = db.doc(`companies/${companyId}/workerOrders/${orderId}`);
  const contactRef = db.doc(`companies/${companyId}/workerOrderContacts/${orderId}`);

  await orderRef.set({
    companyId, workerId: 'worker-1', customerName: 'Customer', customerPhone: '+201001112233',
    workerCanContactCustomer: true, updatedAt: 'now',
  });
  assert.equal((await orderRef.get()).data()?.workerCanContactCustomer, true);

  await waitFor(async () => (await contactRef.get()).exists, 'contact projection was not created by syncWorkerOrderAccess');
  const [workerOrder, contact] = await Promise.all([workerOrderRef.get(), contactRef.get()]);
  assert.equal(workerOrder.exists, true);
  assert.equal(workerOrder.data()?.customerPhone, undefined);
  assert.equal(workerOrder.data()?.active, true);
  assert.equal(workerOrder.data()?.workerCanContactCustomer, true);
  assert.deepEqual(contact.data(), {
    companyId, orderId, workerId: 'worker-1', customerPhone: '+201001112233', updatedAt: 'now',
  });

  await orderRef.update({ workerCanContactCustomer: false });
  await waitFor(async () => {
    const [updatedProjection, deletedContact] = await Promise.all([workerOrderRef.get(), contactRef.get()]);
    return updatedProjection.data()?.workerCanContactCustomer === false && !deletedContact.exists;
  }, 'contact projection was not deleted after workerCanContactCustomer was revoked');
});
