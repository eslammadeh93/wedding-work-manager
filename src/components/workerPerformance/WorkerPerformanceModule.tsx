import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, Target, UsersRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import type { Order, Worker } from '../../types';
import { localDateString } from '../../utils/localDate';

type Period = 'all' | 'month' | 'week';
type WorkerPerformance = { id: string; name: string; assigned: number; completed: number; active: number; overdue: number; completionRate: number; orders: Order[] };
const doneStatuses = new Set(['completed', 'returned']);
const cancelledStatuses = new Set(['cancelled']);
const orderDate = (order: Order) => order.weddingDate || order.eventDate || order.createdAt?.slice(0, 10) || '';

export function WorkerPerformanceModule() {
  const { orders, workers, loading } = useData();
  const { authSession, profile } = useAuth();
  const [period, setPeriod] = useState<Period>('month');
  const [workerFilter, setWorkerFilter] = useState('all');
  const isWorker = authSession?.role === 'worker' || profile?.role === 'worker';
  const ownWorkerId = profile?.workerId || '';
  const today = localDateString();

  const relevantOrders = useMemo(() => {
    const from = new Date();
    if (period === 'week') from.setDate(from.getDate() - 7);
    if (period === 'month') from.setDate(from.getDate() - 30);
    const minimum = period === 'all' ? '' : localDateString(from);
    return orders.filter(order => Boolean(order.workerId) && (!isWorker || order.workerId === ownWorkerId) && (isWorker || workerFilter === 'all' || order.workerId === workerFilter) && (!minimum || orderDate(order) >= minimum));
  }, [isWorker, orders, ownWorkerId, period, workerFilter]);

  const performance = useMemo<WorkerPerformance[]>(() => {
    const knownWorkers = new Map<string, Worker>(); workers.forEach(worker => knownWorkers.set(worker.id, worker));
    const byWorker = new Map<string, Order[]>(); relevantOrders.forEach(order => byWorker.set(order.workerId!, [...(byWorker.get(order.workerId!) || []), order]));
    if (isWorker && ownWorkerId && !byWorker.has(ownWorkerId)) byWorker.set(ownWorkerId, []);
    return [...byWorker.entries()].map(([id, assignedOrders]) => {
      const completed = assignedOrders.filter(order => doneStatuses.has(order.orderStatus)).length;
      const active = assignedOrders.filter(order => !doneStatuses.has(order.orderStatus) && !cancelledStatuses.has(order.orderStatus)).length;
      const overdue = assignedOrders.filter(order => orderDate(order) < today && !doneStatuses.has(order.orderStatus) && !cancelledStatuses.has(order.orderStatus)).length;
      const fallbackName = assignedOrders.find(order => order.workerName)?.workerName || (id === ownWorkerId ? (authSession?.displayName || profile?.workerName || 'العامل الحالي') : 'عامل غير مسجل');
      return { id, name: knownWorkers.get(id)?.fullName || fallbackName, assigned: assignedOrders.length, completed, active, overdue, completionRate: assignedOrders.length ? Math.round((completed / assignedOrders.length) * 100) : 0, orders: assignedOrders };
    }).sort((a, b) => b.completionRate - a.completionRate || b.completed - a.completed || a.name.localeCompare(b.name));
  }, [authSession?.displayName, isWorker, ownWorkerId, profile?.workerName, relevantOrders, today, workers]);

  const totals = useMemo(() => performance.reduce((summary, item) => ({ assigned: summary.assigned + item.assigned, completed: summary.completed + item.completed, active: summary.active + item.active, overdue: summary.overdue + item.overdue }), { assigned: 0, completed: 0, active: 0, overdue: 0 }), [performance]);
  const selectableWorkers = useMemo(() => { const all = new Map<string, string>(workers.map(worker => [worker.id, worker.fullName])); orders.forEach(order => { if (order.workerId && !all.has(order.workerId)) all.set(order.workerId, order.workerName || 'عامل غير مسجل'); }); return [...all].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)); }, [orders, workers]);
  const latestOrders = useMemo(() => relevantOrders.slice().sort((a, b) => orderDate(b).localeCompare(orderDate(a))).slice(0, 8), [relevantOrders]);
  const overallRate = totals.assigned ? Math.round((totals.completed / totals.assigned) * 100) : 0;
  const cards = [['الأوردرات المسندة', totals.assigned, ClipboardList, 'text-blue-600 dark:text-blue-400'], ['تم التنفيذ', totals.completed, CheckCircle2, 'text-emerald-600 dark:text-emerald-400'], ['قيد المتابعة', totals.active, Target, 'text-amber-600 dark:text-amber-400'], ['تحتاج متابعة', totals.overdue, AlertTriangle, 'text-rose-600 dark:text-rose-400']] as const;

  return <section dir="rtl" className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div><h1 className="flex items-center gap-2 text-2xl font-black"><Target className="text-amber-500" />{isWorker ? 'متابعة أدائي' : 'متابعة أداء العمال'}</h1><p className="mt-1 text-sm text-slate-500">مؤشرات تشغيلية مبنية على الأوردرات المسندة وحالة تنفيذها.</p></div><div className="flex flex-wrap gap-2"><select value={period} onChange={event => setPeriod(event.target.value as Period)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800"><option value="week">آخر 7 أيام</option><option value="month">آخر 30 يومًا</option><option value="all">كل الفترة</option></select>{!isWorker && <select value={workerFilter} onChange={event => setWorkerFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800"><option value="all">كل العمال</option>{selectableWorkers.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select>}</div></header>
    {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">جارٍ تحميل مؤشرات الأداء…</div> : <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(([label, value, Icon, color]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><Icon className={`mb-2 h-5 w-5 ${color}`} /><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>)}</div>
      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]"><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800"><h2 className="font-black">{isWorker ? 'ملخص أدائك' : 'ملخص كل عامل'}</h2><span className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-black text-amber-800">نسبة الإنجاز العامة: {overallRate}%</span></div>{performance.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-right text-sm"><thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/60"><tr>{['العامل','المسند','المنفذ','قيد المتابعة','متأخر','نسبة الإنجاز'].map(label => <th key={label} className="p-3 font-bold">{label}</th>)}</tr></thead><tbody>{performance.map(item => <tr key={item.id} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3 font-bold">{item.name}</td><td className="p-3">{item.assigned}</td><td className="p-3 text-emerald-600">{item.completed}</td><td className="p-3 text-amber-600">{item.active}</td><td className="p-3 text-rose-600">{item.overdue}</td><td className="p-3"><div className="flex items-center gap-2"><span>{item.completionRate}%</span><div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${item.completionRate}%` }} /></div></div></td></tr>)}</tbody></table></div> : <div className="p-10 text-center text-sm text-slate-500"><UsersRound className="mx-auto mb-2 text-slate-400" />لا توجد أوردرات مسندة ضمن الفترة المحددة.</div>}</div>
      <aside className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><CalendarDays className="mb-2 h-5 w-5 text-amber-500" /><h2 className="font-black">قراءة سريعة</h2><p className="mt-2 text-sm leading-6 text-slate-500">الأوردر المتأخر هو الذي تجاوز تاريخ المناسبة ولم تُسجّل له حالة مكتمل أو مُرتجع.</p><div className="mt-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-xs font-bold text-slate-500">الأوردرات الحديثة</p><div className="mt-3 space-y-3">{latestOrders.length ? latestOrders.map(order => <div key={order.id} className="border-b border-slate-200 pb-2 last:border-0 last:pb-0 dark:border-slate-700"><p className="font-bold">{order.orderNumber}</p><p className="text-xs text-slate-500">{order.customerName} · {orderDate(order) || 'بدون تاريخ'}</p></div>) : <p className="text-sm text-slate-500">لا توجد بيانات.</p>}</div></div></aside></div></>}
  </section>;
}
