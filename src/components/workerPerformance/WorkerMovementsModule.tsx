import React, { useEffect, useMemo, useState } from 'react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { BellRing, CalendarDays, CheckCircle2, ChevronLeft, Clock, Eye, Loader2, MapPin, Search, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import type { ActivityLogRecord, Order } from '../../types';
import { companyDataService } from '../../multiTenant/data/companyDataService';
import { trustedCompanyIdFromSession } from '../../multiTenant/data/useTrustedCompanyId';
import { OrderDetailModal } from '../orders/OrderDetailModal';

const workerActions = new Set(['opened', 'arrived', 'finished', 'completed', 'worker_reported_arrival', 'worker_reported_completion']);
const asDate = (value: unknown) => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate();
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date;
};

const actionDetails = (action: string) => {
  if (action === 'opened') return { label: 'فتح الأوردر', Icon: Eye, tone: 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:border-blue-900' };
  if (action === 'arrived' || action === 'worker_reported_arrival') return { label: 'تم الوصول للموقع', Icon: MapPin, tone: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-900' };
  return { label: 'تم تنفيذ الأوردر', Icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-900' };
};

/** Manager view for the worker events that generate operational notifications. */
export function WorkerMovementsModule() {
  const { activityLogs, orders, workers, loading } = useData();
  const { authSession } = useAuth();
  const [workerId, setWorkerId] = useState('');
  const [search, setSearch] = useState('');
  const [pagedLogs, setPagedLogs] = useState<ActivityLogRecord[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [openingOrderId, setOpeningOrderId] = useState<string | null>(null);

  const companyId = useMemo(() => {
    try { return authSession ? trustedCompanyIdFromSession(authSession) : null; } catch { return null; }
  }, [authSession]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setLoadingMore(true); setPageError(null);
    void companyDataService.getActivityLogPage<ActivityLogRecord>(companyId, { pageSize: 100 }).then((result) => {
      if (cancelled) return;
      if (!result.success || !result.data) {
        setPagedLogs([]); setCursor(null); setHasMore(false); setPageError(result.message || 'تعذر تحميل تحركات العمال.');
      } else {
        setPagedLogs(result.data.records); setCursor(result.data.cursor); setHasMore(result.data.hasMore);
      }
      setLoadingMore(false);
    });
    return () => { cancelled = true; };
  }, [companyId]);

  const sourceLogs = useMemo(() => {
    const merged = new Map<string, ActivityLogRecord>();
    [...pagedLogs, ...activityLogs].forEach((log) => merged.set(log.id, log));
    return [...merged.values()].filter((log) => Boolean(log.workerId) && workerActions.has(log.action)).sort((a, b) => (asDate(b.timestamp)?.getTime() || 0) - (asDate(a.timestamp)?.getTime() || 0));
  }, [activityLogs, pagedLogs]);

  const selectableWorkers = useMemo(() => {
    const values = new Map(workers.map((worker) => [worker.id, worker.fullName]));
    sourceLogs.forEach((log) => {
      if (log.workerId && !values.has(log.workerId)) values.set(log.workerId, log.workerName || 'عامل غير مسجل');
    });
    return [...values.entries()].map(([id, name]) => ({ id, name: String(name || 'عامل غير مسجل') })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [sourceLogs, workers]);

  const visibleLogs = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return sourceLogs.filter((log) => {
      if (workerId && log.workerId !== workerId) return false;
      if (!term) return true;
      return [log.workerName, log.customerName, log.orderNumber, log.eventDate].some((value) => String(value || '').toLocaleLowerCase().includes(term));
    });
  }, [search, sourceLogs, workerId]);

  const loadMore = async () => {
    if (!companyId || !cursor || loadingMore) return;
    setLoadingMore(true); setPageError(null);
    const result = await companyDataService.getActivityLogPage<ActivityLogRecord>(companyId, { pageSize: 100, cursor });
    if (!result.success || !result.data) setPageError(result.message || 'تعذر تحميل تحركات أقدم.');
    else {
      setPagedLogs((current) => [...current, ...result.data!.records.filter((record) => !current.some((item) => item.id === record.id))]);
      setCursor(result.data.cursor); setHasMore(result.data.hasMore);
    }
    setLoadingMore(false);
  };

  const openOrder = async (log: ActivityLogRecord) => {
    const orderId = log.orderId;
    if (!orderId || openingOrderId) return;
    const inMemory = orders.find((order) => order.id === orderId || order.orderNumber === log.orderNumber);
    if (inMemory) { setSelectedOrder(inMemory); return; }
    if (!companyId) return;
    setOpeningOrderId(orderId);
    const result = await companyDataService.get<Order>(companyId, 'orders', orderId);
    if (result.success && result.data) setSelectedOrder(result.data);
    else setPageError('تعذر العثور على الأوردر المرتبط بهذه الحركة.');
    setOpeningOrderId(null);
  };

  return <section dir="rtl" className="space-y-5 animate-in fade-in duration-300">
    <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black"><BellRing className="text-amber-500" />تحركات العامل</h1>
        <p className="mt-1 text-sm text-slate-500">اختر العامل لمراجعة إشعارات فتح الأوردر والوصول والتنفيذ. اضغط على أي حركة لفتح الأوردر المرتبط بها.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="worker-movements-worker">العامل</label>
        <select id="worker-movements-worker" value={workerId} onChange={(event) => setWorkerId(event.target.value)} className="min-w-52 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold dark:border-slate-700 dark:bg-slate-800">
          <option value="">كل العمال</option>
          {selectableWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
        </select>
        <div className="relative min-w-52">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث في التحركات" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-9 pl-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </div>
      </div>
    </header>

    <div className="grid grid-cols-3 gap-3">
      {[
        ['فتح الأوردر', visibleLogs.filter((log) => log.action === 'opened').length, 'text-blue-600'],
        ['تم الوصول', visibleLogs.filter((log) => log.action === 'arrived' || log.action === 'worker_reported_arrival').length, 'text-amber-600'],
        ['تم التنفيذ', visibleLogs.filter((log) => log.action === 'finished' || log.action === 'completed' || log.action === 'worker_reported_completion').length, 'text-emerald-600'],
      ].map(([label, count, tone]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-xs font-bold text-slate-500">{label}</p><p className={`mt-1 text-2xl font-black ${tone}`}>{count}</p></div>)}
    </div>

    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 p-4 dark:border-slate-800"><h2 className="font-black">الإشعارات والتحركات</h2><p className="mt-1 text-xs text-slate-500">{workerId ? `${visibleLogs.length} حركة للعامل المختار` : `${visibleLogs.length} حركة ظاهرة`}</p></div>
      {loading && !sourceLogs.length ? <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-amber-500" />جارٍ تحميل التحركات…</div> : visibleLogs.length ? <div className="divide-y divide-slate-100 dark:divide-slate-800">{visibleLogs.map((log) => {
        const detail = actionDetails(log.action); const Icon = detail.Icon; const timestamp = asDate(log.timestamp);
        return <button type="button" key={log.id} onClick={() => void openOrder(log)} className="flex w-full items-center gap-3 p-4 text-right transition-colors hover:bg-amber-50/60 dark:hover:bg-amber-950/20">
          <span className={`rounded-xl border p-2 ${detail.tone}`}><Icon className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-x-2 gap-y-1"><strong>{log.workerName || 'عامل'}</strong><span className="text-sm text-slate-500">{detail.label}</span></span><span className="mt-1 block truncate text-xs text-slate-500">{log.orderNumber || 'أوردر'} · {log.customerName || 'بدون عميل'}{log.eventDate ? ` · ${log.eventDate}` : ''}</span></span>
          <span className="hidden text-left text-xs text-slate-400 sm:block">{timestamp ? timestamp.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</span>
          {openingOrderId === log.orderId ? <Loader2 className="h-4 w-4 animate-spin text-amber-500" /> : <ChevronLeft className="h-5 w-5 text-slate-400" />}
        </button>;
      })}</div> : <div className="p-12 text-center text-sm text-slate-500"><UserRound className="mx-auto mb-2 h-8 w-8 text-slate-300" />لا توجد تحركات مطابقة للعامل أو البحث المختار.</div>}
    </div>

    {pageError && <p role="alert" className="text-center text-xs font-bold text-rose-600">{pageError}</p>}
    {hasMore && <div className="text-center"><button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="rounded-xl border border-amber-400/40 px-5 py-2.5 text-xs font-black text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-60 dark:text-amber-300 dark:hover:bg-amber-950/30">{loadingMore ? 'جارٍ التحميل…' : 'تحميل تحركات أقدم'}</button></div>}

    {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} onEdit={() => {}} onPrint={() => {}} />}
  </section>;
}
