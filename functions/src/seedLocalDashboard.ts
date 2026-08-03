/**
 * Local dashboard fixture only. This script refuses every non-loopback
 * endpoint and writes exclusively through the Firebase emulators.
 *
 * Run after `firebase emulators:start --only auth,firestore,functions`:
 *   npm --prefix functions run seed:dashboard-local
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const loopback = (value: string | undefined) => {
  if (!value) return false;
  try {
    const url = new URL(`http://${value}`);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch { return false; }
};

if (!loopback(process.env.FIRESTORE_EMULATOR_HOST) || !loopback(process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
  throw new Error('Refusing to seed: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must both be loopback emulator endpoints.');
}

if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'wedding-work-manager-local' });
const db = getFirestore();
const auth = getAuth();
const now = new Date();
const days = (offset: number) => Timestamp.fromDate(new Date(now.getTime() + offset * 86_400_000));
const date = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

async function upsertOwner() {
  const uid = 'local-platform-owner';
  const email = 'platform.owner@local.test';
  try { await auth.getUser(uid); }
  catch { await auth.createUser({ uid, email, password: 'LocalDashboard!2026', displayName: 'مالك المنصة المحلي', emailVerified: true }); }
  await auth.setCustomUserClaims(uid, { platform_owner: true, role: 'platform_owner' });
  await db.doc(`platformUsers/${uid}`).set({ uid, name: 'مالك المنصة المحلي', email, role: 'platform_owner', status: 'active', permissions: ['platform:dashboard:read'], createdAt: days(-90), updatedAt: Timestamp.now() });
  return uid;
}

type Fixture = { id: string; name: string; status: 'active' | 'trial' | 'suspended' | 'expired'; createdDays: number; endDays: number; members: number; orders: number };
const fixtures: Fixture[] = [
  { id: 'local-rose-events', name: 'روز إيفنتس', status: 'active', createdDays: -70, endDays: 8, members: 4, orders: 7 },
  { id: 'local-nile-weddings', name: 'نايل ويدينغز', status: 'active', createdDays: -48, endDays: 75, members: 3, orders: 5 },
  { id: 'local-lotus-studio', name: 'لوتس ستوديو', status: 'trial', createdDays: -12, endDays: 18, members: 2, orders: 3 },
  { id: 'local-cairo-decor', name: 'كايرو ديكور', status: 'suspended', createdDays: -130, endDays: 40, members: 2, orders: 1 },
  { id: 'local-vintage-venue', name: 'فينتج فينيو', status: 'expired', createdDays: -210, endDays: -3, members: 1, orders: 2 },
];

async function writeFixtures(ownerUid: string) {
  for (const [companyIndex, fixture] of fixtures.entries()) {
    const ref = db.doc(`companies/${fixture.id}`);
    await ref.set({
      name: fixture.name, slug: fixture.id.replace('local-', ''), companyCode: String(710001 + companyIndex), ownerName: `مالك ${fixture.name}`, ownerEmail: `owner${companyIndex + 1}@local.test`, plan: companyIndex % 2 ? 'pro' : 'basic', status: fixture.status,
      subscriptionStart: date(fixture.createdDays), subscriptionEnd: date(fixture.endDays), maxUsers: 12, features: ['orders', 'reports'], createdAt: days(fixture.createdDays), updatedAt: Timestamp.now(),
    }, { merge: true });
    for (let member = 0; member < fixture.members; member++) await ref.collection('members').doc(`local-${fixture.id}-member-${member + 1}`).set({ uid: `local-${fixture.id}-member-${member + 1}`, companyId: fixture.id, name: `عضو ${member + 1}`, email: `member${member + 1}.${companyIndex}@local.test`, role: member === 0 ? 'company_super_admin' : 'employee', status: 'active', createdAt: days(fixture.createdDays + member), updatedAt: Timestamp.now() });
    for (let order = 0; order < fixture.orders; order++) {
      const orderDays = -(order * 6 + companyIndex);
      await ref.collection('orders').doc(`local-order-${order + 1}`).set({ companyId: fixture.id, customerName: `عميل محلي ${order + 1}`, status: order % 2 ? 'pending' : 'completed', total: 1000 + order * 250, createdAt: days(orderDays), date: date(orderDays) });
    }
    await db.collection('platformAuditLogs').doc(`local-audit-${fixture.id}`).set({ action: 'local_dashboard_seeded', companyId: fixture.id, actorUid: ownerUid, createdBy: ownerUid, timestamp: days(-companyIndex), metadata: { localOnly: true } });
  }
}

async function clearAggregateState() {
  // Let emulator document triggers finish before proving the dashboard's
  // Partial state. Deleting aggregate-only collections cannot affect tenant data.
  await new Promise(resolve => setTimeout(resolve, 2500));
  for (const collectionName of ['platformAggregates', 'platformAggregateEvents', 'platformRebuildRuns']) {
    const documents = await db.collection(collectionName).listDocuments();
    if (documents.length) { const batch = db.batch(); documents.forEach(doc => batch.delete(doc)); await batch.commit(); }
  }
  for (const fixture of fixtures) await db.doc(`companies/${fixture.id}`).set({ memberCount: null, activeMemberCount: null, orderCount: null, lastActivityAt: null }, { merge: true });
}

async function main() {
  const ownerUid = await upsertOwner();
  await writeFixtures(ownerUid);
  await clearAggregateState();
  console.log(JSON.stringify({ localOnly: true, owner: { email: 'platform.owner@local.test', password: 'LocalDashboard!2026', uid: ownerUid }, companies: fixtures.map(({ id, status, members, orders, endDays }) => ({ id, status, members, orders, subscriptionEndsInDays: endDays })), expectedPartialDashboard: true }, null, 2));
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
