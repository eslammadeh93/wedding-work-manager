import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export const DASHBOARD_PERMISSION = 'platform:dashboard:read';
const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  platform_owner: [DASHBOARD_PERMISSION, 'platform:dangerous_delete'],
  platform_admin: [DASHBOARD_PERMISSION],
  platform_support: [DASHBOARD_PERMISSION],
  platform_billing: [DASHBOARD_PERMISSION],
  platform_read_only: [DASHBOARD_PERMISSION],
};

export interface PlatformDashboardDependencies { db: FirebaseFirestore.Firestore; now?: () => Date }
export interface DashboardAuth { uid: string };
export interface DashboardRequest { auth?: DashboardAuth; data?: unknown }

const number = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const iso = (value: unknown): string | null => {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'string' || typeof value === 'number') { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
  return null;
};
export const monthKey = (date: Date) => date.toISOString().slice(0, 7);
export const dayKey = (date: Date) => date.toISOString().slice(0, 10);
export const roleHasDashboardPermission = (role: unknown, explicit?: unknown): boolean =>
  typeof role === 'string' && (ROLE_PERMISSIONS[role]?.includes(DASHBOARD_PERMISSION) || (Array.isArray(explicit) && explicit.includes(DASHBOARD_PERMISSION)));

export async function authorizePlatformDashboard(db: FirebaseFirestore.Firestore, auth?: DashboardAuth) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول.');
  const profile = await db.doc(`platformUsers/${auth.uid}`).get();
  if (!profile.exists) throw new HttpsError('permission-denied', 'حساب المنصة غير موجود.');
  const data = profile.data() || {};
  if (data.status !== 'active') throw new HttpsError('permission-denied', 'حساب المنصة غير نشط.');
  if (!roleHasDashboardPermission(data.role, data.permissions)) throw new HttpsError('permission-denied', 'لا تملك صلاحية لوحة المنصة.');
  return { uid: auth.uid, role: String(data.role) };
}

const companyDto = (doc: FirebaseFirestore.DocumentSnapshot) => {
  const data = doc.data() || {};
  return { id: doc.id, name: String(data.name || 'بدون اسم'), ownerName: String(data.ownerName || '—'), status: String(data.status || 'unknown'), createdAt: iso(data.createdAt), subscriptionEnd: iso(data.subscriptionEnd), memberCount: data.memberCount == null ? null : number(data.memberCount), orderCount: data.orderCount == null ? null : number(data.orderCount), activeMemberCount: data.activeMemberCount == null ? null : number(data.activeMemberCount), lastActivityAt: iso(data.lastActivityAt) };
};

export class PlatformDashboardService {
  constructor(private readonly deps: PlatformDashboardDependencies) {}
  async get(request: DashboardRequest) {
    await authorizePlatformDashboard(this.deps.db, request.auth);
    if (request.data != null && (typeof request.data !== 'object' || Array.isArray(request.data))) throw new HttpsError('invalid-argument', 'بيانات الطلب غير صالحة.');
    const now = this.deps.now?.() ?? new Date();
    const months = Array.from({ length: 12 }, (_, index) => { const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - index), 1)); return monthKey(date); });
    const overviewRef = this.deps.db.doc('platformAggregates/overview');
    const monthRefs = months.map(key => this.deps.db.doc(`platformAggregates/monthly_${key}`));
    const [overview, ...monthly] = await this.deps.db.getAll(overviewRef, ...monthRefs);
    const start = new Date(now); start.setUTCDate(start.getUTCDate() + 30);
    const [latest, top, activity, expiring] = await Promise.all([
      this.deps.db.collection('companies').orderBy('createdAt', 'desc').limit(8).get(),
      this.deps.db.collection('companies').orderBy('orderCount', 'desc').limit(8).get(),
      this.deps.db.collection('platformAuditLogs').orderBy('timestamp', 'desc').limit(8).get(),
      this.deps.db.collection('companies').where('status', 'in', ['active', 'trial', 'past_due']).where('subscriptionEnd', '>=', now.toISOString().slice(0, 10)).where('subscriptionEnd', '<=', start.toISOString().slice(0, 10)).orderBy('subscriptionEnd').limit(8).get(),
    ]);
    const raw = overview.data() || {};
    const summary = {
      companyCount: number(raw.companyCount), activeCompanyCount: number(raw.activeCompanyCount), trialCompanyCount: number(raw.trialCompanyCount), suspendedCompanyCount: number(raw.suspendedCompanyCount), expiredCompanyCount: number(raw.expiredCompanyCount), expiringSoonCompanyCount: number(raw.expiringSoonCompanyCount), memberCount: number(raw.memberCount), orderCount: number(raw.orderCount), ordersToday: number(raw.ordersToday), ordersCurrentMonth: number(raw.ordersCurrentMonth), newCompaniesCurrentMonth: number(raw.newCompaniesCurrentMonth),
    };
    const series = monthly.map((doc, index) => ({ month: months[index], value: number(doc.data()?.companyCount) }));
    const orderSeries = monthly.map((doc, index) => ({ month: months[index], value: number(doc.data()?.orderCount) }));
    // A company with no orders legitimately has no lastActivityAt. Partial means
    // the aggregate-backed company counters have not been initialized yet.
    const incomplete = !overview.exists || latest.docs.some(doc => doc.data().orderCount == null || doc.data().activeMemberCount == null);
    return {
      summary, monthlyCompanies: series, monthlyOrders: orderSeries,
      latestCompanies: latest.docs.map(companyDto), topCompanies: top.docs.map(companyDto),
      recentPlatformActivity: activity.docs.map(doc => ({ id: doc.id, action: String(doc.data().action || 'unknown'), actorUid: String(doc.data().createdBy || doc.data().actorUid || '—'), companyId: doc.data().companyId ? String(doc.data().companyId) : null, timestamp: iso(doc.data().timestamp) })),
      expiringCompanies: expiring.docs.map(companyDto), generatedAt: now.toISOString(), isPartial: incomplete, aggregateUpdatedAt: iso(raw.updatedAt),
    };
  }
}

export interface AggregateDelta { companyCount?: number; activeCompanyCount?: number; trialCompanyCount?: number; suspendedCompanyCount?: number; expiredCompanyCount?: number; expiringSoonCompanyCount?: number; memberCount?: number; activeMemberCount?: number; orderCount?: number; ordersToday?: number; ordersCurrentMonth?: number; newCompaniesCurrentMonth?: number }
export const statusDelta = (before: Record<string, unknown> | null, after: Record<string, unknown> | null, now = new Date()): AggregateDelta => {
  const delta: AggregateDelta = { companyCount: Number(Boolean(after)) - Number(Boolean(before)) };
  for (const status of ['active', 'trial', 'suspended', 'expired'] as const) {
    const key = `${status}CompanyCount` as keyof AggregateDelta;
    delta[key] = Number(after?.status === status) - Number(before?.status === status);
  }
  const soon = (data: Record<string, unknown> | null) => { if (!data || data.status === 'suspended' || data.status === 'expired') return false; const end = new Date(String(data.subscriptionEnd || '')); const days = (end.getTime() - now.getTime()) / 86_400_000; return Number.isFinite(days) && days >= 0 && days <= 30; };
  delta.expiringSoonCompanyCount = Number(soon(after)) - Number(soon(before));
  return delta;
};

export async function applyIdempotentDelta(db: FirebaseFirestore.Firestore, eventId: string, delta: AggregateDelta, period?: { month?: string; day?: string }) {
  return db.runTransaction(async tx => {
    const eventRef = db.doc(`platformAggregateEvents/${eventId}`), overviewRef = db.doc('platformAggregates/overview');
    const monthRef = period?.month ? db.doc(`platformAggregates/monthly_${period.month}`) : null;
    const dayRef = period?.day ? db.doc(`platformAggregates/daily_${period.day}`) : null;
    const [event, overview, monthSnapshot, daySnapshot] = await Promise.all([tx.get(eventRef), tx.get(overviewRef), monthRef ? tx.get(monthRef) : Promise.resolve(null), dayRef ? tx.get(dayRef) : Promise.resolve(null)]);
    if (event.exists) return false;
    const current = overview.data() || {}; const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    for (const [key, change] of Object.entries(delta)) patch[key] = Math.max(0, number(current[key]) + Number(change || 0));
    tx.set(overviewRef, patch, { merge: true });
    if (period?.month) {
      const monthDelta: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      if (delta.companyCount) monthDelta.companyCount = Math.max(0, number(monthSnapshot?.data()?.companyCount) + delta.companyCount);
      if (delta.orderCount) monthDelta.orderCount = Math.max(0, number(monthSnapshot?.data()?.orderCount) + delta.orderCount);
      tx.set(monthRef!, monthDelta, { merge: true });
    }
    if (dayRef && delta.orderCount) tx.set(dayRef, { orderCount: Math.max(0, number(daySnapshot?.data()?.orderCount) + delta.orderCount), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(eventRef, { appliedAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 30 * 86_400_000) });
    return true;
  });
}
