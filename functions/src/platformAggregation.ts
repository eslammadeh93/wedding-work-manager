import { FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { applyIdempotentDelta, dayKey, monthKey, statusDelta } from './platformDashboard.js';

type Firestore = FirebaseFirestore.Firestore;
const data = (snapshot: FirebaseFirestore.DocumentSnapshot | undefined) => snapshot?.exists ? snapshot.data() || {} : null;
const dateOf = (value: unknown, fallback: Date) => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(String(value || '')); return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};
const active = (value: Record<string, unknown> | null) => Boolean(value && value.status === 'active');

export function createPlatformAggregationTriggers(db: Firestore) {
  const companyWritten = onDocumentWritten({ document: 'companies/{companyId}', region: 'us-central1' }, async event => {
    const before = data(event.data?.before), after = data(event.data?.after), now = new Date();
    const delta = statusDelta(before, after, now); const created = !before && after;
    if (created) delta.newCompaniesCurrentMonth = 1;
    await applyIdempotentDelta(db, `company_${event.id}`, delta, { month: created ? monthKey(dateOf(after?.createdAt, now)) : undefined });
  });
  const memberWritten = onDocumentWritten({ document: 'companies/{companyId}/members/{memberId}', region: 'us-central1' }, async event => {
    const before = data(event.data?.before), after = data(event.data?.after);
    const totalChange = Number(Boolean(after)) - Number(Boolean(before));
    const activeChange = Number(active(after)) - Number(active(before));
    if (totalChange || activeChange) await applyIdempotentDelta(db, `member_${event.id}`, { memberCount: totalChange, activeMemberCount: activeChange });
  });
  const orderWritten = onDocumentWritten({ document: 'companies/{companyId}/orders/{orderId}', region: 'us-central1' }, async event => {
    const before = data(event.data?.before), after = data(event.data?.after), now = new Date();
    const beforeDate = before ? dateOf(before.createdAt || before.date, now) : null;
    const afterDate = after ? dateOf(after.createdAt || after.date, now) : null;
    const totalChange = Number(Boolean(after)) - Number(Boolean(before));
    const affectedDate = afterDate || beforeDate || now;
    const aggregateDelta = { orderCount: totalChange, ...(dayKey(affectedDate) === dayKey(now) ? { ordersToday: totalChange } : {}), ...(monthKey(affectedDate) === monthKey(now) ? { ordersCurrentMonth: totalChange } : {}) };
    const applied = totalChange ? await applyIdempotentDelta(db, `order_total_${event.id}`, aggregateDelta, { month: monthKey(affectedDate), day: dayKey(affectedDate) }) : false;
    if (before && after && beforeDate && afterDate && (dayKey(beforeDate) !== dayKey(afterDate) || monthKey(beforeDate) !== monthKey(afterDate))) {
      await applyIdempotentDelta(db, `order_move_old_${event.id}`, { orderCount: -1, ...(dayKey(beforeDate) === dayKey(now) ? { ordersToday: -1 } : {}), ...(monthKey(beforeDate) === monthKey(now) ? { ordersCurrentMonth: -1 } : {}) }, { month: monthKey(beforeDate), day: dayKey(beforeDate) });
      await applyIdempotentDelta(db, `order_move_new_${event.id}`, { orderCount: 1, ...(dayKey(afterDate) === dayKey(now) ? { ordersToday: 1 } : {}), ...(monthKey(afterDate) === monthKey(now) ? { ordersCurrentMonth: 1 } : {}) }, { month: monthKey(afterDate), day: dayKey(afterDate) });
    }
    if (applied || totalChange === 0) await db.runTransaction(async tx => {
      const ref = db.doc(`companies/${event.params.companyId}`), company = await tx.get(ref);
      tx.set(ref, { lastActivityAt: FieldValue.serverTimestamp(), orderCount: Math.max(0, Number(company.data()?.orderCount || 0) + totalChange) }, { merge: true });
    });
  });
  const refreshPeriods = onSchedule({ schedule: '5 0 * * *', timeZone: 'UTC', region: 'us-central1' }, async () => {
    const now = new Date(), end = new Date(now); end.setUTCDate(end.getUTCDate() + 30);
    const [day, month, expiring] = await Promise.all([
      db.doc(`platformAggregates/daily_${dayKey(now)}`).get(), db.doc(`platformAggregates/monthly_${monthKey(now)}`).get(),
      db.collection('companies').where('status', 'in', ['active', 'trial', 'past_due']).where('subscriptionEnd', '>=', dayKey(now)).where('subscriptionEnd', '<=', dayKey(end)).count().get(),
    ]);
    await db.doc('platformAggregates/overview').set({ ordersToday: Math.max(0, Number(day.data()?.orderCount || 0)), ordersCurrentMonth: Math.max(0, Number(month.data()?.orderCount || 0)), newCompaniesCurrentMonth: Math.max(0, Number(month.data()?.companyCount || 0)), expiringSoonCompanyCount: expiring.data().count, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { companyWritten, memberWritten, orderWritten, refreshPeriods };
}
