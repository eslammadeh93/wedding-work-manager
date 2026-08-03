import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { authorizePlatformDashboard, monthKey, statusDelta } from './platformDashboard.js';

type Totals = Record<string, number>;
const dateOf = (value: unknown) => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate() as Date;
  const date = new Date(String(value || '')); return Number.isNaN(date.getTime()) ? null : date;
};
const add = (target: Totals, source: Totals) => { for (const [key, value] of Object.entries(source)) target[key] = (target[key] || 0) + Number(value || 0); };

export class PlatformRebuildService {
  constructor(private readonly db: FirebaseFirestore.Firestore) {}
  async run(request: { auth?: { uid: string }; data?: unknown }) {
    const actor = await authorizePlatformDashboard(this.db, request.auth);
    if (actor.role !== 'platform_owner') throw new HttpsError('permission-denied', 'إعادة البناء متاحة لمالك المنصة فقط.');
    const input = request.data && typeof request.data === 'object' ? request.data as Record<string, unknown> : {};
    const dryRun = input.dryRun !== false, limit = Math.min(25, Math.max(1, Number(input.limit || 10)));
    const cursor = typeof input.cursor === 'string' ? input.cursor : '';
    const runId = typeof input.runId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(input.runId) ? input.runId : '';
    if (!dryRun && !runId) throw new HttpsError('invalid-argument', 'runId مطلوب عند تعطيل dryRun.');
    let query: FirebaseFirestore.Query = this.db.collection('companies').orderBy('__name__').limit(limit);
    if (cursor) { const snapshot = await this.db.doc(`companies/${cursor}`).get(); if (!snapshot.exists) throw new HttpsError('invalid-argument', 'Cursor غير صالح.'); query = query.startAfter(snapshot); }
    const companies = await query.get();
    const totals: Totals = { companyCount: 0, activeCompanyCount: 0, trialCompanyCount: 0, suspendedCompanyCount: 0, expiredCompanyCount: 0, expiringSoonCompanyCount: 0, memberCount: 0, orderCount: 0 };
    const monthlyCompanies: Totals = {}, monthlyOrders: Totals = {};
    const corrections: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];
    const plannedUpdates: Array<{ companyId: string; fields: string[]; missingAggregateFields: string[] }> = [];
    const now = new Date(), acceptedMonths = new Set(Array.from({ length: 12 }, (_, index) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1)))));
    let estimatedReads = companies.size;
    for (const company of companies.docs) {
      const companyData = company.data(); add(totals, statusDelta(null, companyData) as Totals);
      const [members, orders] = await Promise.all([company.ref.collection('members').select('status').get(), company.ref.collection('orders').select('createdAt', 'date').get()]);
      estimatedReads += members.size + orders.size; totals.memberCount += members.size; totals.orderCount += orders.size;
      const activeMemberCount = members.docs.filter(member => member.data().status === 'active').length;
      let lastActivityAt: Date | null = null;
      const createdMonth = dateOf(companyData.createdAt); if (createdMonth && acceptedMonths.has(monthKey(createdMonth))) monthlyCompanies[monthKey(createdMonth)] = (monthlyCompanies[monthKey(createdMonth)] || 0) + 1;
      for (const order of orders.docs) { const orderDate = dateOf(order.data().createdAt || order.data().date); if (orderDate && (!lastActivityAt || orderDate > lastActivityAt)) lastActivityAt = orderDate; if (orderDate && acceptedMonths.has(monthKey(orderDate))) monthlyOrders[monthKey(orderDate)] = (monthlyOrders[monthKey(orderDate)] || 0) + 1; }
      const fields = ['memberCount', 'activeMemberCount', 'orderCount', ...(lastActivityAt ? ['lastActivityAt'] : [])];
      const missingAggregateFields = fields.filter(field => companyData[field] == null);
      plannedUpdates.push({ companyId: company.id, fields, missingAggregateFields });
      corrections.push({ ref: company.ref, data: { memberCount: members.size, activeMemberCount, orderCount: orders.size, ...(lastActivityAt ? { lastActivityAt } : {}) } });
    }
    const nextCursor = companies.size === limit ? companies.docs.at(-1)?.id || null : null;
    if (dryRun) return {
      success: true, dryRun, processed: companies.size, nextCursor, pageTotals: totals, monthlyCompanies, monthlyOrders, estimatedReads,
      plannedUpdates, incompleteCompanies: plannedUpdates.filter(company => company.missingAggregateFields.length > 0),
      note: 'لم تتم أي كتابة. تكلفة القراءة الفعلية تشمل مستندات الأعضاء والأوردرات في هذه الصفحة.',
    };
    const runRef = this.db.doc(`platformRebuildRuns/${runId}`), pageRef = runRef.collection('pages').doc(cursor || 'start');
    const correctionBatch = this.db.batch(); corrections.forEach(correction => correctionBatch.set(correction.ref, correction.data, { merge: true })); await correctionBatch.commit();
    await this.db.runTransaction(async tx => {
      const [run, page] = await Promise.all([tx.get(runRef), tx.get(pageRef)]);
      if (page.exists) return;
      const cumulative = { ...(run.data()?.totals || {}) } as Totals; add(cumulative, totals);
      const cumulativeCompanies = { ...(run.data()?.monthlyCompanies || {}) } as Totals; add(cumulativeCompanies, monthlyCompanies);
      const cumulativeOrders = { ...(run.data()?.monthlyOrders || {}) } as Totals; add(cumulativeOrders, monthlyOrders);
      tx.create(pageRef, { cursor: cursor || null, nextCursor, processed: companies.size, appliedAt: FieldValue.serverTimestamp() });
      tx.set(runRef, { ownerUid: actor.uid, totals: cumulative, monthlyCompanies: cumulativeCompanies, monthlyOrders: cumulativeOrders, nextCursor, complete: !nextCursor, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (!nextCursor) {
        tx.set(this.db.doc('platformAggregates/overview'), { ...cumulative, updatedAt: FieldValue.serverTimestamp(), rebuiltAt: FieldValue.serverTimestamp(), rebuildRunId: runId }, { merge: true });
        for (const month of acceptedMonths) tx.set(this.db.doc(`platformAggregates/monthly_${month}`), { companyCount: cumulativeCompanies[month] || 0, orderCount: cumulativeOrders[month] || 0, updatedAt: FieldValue.serverTimestamp(), rebuildRunId: runId }, { merge: true });
      }
    });
    return { success: true, dryRun: false, processed: companies.size, nextCursor, pageTotals: totals, estimatedReads, runId, complete: !nextCursor };
  }
}
