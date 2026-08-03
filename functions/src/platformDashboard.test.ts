import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';
import { applyIdempotentDelta, authorizePlatformDashboard, roleHasDashboardPermission, statusDelta } from './platformDashboard.js';

const fakeDb = (profile?: Record<string, unknown>) => ({
  doc: () => ({ get: async () => ({ exists: Boolean(profile), data: () => profile }) }),
}) as unknown as FirebaseFirestore.Firestore;

test('authorized active platform owner can read dashboard', async () => {
  const result = await authorizePlatformDashboard(fakeDb({ role: 'platform_owner', status: 'active' }), { uid: 'owner' });
  assert.equal(result.role, 'platform_owner');
});
test('unauthenticated dashboard request is rejected', async () => {
  await assert.rejects(() => authorizePlatformDashboard(fakeDb(), undefined), (error: HttpsError) => error.code === 'unauthenticated');
});
test('inactive platform user is rejected', async () => {
  await assert.rejects(() => authorizePlatformDashboard(fakeDb({ role: 'platform_owner', status: 'disabled' }), { uid: 'owner' }), (error: HttpsError) => error.code === 'permission-denied');
});
test('platform user without dashboard permission is rejected', async () => {
  await assert.rejects(() => authorizePlatformDashboard(fakeDb({ role: 'unknown', status: 'active', permissions: [] }), { uid: 'user' }), (error: HttpsError) => error.code === 'permission-denied');
  assert.equal(roleHasDashboardPermission('unknown'), false);
});
test('company aggregation calculates stable status transitions', () => {
  assert.deepEqual(statusDelta(null, { status: 'active', subscriptionEnd: '2099-01-01' }, new Date('2026-01-01')), { companyCount: 1, activeCompanyCount: 1, trialCompanyCount: 0, suspendedCompanyCount: 0, expiredCompanyCount: 0, expiringSoonCompanyCount: 0 });
  const changed = statusDelta({ status: 'trial' }, { status: 'suspended' });
  assert.equal(changed.trialCompanyCount, -1); assert.equal(changed.suspendedCompanyCount, 1); assert.equal(changed.companyCount, 0);
});

test('aggregate event retry does not double count', async () => {
  const documents = new Map<string, Record<string, unknown>>();
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: async (handler: (tx: unknown) => Promise<unknown>) => handler({
      get: async (ref: { path: string }) => ({ exists: documents.has(ref.path), data: () => documents.get(ref.path) }),
      set: (ref: { path: string }, value: Record<string, unknown>) => documents.set(ref.path, { ...(documents.get(ref.path) || {}), ...value }),
      create: (ref: { path: string }, value: Record<string, unknown>) => documents.set(ref.path, value),
    }),
  } as unknown as FirebaseFirestore.Firestore;
  assert.equal(await applyIdempotentDelta(db, 'same-event', { companyCount: 1 }), true);
  assert.equal(await applyIdempotentDelta(db, 'same-event', { companyCount: 1 }), false);
  assert.equal(documents.get('platformAggregates/overview')?.companyCount, 1);
});
