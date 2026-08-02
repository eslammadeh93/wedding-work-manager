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
      setDoc(doc(db, `${company('companyA')}/orders/orderA`), { id: 'orderA', companyId: 'companyA', workerId: 'worker1', createdBy: 'system', createdAt: 'now' }),
      setDoc(doc(db, `${company('companyA')}/orders/orderOtherWorker`), { id: 'orderOtherWorker', companyId: 'companyA', workerId: 'worker2', createdBy: 'system', createdAt: 'now' }),
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
test('10 worker reads assigned order', async () => assertSucceeds(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/orders/orderA`))));
test('10b worker queries only assigned orders', async () => assertSucceeds(getDocs(query(collection(db('companyAWorker1'), `${company('companyA')}/orders`), where('workerId', '==', 'worker1')))));
test('11 worker cannot read another worker order', async () => assertFails(getDoc(doc(db('companyAWorker1'), `${company('companyA')}/orders/orderOtherWorker`))));
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
