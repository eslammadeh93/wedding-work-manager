import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

const projectId = 'wedding-manager-rules';
let env: RulesTestEnvironment;
const company = (id: string) => `companies/${id}`;
const member = (companyId: string, uid: string, role: string, status = 'active', workerId?: string) =>
  ({ uid, companyId, role, status, ...(workerId ? { workerId } : {}) });

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, company('companyA')), { status: 'active', companyCode: 'a' }),
      setDoc(doc(db, company('companyB')), { status: 'active', companyCode: 'b' }),
      setDoc(doc(db, company('companyExpired')), { status: 'expired' }),
      setDoc(doc(db, company('companySuspended')), { status: 'suspended' }),
      setDoc(doc(db, 'platformUsers/platformOwner'), { role: 'platform_owner', status: 'active' }),
      setDoc(doc(db, `${company('companyA')}/members/companyASuperAdmin`), member('companyA', 'companyASuperAdmin', 'company_super_admin')),
      setDoc(doc(db, `${company('companyA')}/members/companyAManager`), member('companyA', 'companyAManager', 'manager')),
      setDoc(doc(db, `${company('companyA')}/members/companyAEmployee`), member('companyA', 'companyAEmployee', 'employee')),
      setDoc(doc(db, `${company('companyA')}/members/companyAWorker1`), member('companyA', 'companyAWorker1', 'worker', 'active', 'worker1')),
      setDoc(doc(db, `${company('companyA')}/members/companyAWorker2`), member('companyA', 'companyAWorker2', 'worker', 'active', 'worker2')),
      setDoc(doc(db, `${company('companyA')}/members/companyADisabledMember`), member('companyA', 'companyADisabledMember', 'employee', 'disabled')),
      setDoc(doc(db, `${company('companyB')}/members/companyBSuperAdmin`), member('companyB', 'companyBSuperAdmin', 'company_super_admin')),
      setDoc(doc(db, `${company('companyExpired')}/members/companyASuperAdmin`), member('companyExpired', 'companyASuperAdmin', 'company_super_admin')),
      setDoc(doc(db, `${company('companySuspended')}/members/companyASuperAdmin`), member('companySuspended', 'companyASuperAdmin', 'company_super_admin')),
      setDoc(doc(db, `${company('companyA')}/orders/orderA`), { id: 'orderA', companyId: 'companyA', workerId: 'worker1', customerPhone: '+201001112233', workerCanContactCustomer: true, createdBy: 'system', createdAt: 'now' }),
      setDoc(doc(db, `${company('companyA')}/orders/contactNotCreatedYet`), { id: 'contactNotCreatedYet', companyId: 'companyA', workerId: 'worker1', customerPhone: '+201001112244', workerCanContactCustomer: true, createdBy: 'system', createdAt: 'now' }),
      setDoc(doc(db, `${company('companyA')}/orders/orderContactDenied`), { id: 'orderContactDenied', companyId: 'companyA', workerId: 'worker1', customerPhone: '+201009999999', workerCanContactCustomer: false, createdBy: 'system', createdAt: 'now' }),
      setDoc(doc(db, `${company('companyA')}/orders/contactRevokedAndDeleted`), { id: 'contactRevokedAndDeleted', companyId: 'companyA', workerId: 'worker1', workerCanContactCustomer: false, createdBy: 'system', createdAt: 'now' }),
      setDoc(doc(db, `${company('companyA')}/orders/orderLegacy`), { id: 'orderLegacy', companyId: 'companyA', workerId: 'worker1', customerPhone: '+201008888888', createdBy: 'system', createdAt: 'now' }),
      setDoc(doc(db, `${company('companyA')}/orders/orderOtherWorker`), { id: 'orderOtherWorker', companyId: 'companyA', workerId: 'worker2', customerPhone: '+201007777777', workerCanContactCustomer: true, createdBy: 'system', createdAt: 'now' }),
      setDoc(doc(db, `${company('companyA')}/orders/orderA/workerMovements/worker1_arrived`), { companyId: 'companyA', orderId: 'orderA', workerId: 'worker1', action: 'arrived', createdByUid: 'companyAWorker1' }),
      setDoc(doc(db, `${company('companyA')}/orders/orderA/workerMovements/worker2_arrived`), { companyId: 'companyA', orderId: 'orderA', workerId: 'worker2', action: 'arrived', createdByUid: 'companyAWorker2' }),
      setDoc(doc(db, `${company('companyA')}/orders/contactIdentityMismatch`), { id: 'contactIdentityMismatch', companyId: 'companyA', workerId: 'worker1', customerPhone: '+201006666666', workerCanContactCustomer: true, createdBy: 'system', createdAt: 'now' }),
      setDoc(doc(db, `${company('companyA')}/workerOrders/orderA`), { id: 'orderA', companyId: 'companyA', workerId: 'worker1', active: true, workerCanContactCustomer: true }),
      setDoc(doc(db, `${company('companyA')}/workerOrders/orderContactDenied`), { id: 'orderContactDenied', companyId: 'companyA', workerId: 'worker1', active: true, workerCanContactCustomer: false }),
      setDoc(doc(db, `${company('companyA')}/workerOrders/orderLegacy`), { id: 'orderLegacy', companyId: 'companyA', workerId: 'worker1', active: true, workerCanContactCustomer: false }),
      setDoc(doc(db, `${company('companyA')}/workerOrders/orderOtherWorker`), { id: 'orderOtherWorker', companyId: 'companyA', workerId: 'worker2', active: true, workerCanContactCustomer: true }),
      setDoc(doc(db, `${company('companyA')}/workerOrders/unsafeProjection`), { id: 'unsafeProjection', companyId: 'companyA', workerId: 'worker2', active: true, workerCanContactCustomer: true, customerPhone: '+201006666666' }),
      setDoc(doc(db, `${company('companyA')}/workerOrderContacts/orderA`), { companyId: 'companyA', orderId: 'orderA', workerId: 'worker1', customerPhone: '+201001112233' }),
      setDoc(doc(db, `${company('companyA')}/workerOrderContacts/orderContactDenied`), { companyId: 'companyA', orderId: 'orderContactDenied', workerId: 'worker1', customerPhone: '+201009999999' }),
      setDoc(doc(db, `${company('companyA')}/workerOrderContacts/orderLegacy`), { companyId: 'companyA', orderId: 'orderLegacy', workerId: 'worker1', customerPhone: '+201008888888' }),
      setDoc(doc(db, `${company('companyA')}/workerOrderContacts/orderOtherWorker`), { companyId: 'companyA', orderId: 'orderOtherWorker', workerId: 'worker2', customerPhone: '+201007777777' }),
      setDoc(doc(db, `${company('companyA')}/workerOrderContacts/contactIdentityMismatch`), { companyId: 'companyB', orderId: 'wrongOrderId', workerId: 'worker1', customerPhone: '+201006666666' }),
      setDoc(doc(db, `${company('companyB')}/orders/orderB`), { id: 'orderB', companyId: 'companyB', workerId: 'workerB' }),
      setDoc(doc(db, `${company('companyA')}/customers/customerA`), { companyId: 'companyA', createdBy: 'system', createdAt: 'now' }),
      setDoc(doc(db, `${company('companyA')}/inventory/itemA`), { companyId: 'companyA', quantity: 2, totalQuantity: 2, availableQuantity: 2, reservedQuantity: 0 }),
      setDoc(doc(db, `${company('companyA')}/expenses/expenseA`), { companyId: 'companyA', linkedOrderId: null }),
      setDoc(doc(db, `${company('companyA')}/workers/worker1`), { name: 'safe worker', authUid: 'companyAWorker1' }),
      setDoc(doc(db, `${company('companyA')}/workers/legacyHash`), { name: 'unsafe worker', loginCodeHash: 'scrypt$secret', authUid: 'companyAWorker1' }),
      setDoc(doc(db, `${company('companyA')}/notifications/n1`), { targetUid: 'companyAWorker1' }),
      setDoc(doc(db, 'companySlugIndexes/a'), { companyId: 'companyA' }),
      setDoc(doc(db, 'platformAuditLogs/audit1'), { action: 'seed' }),
      setDoc(doc(db, `${company('companyExpired')}/orders/expiredOrder`), { companyId: 'companyExpired' }),
      setDoc(doc(db, `${company('companySuspended')}/orders/suspendedOrder`), { companyId: 'companySuspended' }),
    ]);
  });
}
const db = (uid?: string, claims: Record<string, unknown> = {}) => uid ? env.authenticatedContext(uid, claims).firestore() : env.unauthenticatedContext().firestore();
const path = (companyId: string, collectionName: string, id: string) => doc(db('companyASuperAdmin'), `${company(companyId)}/${collectionName}/${id}`);

test.before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync(resolve('firestore.rules'), 'utf8') } });
  await seed();
});
test.after(async () => { await env.cleanup(); });
test.afterEach(async () => { await env.clearFirestore(); await seed(); });

test('1 unauthenticated user cannot read a company', async () => assertFails(getDoc(doc(db(), company('companyA')))));
test('2 company A member reads its company', async () => assertSucceeds(getDoc(doc(db('companyAEmployee'), company('companyA')))));
test('3 company A member cannot read company B', async () => assertFails(getDoc(doc(db('companyAEmployee'), company('companyB')))));
test('4 company A member cannot read company B order', async () => assertFails(getDoc(doc(db('companyAEmployee'), `${company('companyB')}/orders/orderB`))));
test('5 super admin reads company orders', async () => assertSucceeds(getDoc(doc(db('companyASuperAdmin'), `${company('companyA')}/orders/orderA`))));
test('6 super admin creates an order in its company', async () => assertSucceeds(setDoc(doc(db('companyASuperAdmin'), `${company('companyA')}/orders/new`), { companyId: 'companyA' })));
test('7 manager keeps operational access but company finance is owner-only', async () => { await assertSucceeds(setDoc(doc(db('companyAManager'), `${company('companyA')}/orders/manager`), { companyId: 'companyA' })); await assertFails(getDoc(doc(db('companyAManager'), `${company('companyA')}/expenses/expenseA`))); await assertSucceeds(getDoc(doc(db('companyASuperAdmin'), `${company('companyA')}/expenses/expenseA`))); });
test('8 employee reads and writes orders and customers per matrix', async () => { await assertSucceeds(getDoc(doc(db('companyAEmployee'), `${company('companyA')}/customers/customerA`))); await assertSucceeds(setDoc(doc(db('companyAEmployee'), `${company('companyA')}/orders/employee`), { companyId: 'companyA' })); });
test('9 employee cannot write inventory', async () => assertFails(updateDoc(doc(db('companyAEmployee'), `${company('companyA')}/inventory/itemA`), { quantity: 3 })));
test('10 worker cannot read canonical order containing private phone', async () => assertFails(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/orders/orderA`))));
// The deployed source rule has no resource.data.active predicate. This guards
// the current contract: a workerId-only query succeeds for active projections.
test('10b worker queries only assigned field-safe active order projections', async () => assertSucceeds(getDocs(query(collection(db('companyAWorker1'), `${company('companyA')}/workerOrders`), where('workerId', '==', 'worker1')))));
test('10b2 worker can query assigned active projections with an explicit active filter', async () => assertSucceeds(getDocs(query(collection(db('companyAWorker1'), `${company('companyA')}/workerOrders`), where('workerId', '==', 'worker1'), where('active', '==', true)))));
test('10c worker cannot query every worker-order projection without the assignment filter', async () => assertFails(getDocs(collection(db('companyAWorker1'), `${company('companyA')}/workerOrders`))));
test('10d worker UID is not the workerId used by worker-order rules', async () => assertFails(getDocs(query(collection(db('companyAWorker1'), `${company('companyA')}/workerOrders`), where('workerId', '==', 'companyAWorker1')))));
test('11 worker cannot read another worker projection', async () => assertFails(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/workerOrders/orderOtherWorker`))));
test('12 worker cannot update order status', async () => assertFails(updateDoc(doc(db('companyAWorker1'), `${company('companyA')}/orders/orderA`), { status: 'done' })));
test('13 worker cannot read customers', async () => assertFails(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/customers/customerA`))));
test('14 worker cannot read expenses', async () => assertFails(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/expenses/expenseA`))));
test('15 manager cannot directly change a member role', async () => assertFails(updateDoc(doc(db('companyAManager'), `${company('companyA')}/members/companyAEmployee`), { role: 'company_super_admin' })));
test('16 user cannot change own role', async () => assertFails(updateDoc(doc(db('companyAEmployee'), `${company('companyA')}/members/companyAEmployee`), { role: 'company_super_admin' })));
test('17 disabled member cannot read', async () => assertFails(getDoc(doc(db('companyADisabledMember'), company('companyA')))));
test('18 suspended company denies operations', async () => { await assertFails(getDoc(doc(db('companyASuperAdmin'), `${company('companySuspended')}/orders/suspendedOrder`))); await assertFails(setDoc(doc(db('companyASuperAdmin'), `${company('companySuspended')}/orders/new`), { companyId: 'companySuspended' })); });
test('19 expired company permits reads', async () => assertSucceeds(getDoc(doc(db('companyASuperAdmin'), `${company('companyExpired')}/orders/expiredOrder`))));
test('20 expired company denies writes', async () => assertFails(setDoc(doc(db('companyASuperAdmin'), `${company('companyExpired')}/orders/new`), { companyId: 'companyExpired' })));
test('21 verified platform owner reads company metadata', async () => assertSucceeds(getDoc(doc(db('platformOwner', { platform_owner: true }), company('companyA')))));
test('22 platform owner cannot read company orders', async () => assertFails(getDoc(doc(db('platformOwner', { platform_owner: true }), `${company('companyA')}/orders/orderA`))));
test('23 client cannot write platform audit logs', async () => assertFails(setDoc(doc(db('platformOwner', { platform_owner: true }), 'platformAuditLogs/client'), { action: 'bad' })));
test('24 client cannot read a uniqueness index', async () => assertFails(getDoc(doc(db('companyASuperAdmin'), 'companySlugIndexes/a'))));
test('25 create rejects a companyId different from path', async () => assertFails(setDoc(doc(db('companyASuperAdmin'), `${company('companyA')}/orders/wrong`), { companyId: 'companyB' })));
test('26 update rejects changing companyId', async () => assertFails(updateDoc(doc(db('companyASuperAdmin'), `${company('companyA')}/orders/orderA`), { companyId: 'companyB' })));
test('27 update rejects changing created metadata', async () => assertFails(updateDoc(doc(db('companyASuperAdmin'), `${company('companyA')}/orders/orderA`), { createdBy: 'attacker' })));
test('28 notification targetUid restricts reads', async () => { await assertSucceeds(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/notifications/n1`))); await assertFails(getDoc(doc(db('companyAWorker2'), `${company('companyA')}/notifications/n1`))); });
test('29 worker document containing loginCodeHash is never readable', async () => { await assertSucceeds(getDoc(doc(db('companyAManager'), `${company('companyA')}/workers/worker1`))); await assertFails(getDoc(doc(db('companyAManager'), `${company('companyA')}/workers/legacyHash`))); });
test('30 workerSecrets are never client-readable', async () => assertFails(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/workerSecrets/worker1`))));
test('31 legacy archive is read-only', async () => assertFails(setDoc(doc(db('companyAManager'), 'orders/legacy-write'), { workerId: 'worker1' })));
test('32 unknown path is denied', async () => assertFails(getDoc(doc(db('companyASuperAdmin'), `${company('companyA')}/unknown/private`))));
test('33 assigned worker reads contact only when explicitly granted', async () => assertSucceeds(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/workerOrderContacts/orderA`))));
test('33b granted worker can receive a missing contact as an empty document snapshot during projection creation', async () => assertSucceeds(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/workerOrderContacts/contactNotCreatedYet`))));
test('34 unassigned worker cannot read a granted contact', async () => assertFails(getDoc(doc(db('companyAWorker2'), `${company('companyA')}/workerOrderContacts/orderA`))));
test('34b contact document must match its company and order path as well as the assigned worker', async () => assertFails(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/workerOrderContacts/contactIdentityMismatch`))));
test('35 revoked contact remains unreadable even if a stale contact document exists', async () => assertFails(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/workerOrderContacts/orderContactDenied`))));
test('35b revoked contact deleted by the projection is delivered as an empty snapshot, not a listener error', async () => assertSucceeds(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/workerOrderContacts/contactRevokedAndDeleted`))));
test('36 legacy missing permission is treated as false', async () => assertFails(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/workerOrderContacts/orderLegacy`))));
test('37 manager and super admin can toggle contact permission after creation', async () => { await assertSucceeds(updateDoc(doc(db('companyAManager'), `${company('companyA')}/orders/orderContactDenied`), { workerCanContactCustomer: true })); await assertSucceeds(updateDoc(doc(db('companyASuperAdmin'), `${company('companyA')}/orders/orderA`), { workerCanContactCustomer: false })); });
test('38 employee cannot grant or revoke contact permission', async () => { await assertFails(updateDoc(doc(db('companyAEmployee'), `${company('companyA')}/orders/orderContactDenied`), { workerCanContactCustomer: true })); await assertFails(updateDoc(doc(db('companyAEmployee'), `${company('companyA')}/orders/orderA`), { workerCanContactCustomer: false })); });
test('39 worker cannot modify contact permission', async () => assertFails(updateDoc(doc(db('companyAWorker1'), `${company('companyA')}/orders/orderA`), { workerCanContactCustomer: false })));
test('40 changing assigned worker requires permission reset to false', async () => { await assertFails(updateDoc(doc(db('companyAManager'), `${company('companyA')}/orders/orderA`), { workerId: 'worker2', workerCanContactCustomer: true })); await assertSucceeds(updateDoc(doc(db('companyAManager'), `${company('companyA')}/orders/orderA`), { workerId: 'worker2', workerCanContactCustomer: false })); });
test('41 employee may only perform the automatic false reset while changing worker', async () => assertSucceeds(updateDoc(doc(db('companyAEmployee'), `${company('companyA')}/orders/orderA`), { workerId: 'worker2', workerCanContactCustomer: false })));
test('42 clients cannot write worker projections or contact documents', async () => { await assertFails(setDoc(doc(db('companyAManager'), `${company('companyA')}/workerOrders/client`), { workerId: 'worker1' })); await assertFails(setDoc(doc(db('companyAManager'), `${company('companyA')}/workerOrderContacts/client`), { workerId: 'worker1', customerPhone: '+201000000000' })); });
test('43 worker cannot read a malformed projection containing a phone', async () => assertFails(getDoc(doc(db('companyAWorker2'), `${company('companyA')}/workerOrders/unsafeProjection`))));
test('44 employee cannot create an order with contact permission enabled', async () => { await assertFails(setDoc(doc(db('companyAEmployee'), `${company('companyA')}/orders/employee-grant`), { companyId: 'companyA', workerCanContactCustomer: true })); await assertSucceeds(setDoc(doc(db('companyAEmployee'), `${company('companyA')}/orders/employee-denied`), { companyId: 'companyA', workerCanContactCustomer: false })); });
test('45 assigned worker reads only their own movement records and cannot write them', async () => {
  const movements = collection(db('companyAWorker1'), `${company('companyA')}/orders/orderA/workerMovements`);
  await assertSucceeds(getDocs(query(movements, where('workerId', '==', 'worker1'))));
  await assertFails(getDocs(movements));
  await assertFails(setDoc(doc(db('companyAWorker1'), `${company('companyA')}/orders/orderA/workerMovements/client`), { workerId: 'worker1' }));
});
test('46 unassigned worker cannot read another worker order movements', async () => assertFails(getDoc(doc(db('companyAWorker2'), `${company('companyA')}/orders/orderA/workerMovements/worker1_arrived`))));
