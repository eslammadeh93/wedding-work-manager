import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  BellRing,
  Building2,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  Eye,
  EyeOff,
  Headphones,
  LineChart,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
} from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../../../firebase/config";
import { useAuth } from "../../../../context/AuthContext";
import { PLATFORM_PERMISSION_LABELS, PLATFORM_PERMISSION_MATRIX, PLATFORM_PERMISSIONS, PLATFORM_ROLES, type PlatformPermission, type PlatformRole } from "../../permissions/platformPermissions";
import { daysUntil, formatPlatformDate, listPlatformCompanies, listPlatformCompanyMembers } from "../../platformService";
import {
  createPlatformSupportTicket,
  addPlatformSupportComment,
  createPlatformNotification,
  deletePlatformNotification,
  getPlatformConsoleState,
  savePlatformConsoleSettings,
  updatePlatformSupportTicket,
  updatePlatformNotification,
  setPlatformMemberStatus,
  updatePlatformMember,
  setPlatformMemberTemporaryPassword,
  managePlatformSubscription,
  createPlatformAdmin,
  deletePlatformAdmin,
  updatePlatformAdmin,
  getPlatformPermissionConfiguration,
  updatePlatformRolePermissions,
  type PlatformConsoleSettings,
  type PlatformSupportTicket,
  type PlatformNotification,
} from "../../platformConsoleService";
import type { PlatformCompany } from "../../types";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { EmptyState } from "../../shared/EmptyState";
import { ErrorState } from "../../shared/ErrorState";
import { FilterBar } from "../../shared/FilterBar";
import { LoadingState } from "../../shared/LoadingState";
import { PlatformBadge } from "../../shared/PlatformBadge";
import { PlatformButton } from "../../shared/PlatformButton";
import { PlatformCard } from "../../shared/PlatformCard";
import { PlatformPageHeader } from "../../shared/PlatformPageHeader";
import { StatCard } from "../../shared/StatCard";

export type ManagementPageId =
  | "users"
  | "subscriptions"
  | "analytics"
  | "notifications"
  | "activity"
  | "support"
  | "settings"
  | "admins";

type Member = { uid: string; companyId: string; companyName: string; name: string; email: string; role: string; status: string; createdAt?: unknown };
type Audit = { id: string; action: string; companyId: string; actorUid: string; timestamp?: unknown };
type PlatformUser = { uid: string; name: string; email: string; role: string; status: string; permissions?: string[]; permissionsCustomized?: boolean; createdAt?: unknown };

const roleLabel: Record<string, string> = {
  company_super_admin: "صاحب الشركة", manager: "مدير", employee: "موظف", worker: "عامل",
  platform_owner: "صاحب المنصة", platform_admin: "مشرف المنصة", platform_support: "دعم فني",
  platform_billing: "فواتير", platform_read_only: "قراءة فقط",
};
const defaultPlatformRolePermissions: Record<string, string[]> = Object.fromEntries(PLATFORM_ROLES.map(role => [role, [...PLATFORM_PERMISSION_MATRIX[role]]])) as Record<string, string[]>;
const statusLabel: Record<string, string> = {
  active: "نشط", trial: "تجريبي", past_due: "متأخر", expired: "منتهي", suspended: "موقوف",
  open: "جديد", in_progress: "قيد المتابعة", resolved: "تم الحل",
};
const statusStyle: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  trial: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  past_due: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  expired: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100",
  suspended: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  open: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  resolved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};
const fieldClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const protectedPlatformAdminEmail = "eslam.madeh93@gmail.com";
const status = (value: string) => <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusStyle[value] || "bg-slate-100 text-slate-700"}`}>{statusLabel[value] || value}</span>;
const textValue = (value: unknown) => typeof value === "string" ? value : "";

function usePlatformCapability(permission: PlatformPermission) {
  const { authSession } = useAuth();
  return authSession?.userType === "platform" && authSession.permissions.includes(permission);
}

function useManagementData(page: ManagementPageId) {
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [admins, setAdmins] = useState<PlatformUser[]>([]);
  const [settings, setSettings] = useState<PlatformConsoleSettings>({ expiryDays: 30, compactMode: false, dailyDigest: true });
  const [supportTickets, setSupportTickets] = useState<PlatformSupportTicket[]>([]);
  const [notifications, setNotifications] = useState<PlatformNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [consoleError, setConsoleError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const companyRows = await listPlatformCompanies();
      const companyName = new Map(companyRows.map(company => [company.id, company.name]));
      setCompanies(companyRows);
      if (page === "users") {
        // Query each tenant's members path directly. This is more reliable than a
        // collection-group query for an owner console and keeps the tenant scope explicit.
        const memberGroups = await Promise.all(companyRows.map(async (company) => {
          const companyMembers = await listPlatformCompanyMembers(company.id);
          return companyMembers.map(member => ({
            uid: member.uid,
            companyId: company.id,
            companyName: companyName.get(company.id) || "شركة غير معرّفة",
            name: textValue(member.name) || "بدون اسم",
            email: textValue(member.email) || "—",
            role: textValue(member.role) || "employee",
            status: textValue(member.status) || "active",
            createdAt: member.createdAt,
          }));
        }));
        setMembers(memberGroups.flat());
      }
      if (page === "activity" || page === "analytics") {
        const auditSnapshot = await getDocs(collection(db, "platformAuditLogs"));
        setAudits(auditSnapshot.docs.map(doc => {
          const data = doc.data(); return { id: doc.id, action: textValue(data.action) || "إجراء نظام", companyId: textValue(data.companyId), actorUid: textValue(data.createdBy) || textValue(data.actorUid) || "—", timestamp: data.timestamp };
        }).sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || ""))));
      }
      if (page === "admins") {
        const adminSnapshot = await getDocs(collection(db, "platformUsers"));
        setAdmins(adminSnapshot.docs.map(doc => {
          const data = doc.data(); return { uid: doc.id, name: textValue(data.name) || "بدون اسم", email: textValue(data.email) || "—", role: textValue(data.role) || "platform_read_only", status: textValue(data.status) || "active", createdAt: data.createdAt };
        }));
      }
      if (["support", "settings", "notifications"].includes(page)) {
        try {
          const consoleState = await getPlatformConsoleState();
          setSettings(consoleState.settings);
          setSupportTickets(consoleState.supportTickets);
          setNotifications(consoleState.notifications);
          setConsoleError("");
        } catch {
          setSettings({ expiryDays: 30, compactMode: false, dailyDigest: true });
          setSupportTickets([]);
          setNotifications([]);
          setConsoleError("تعذر الاتصال بخدمات إدارة المنصة. تحقّق من نشر Cloud Functions وإتاحة استدعائها ثم أعد المحاولة.");
        }
      }
    } catch {
      setError("تعذر تحميل بيانات هذا القسم. تأكد من تسجيل الدخول بحساب صاحب المنصة ثم أعد المحاولة.");
    } finally { setLoading(false); }
  }, [page]);
  useEffect(() => { void load(); }, [load]);
  return { companies, members, audits, admins, settings, supportTickets, notifications, loading, error, consoleError, load };
}

export function PlatformManagementPages({ page, navigate }: { page: ManagementPageId; navigate: (path: string) => void }) {
  const data = useManagementData(page);
  if (data.loading) return <LoadingState text="جارٍ تحميل بيانات المنصة…" />;
  if (data.error) return <ErrorState message={data.error} onRetry={() => void data.load()} />;
  const props = { ...data, navigate };
  switch (page) {
    case "users": return <UsersPage {...props} />;
    case "subscriptions": return <SubscriptionsPage {...props} />;
    case "analytics": return <AnalyticsPage {...props} />;
    case "notifications": return <NotificationsPage {...props} />;
    case "activity": return <ActivityPage {...props} />;
    case "support": return <SupportPage {...props} />;
    case "settings": return <SettingsPage {...props} />;
    case "admins": return <AdminsPage {...props} />;
  }
}

function UsersPage({ members, companies, consoleError, load, navigate }: DataProps) {
  const canManageUsers = usePlatformCapability("platform:users:manage");
  const [search, setSearch] = useState(""); const [companyId, setCompanyId] = useState("");
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [passwordFor, setPasswordFor] = useState<Member | null>(null); const [temporaryPassword, setTemporaryPassword] = useState("");
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null); const [editName, setEditName] = useState(""); const [editEmail, setEditEmail] = useState("");
  const changeStatus = async (member: Member) => {
    const next = member.status === "active" ? "disabled" : "active";
    setSaving(true); setError("");
    try { await setPlatformMemberStatus({ companyId: member.companyId, memberUid: member.uid, status: next }); await load(); }
    catch { setError("تعذر تحديث حالة المستخدم. تحقّق من نشر Cloud Functions وصلاحيات حساب صاحب المنصة ثم أعد المحاولة."); }
    finally { setSaving(false); }
  };
  const resetPassword = async () => {
    if (!passwordFor || temporaryPassword.length < 12) return;
    setSaving(true); setError("");
    try { await setPlatformMemberTemporaryPassword({ companyId: passwordFor.companyId, memberUid: passwordFor.uid, temporaryPassword }); setPasswordFor(null); setTemporaryPassword(""); setShowTemporaryPassword(false); await load(); }
    catch { setError("تعذر تعيين كلمة المرور المؤقتة."); }
    finally { setSaving(false); }
  };
  const openEdit = (member: Member) => { setEditingMember(member); setEditName(member.name); setEditEmail(member.email); setError(""); };
  const saveEdit = async () => {
    if (!editingMember || editName.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(editEmail)) return;
    setSaving(true); setError("");
    try { await updatePlatformMember({ companyId: editingMember.companyId, memberUid: editingMember.uid, name: editName.trim(), email: editEmail.trim().toLowerCase() }); setEditingMember(null); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تعديل حساب المستخدم."); }
    finally { setSaving(false); }
  };
  const rows = useMemo(() => members.filter(member => (!companyId || member.companyId === companyId) && `${member.name} ${member.email} ${member.companyName}`.toLowerCase().includes(search.toLowerCase())), [members, companyId, search]);
  const columns: DataTableColumn<Member>[] = [
    { key: "name", header: "المستخدم", render: row => <div><p className="font-bold">{row.name}</p><p dir="ltr" className="text-xs text-slate-500">{row.email}</p></div> },
    { key: "company", header: "الشركة", render: row => <button className="font-bold text-amber-700 hover:underline" onClick={() => navigate(`/platform/companies/${row.companyId}`)}>{row.companyName}</button> },
    { key: "role", header: "الدور", render: row => roleLabel[row.role] || row.role },
    { key: "status", header: "الحالة", render: row => status(row.status) },
    { key: "date", header: "تاريخ الإنشاء", render: row => formatPlatformDate(row.createdAt) },
    { key: "actions", header: "إجراء", render: row => canManageUsers ? <div className="flex flex-wrap gap-2"><PlatformButton variant="secondary" disabled={saving} onClick={() => openEdit(row)}>تعديل الحساب</PlatformButton><PlatformButton variant="secondary" disabled={saving} onClick={() => { setPasswordFor(row); setTemporaryPassword(""); setShowTemporaryPassword(false); }}>كلمة مرور</PlatformButton><PlatformButton variant={row.status === "active" ? "danger" : "secondary"} disabled={saving} onClick={() => void changeStatus(row)}>{row.status === "active" ? "تعطيل" : "تفعيل"}</PlatformButton></div> : <span className="text-xs text-slate-500">عرض فقط</span> },
  ];
  return <section><PlatformPageHeader title="المستخدمون" description="عرض موحّد لجميع حسابات الشركات مع بياناتها وصلاحياتها." />
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><StatCard label="إجمالي الحسابات" value={members.length} icon={<Users size={18} />} /><StatCard label="الحسابات النشطة" value={members.filter(x => x.status === "active").length} icon={<CheckCircle2 size={18} />} /><StatCard label="أصحاب الشركات" value={members.filter(x => x.role === "company_super_admin").length} icon={<UserRound size={18} />} /></div>
    {consoleError && <p className="mb-4 rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-100">{consoleError}</p>}{error && <p className="mb-4 rounded-xl bg-rose-100 p-3 text-sm font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
    <FilterBar><div className="relative flex-1"><Search className="absolute right-3 top-2.5 text-slate-400" size={17} /><input className={`${fieldClass} pr-9`} placeholder="ابحث بالاسم أو البريد أو الشركة" value={search} onChange={e => setSearch(e.target.value)} /></div><select className={fieldClass} value={companyId} onChange={e => setCompanyId(e.target.value)}><option value="">كل الشركات</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></FilterBar>
    {rows.length ? <DataTable rows={rows} columns={columns} rowKey={row => row.uid} minWidthClass="min-w-[980px]" /> : <EmptyState text="لا توجد حسابات مطابقة للبحث." />}
    {editingMember && <div className="fixed inset-0 z-50 bg-slate-950/50 p-4"><div className="mx-auto mt-24 max-w-lg rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"><h2 className="font-black">تعديل الحساب</h2><p className="mt-1 text-sm text-slate-500">حدّث اسم المستخدم أو بريده الإلكتروني.</p><div className="mt-4 space-y-3"><label className="block text-sm font-bold">الاسم<input className={`${fieldClass} mt-1`} value={editName} onChange={e => setEditName(e.target.value)} /></label><label className="block text-sm font-bold">البريد الإلكتروني<input type="email" dir="ltr" className={`${fieldClass} mt-1`} value={editEmail} onChange={e => setEditEmail(e.target.value)} /></label></div><div className="mt-4 flex gap-2"><PlatformButton disabled={saving || editName.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(editEmail)} onClick={() => void saveEdit()}>{saving ? "جارٍ الحفظ…" : "حفظ التعديل"}</PlatformButton><PlatformButton variant="secondary" disabled={saving} onClick={() => setEditingMember(null)}>إلغاء</PlatformButton></div></div></div>}
    {passwordFor && <div className="fixed inset-0 z-50 bg-slate-950/50 p-4"><div className="mx-auto mt-24 max-w-lg rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"><h2 className="font-black">تعيين كلمة مرور</h2><p className="mt-1 text-sm text-slate-500">{passwordFor.name} — كلمة المرور الحالية محفوظة بأمان ولا يمكن عرضها. اكتب كلمة جديدة عند الحاجة.</p><div className="relative mt-4"><input type={showTemporaryPassword ? "text" : "password"} className={`${fieldClass} pl-10`} value={temporaryPassword} onChange={e => setTemporaryPassword(e.target.value)} placeholder="كلمة مرور جديدة — 12 حرفًا على الأقل" /><button type="button" onClick={() => setShowTemporaryPassword(visible => !visible)} className="absolute inset-y-0 left-0 flex w-10 items-center justify-center text-slate-400 hover:text-amber-600" aria-label={showTemporaryPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} title={showTemporaryPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}>{showTemporaryPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div><div className="mt-4 flex gap-2"><PlatformButton disabled={saving || temporaryPassword.length < 12} onClick={() => void resetPassword()}>{saving ? "جارٍ الحفظ…" : "تعيين كلمة المرور"}</PlatformButton><PlatformButton variant="secondary" onClick={() => { setPasswordFor(null); setTemporaryPassword(""); setShowTemporaryPassword(false); }}>إلغاء</PlatformButton></div></div></div>}</section>;
}

function SubscriptionsPage({ companies, load, navigate }: DataProps) {
  const canManageSubscriptions = usePlatformCapability("platform:subscriptions:manage");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<PlatformCompany | null>(null);
  const [plan, setPlan] = useState(""); const [subscriptionEnd, setSubscriptionEnd] = useState(""); const [nextStatus, setNextStatus] = useState<"trial" | "active" | "past_due" | "expired" | "suspended">("active");
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const open = (company: PlatformCompany) => { setEditing(company); setPlan(company.plan || "basic"); setSubscriptionEnd(typeof company.subscriptionEnd === "string" ? company.subscriptionEnd.slice(0, 10) : ""); setNextStatus(company.status); setError(""); };
  const save = async () => {
    if (!editing || !plan.trim() || !subscriptionEnd) return;
    setSaving(true); setError("");
    try { await managePlatformSubscription({ companyId: editing.id, plan: plan.trim(), status: nextStatus, subscriptionEnd }); setEditing(null); await load(); }
    catch { setError("تعذر تحديث الاشتراك. تحقّق من نشر Cloud Functions وصلاحيات حساب صاحب المنصة ثم أعد المحاولة."); }
    finally { setSaving(false); }
  };
  const rows = companies.filter(c => filter === "all" || c.status === filter);
  const columns: DataTableColumn<PlatformCompany>[] = [
    { key: "company", header: "الشركة", render: row => <button onClick={() => navigate(`/platform/companies/${row.id}`)} className="font-bold text-amber-700 hover:underline">{row.name}</button> },
    { key: "plan", header: "الباقة", render: row => <span className="uppercase">{row.plan || "—"}</span> },
    { key: "period", header: "الاشتراك", render: row => <div className="text-xs"><p>{formatPlatformDate(row.subscriptionStart)}</p><p className="text-slate-500">إلى {formatPlatformDate(row.subscriptionEnd)}</p></div> },
    { key: "remaining", header: "المتبقي", render: row => { const days = daysUntil(row.subscriptionEnd); return days === null ? "—" : days < 0 ? <span className="font-bold text-rose-700">منتهي</span> : `${days} يوم`; } },
    { key: "status", header: "الحالة", render: row => status(row.status) },
    { key: "actions", header: "إدارة", render: row => canManageSubscriptions ? <PlatformButton variant="secondary" onClick={() => open(row)}>تعديل</PlatformButton> : <span className="text-xs text-slate-500">عرض فقط</span> },
  ];
  return <section><PlatformPageHeader title="الاشتراكات" description="متابعة الباقات وتواريخ الانتهاء وحالة كل اشتراك." />
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><StatCard label="اشتراكات نشطة" value={companies.filter(c => c.status === "active").length} icon={<CreditCard size={18} />} /><StatCard label="تنتهي خلال 30 يومًا" value={companies.filter(c => { const days = daysUntil(c.subscriptionEnd); return days !== null && days >= 0 && days <= 30; }).length} icon={<CircleAlert size={18} />} /><StatCard label="تحتاج متابعة مالية" value={companies.filter(c => ["past_due", "expired"].includes(c.status)).length} icon={<CircleAlert size={18} />} /></div>
    <FilterBar><select className={fieldClass} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">كل الحالات</option><option value="active">نشطة</option><option value="trial">تجريبية</option><option value="past_due">متأخرة</option><option value="expired">منتهية</option><option value="suspended">موقوفة</option></select></FilterBar>
    {error && <p className="mb-4 rounded-xl bg-rose-100 p-3 text-sm font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
    {rows.length ? <DataTable rows={rows} columns={columns} rowKey={row => row.id} minWidthClass="min-w-[860px]" /> : <EmptyState text="لا توجد اشتراكات بهذه الحالة." />}
    {editing && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4"><div className="mx-auto mt-16 max-w-lg rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"><h2 className="font-black">إدارة اشتراك {editing.name}</h2><div className="mt-4 space-y-3"><label className="block text-sm font-bold">الباقة<input className={`${fieldClass} mt-1`} value={plan} onChange={e => setPlan(e.target.value)} /></label><label className="block text-sm font-bold">الحالة<select className={`${fieldClass} mt-1`} value={nextStatus} onChange={e => setNextStatus(e.target.value as typeof nextStatus)}><option value="trial">تجريبية</option><option value="active">نشطة</option><option value="past_due">متأخرة</option><option value="expired">منتهية</option><option value="suspended">موقوفة</option></select></label><label className="block text-sm font-bold">نهاية الاشتراك<input type="date" className={`${fieldClass} mt-1`} value={subscriptionEnd} onChange={e => setSubscriptionEnd(e.target.value)} /></label></div><div className="mt-5 flex gap-2"><PlatformButton disabled={saving || !plan.trim() || !subscriptionEnd} onClick={() => void save()}>{saving ? "جارٍ الحفظ…" : "حفظ التعديل"}</PlatformButton><PlatformButton variant="secondary" onClick={() => setEditing(null)}>إلغاء</PlatformButton></div></div></div>}</section>;
}

function AnalyticsPage({ companies, members, audits, navigate }: DataProps) {
  const groupedPlans = Object.entries(companies.reduce<Record<string, number>>((result, company) => { result[company.plan || "غير محددة"] = (result[company.plan || "غير محددة"] || 0) + 1; return result; }, {})) as [string, number][];
  const max = Math.max(...groupedPlans.map(([, value]) => value), 1);
  const attention = companies.filter(c => c.status === "past_due" || c.status === "suspended" || (daysUntil(c.subscriptionEnd) ?? 99) <= 30).slice(0, 6);
  return <section><PlatformPageHeader title="الإحصائيات" description="قراءة سريعة لصحة المنصة وتوزّع العملاء ومؤشرات المتابعة." />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="الشركات" value={companies.length} icon={<Building2 size={18} />} /><StatCard label="المستخدمون" value={members.length} icon={<Users size={18} />} /><StatCard label="متوسط المستخدمين للشركة" value={companies.length ? (members.length / companies.length).toFixed(1) : "0"} icon={<LineChart size={18} />} /><StatCard label="إجراءات المنصة المسجلة" value={audits.length} icon={<ShieldCheck size={18} />} /></div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2"><PlatformCard className="p-5"><h2 className="font-black">توزيع الشركات حسب الباقة</h2><div className="mt-5 space-y-4">{groupedPlans.length ? groupedPlans.map(([plan, count]) => <div key={plan}><div className="mb-1 flex justify-between text-sm"><span className="font-bold uppercase">{plan}</span><span>{count} شركة</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-amber-500" style={{ width: `${(count / max) * 100}%` }} /></div></div>) : <p className="text-sm text-slate-500">لا توجد بيانات باقات بعد.</p>}</div></PlatformCard>
      <PlatformCard className="p-5"><h2 className="font-black">حالات الاشتراكات</h2><div className="mt-4 grid grid-cols-2 gap-3">{["active", "trial", "past_due", "expired", "suspended"].map(key => <div key={key} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><div>{status(key)}</div><p className="mt-2 text-2xl font-black">{companies.filter(c => c.status === key).length}</p></div>)}</div></PlatformCard></div>
    <PlatformCard className="mt-5 p-5"><h2 className="font-black">شركات تحتاج متابعة</h2><div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">{attention.length ? attention.map(company => <button key={company.id} onClick={() => navigate(`/platform/companies/${company.id}`)} className="flex w-full items-center justify-between py-3 text-right hover:text-amber-700"><span className="font-bold">{company.name}</span><span>{status(company.status)}</span></button>) : <p className="py-3 text-sm text-slate-500">لا توجد حالات تستدعي المتابعة الآن.</p>}</div></PlatformCard></section>;
}

function NotificationsPage({ companies, settings, notifications, consoleError, load, navigate }: DataProps) {
  const canManageNotifications = usePlatformCapability("platform:notifications:manage");
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [severity, setSeverity] = useState<PlatformNotification["severity"]>("info");
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const alerts = useMemo(() => companies.flatMap(company => {
    const days = daysUntil(company.subscriptionEnd);
    if (company.status === "past_due") return [{ id: `${company.id}-due`, company, title: "اشتراك متأخر عن السداد", detail: "يرجى متابعة حالة الدفع مع الشركة.", level: "past_due" }];
    if (company.status === "suspended") return [{ id: `${company.id}-suspended`, company, title: "شركة موقوفة", detail: "تحتاج مراجعة سبب الإيقاف قبل إعادة التفعيل.", level: "suspended" }];
    if (days !== null && days >= 0 && days <= settings.expiryDays) return [{ id: `${company.id}-expiry`, company, title: "اشتراك على وشك الانتهاء", detail: `متبقي ${days} يومًا على نهاية الاشتراك.`, level: "trial" }];
    return [];
  }), [companies, settings.expiryDays]);
  const create = async () => {
    if (title.trim().length < 3 || body.trim().length < 3) return;
    setSaving(true); setError("");
    try { await createPlatformNotification({ title: title.trim(), body: body.trim(), severity }); setTitle(""); setBody(""); await load(); }
    catch { setError("تعذر إنشاء الإشعار."); }
    finally { setSaving(false); }
  };
  const change = async (id: string, next: PlatformNotification["status"]) => {
    setSaving(true); setError("");
    try { await updatePlatformNotification({ notificationId: id, status: next }); await load(); }
    catch { setError("تعذر تحديث الإشعار."); }
    finally { setSaving(false); }
  };
  const remove = async (item: PlatformNotification) => {
    if (!window.confirm(`هل تريد حذف الإشعار «${item.title}» نهائيًا؟`)) return;
    setSaving(true); setError("");
    try { await deletePlatformNotification({ notificationId: item.id }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حذف الإشعار."); }
    finally { setSaving(false); }
  };
  return <section><PlatformPageHeader title="الإشعارات" description={`تنبيهات تشغيلية تلقائية مستخرجة من حالة الاشتراكات والشركات (قبل ${settings.expiryDays} يومًا من الانتهاء).`} />
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><StatCard label="تنبيهات تحتاج إجراء" value={alerts.length + notifications.filter(n => n.status === "unread").length} icon={<BellRing size={18} />} /><StatCard label="اشتراكات قريبة" value={alerts.filter(x => x.id.endsWith("expiry")).length} icon={<CreditCard size={18} />} /><StatCard label="حالات متأخرة أو موقوفة" value={alerts.filter(x => x.level !== "trial").length} icon={<CircleAlert size={18} />} /></div>
    {consoleError && <p className="mb-4 rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-100">{consoleError}</p>}
    <PlatformCard className="mb-5 p-5"><h2 className="font-black">إنشاء إشعار إداري</h2><div className="mt-4 grid gap-3 md:grid-cols-4"><input disabled={!canManageNotifications || Boolean(consoleError)} className={fieldClass} value={title} onChange={e => setTitle(e.target.value)} placeholder="عنوان الإشعار" /><input disabled={!canManageNotifications || Boolean(consoleError)} className={fieldClass} value={body} onChange={e => setBody(e.target.value)} placeholder="نص مختصر" /><select disabled={!canManageNotifications || Boolean(consoleError)} className={fieldClass} value={severity} onChange={e => setSeverity(e.target.value as PlatformNotification["severity"])}><option value="info">معلومة</option><option value="warning">تنبيه</option><option value="critical">عاجل</option></select><PlatformButton disabled={!canManageNotifications || Boolean(consoleError) || saving || title.trim().length < 3 || body.trim().length < 3} onClick={() => void create()}>{saving ? "جارٍ الحفظ…" : "إرسال إشعار"}</PlatformButton></div></PlatformCard>
    {error && <p className="mb-4 rounded-xl bg-rose-100 p-3 text-sm font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
    <div className="space-y-3">{notifications.map(item => <PlatformCard key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-black">{item.title}</p><p className="mt-1 text-sm text-slate-500">{item.body}</p></div><div className="flex flex-wrap items-center gap-2">{status(item.severity)}<select disabled={!canManageNotifications || saving || Boolean(consoleError)} aria-label="حالة الإشعار" className={`${fieldClass} w-auto`} value={item.status} onChange={e => void change(item.id, e.target.value as PlatformNotification["status"])}><option value="unread">غير مقروء</option><option value="read">مقروء</option><option value="archived">مؤرشف</option></select><PlatformButton variant="danger" disabled={!canManageNotifications || saving || Boolean(consoleError)} onClick={() => void remove(item)}>حذف</PlatformButton></div></PlatformCard>)}{alerts.map(alert => <PlatformCard key={alert.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex items-start gap-3"><span className="mt-0.5 rounded-xl bg-amber-100 p-2 text-amber-700 dark:bg-amber-950"><BellRing size={18} /></span><div><p className="font-black">{alert.title}</p><p className="mt-1 text-sm text-slate-500">{alert.company.name} — {alert.detail}</p></div></div><div className="flex items-center gap-3">{status(alert.level)}<PlatformButton variant="secondary" onClick={() => navigate(`/platform/companies/${alert.company.id}`)}>فتح الشركة</PlatformButton></div></PlatformCard>)}{!alerts.length && !notifications.length && <EmptyState text="لا توجد تنبيهات تشغيلية حالياً." />}</div></section>;
}

function ActivityPage({ audits, companies, navigate }: DataProps) {
  const [search, setSearch] = useState(""); const companyNames = new Map(companies.map(c => [c.id, c.name]));
  const rows = audits.filter(row => `${row.action} ${row.actorUid} ${companyNames.get(row.companyId) || ""}`.toLowerCase().includes(search.toLowerCase()));
  const columns: DataTableColumn<Audit>[] = [
    { key: "action", header: "الإجراء", render: row => <span className="font-bold">{row.action.replaceAll("_", " ")}</span> },
    { key: "company", header: "الشركة", render: row => row.companyId ? <button onClick={() => navigate(`/platform/companies/${row.companyId}`)} className="text-amber-700 hover:underline">{companyNames.get(row.companyId) || row.companyId}</button> : "—" },
    { key: "actor", header: "المنفّذ", render: row => <span dir="ltr">{row.actorUid}</span> },
    { key: "date", header: "التاريخ", render: row => formatPlatformDate(row.timestamp) },
  ];
  return <section><PlatformPageHeader title="سجل النشاط" description="سجل الإجراءات الموثوقة التي تمت على مستوى المنصة." /><FilterBar><div className="relative flex-1"><Search className="absolute right-3 top-2.5 text-slate-400" size={17} /><input className={`${fieldClass} pr-9`} value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث في الإجراء أو الشركة أو المنفّذ" /></div></FilterBar>{rows.length ? <DataTable rows={rows} columns={columns} rowKey={row => row.id} minWidthClass="min-w-[720px]" /> : <EmptyState text="لا توجد إجراءات مسجلة أو لا توجد نتائج مطابقة." />}</section>;
}

function SupportPage({ companies, supportTickets, consoleError, load }: DataProps) {
  const canManageSupport = usePlatformCapability("platform:support:manage");
  const [companyId, setCompanyId] = useState(""); const [subject, setSubject] = useState("");
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [commentFor, setCommentFor] = useState<string | null>(null); const [comment, setComment] = useState("");
  const add = async () => {
    if (!companyId || subject.trim().length < 4) return;
    setSaving(true); setError("");
    try { await createPlatformSupportTicket({ companyId, subject: subject.trim() }); setSubject(""); setCompanyId(""); await load(); }
    catch { setError("تعذر تسجيل طلب الدعم. حاول مرة أخرى."); }
    finally { setSaving(false); }
  };
  const changeStatus = async (ticketId: string, nextStatus: PlatformSupportTicket["status"]) => {
    setSaving(true); setError("");
    try { await updatePlatformSupportTicket({ ticketId, status: nextStatus }); await load(); }
    catch { setError("تعذر تحديث حالة طلب الدعم."); }
    finally { setSaving(false); }
  };
  const changePriority = async (ticketId: string, priority: PlatformSupportTicket["priority"]) => {
    setSaving(true); setError("");
    try { await updatePlatformSupportTicket({ ticketId, status: supportTickets.find(item => item.id === ticketId)?.status || "open", priority }); await load(); }
    catch { setError("تعذر تحديث أولوية طلب الدعم."); }
    finally { setSaving(false); }
  };
  const addComment = async () => {
    if (!commentFor || !comment.trim()) return;
    setSaving(true); setError("");
    try { await addPlatformSupportComment({ ticketId: commentFor, body: comment.trim() }); setComment(""); setCommentFor(null); await load(); }
    catch { setError("تعذر إضافة تعليق الدعم."); }
    finally { setSaving(false); }
  };
  return <section><PlatformPageHeader title="الدعم الفني" description="سجّل وتابع طلبات الدعم من شاشة المنصة؛ تُحفظ وتُشارك مركزيًا مع فريق الإدارة." />
    {consoleError && <p className="mb-4 rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-100">{consoleError}</p>}
    <PlatformCard className="mb-5 p-5"><h2 className="font-black">تسجيل طلب دعم</h2><div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]"><select disabled={!canManageSupport || Boolean(consoleError)} className={fieldClass} value={companyId} onChange={e => setCompanyId(e.target.value)}><option value="">اختر الشركة</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><input disabled={!canManageSupport || Boolean(consoleError)} className={fieldClass} value={subject} onChange={e => setSubject(e.target.value)} placeholder="موضوع أو ملخص المشكلة" /><PlatformButton onClick={add} disabled={!canManageSupport || Boolean(consoleError) || !companyId || subject.trim().length < 4 || saving}><Headphones size={17} />{saving ? "جارٍ الحفظ…" : "إضافة طلب"}</PlatformButton></div></PlatformCard>
    {error && <p className="mb-4 rounded-xl bg-rose-100 p-3 text-sm font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
    <div className="space-y-3">{supportTickets.length ? supportTickets.map(item => <PlatformCard key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-black">{item.subject}</p><p className="mt-1 text-sm text-slate-500">{item.companyName} · {formatPlatformDate(item.createdAt)} · {item.commentCount || 0} تعليق</p></div><div className="flex flex-wrap items-center gap-2"><PlatformButton variant="secondary" disabled={!canManageSupport || Boolean(consoleError)} onClick={() => setCommentFor(item.id)}>تعليق</PlatformButton><select aria-label="أولوية الطلب" disabled={!canManageSupport || saving || Boolean(consoleError)} className={`${fieldClass} w-auto`} value={item.priority} onChange={e => void changePriority(item.id, e.target.value as PlatformSupportTicket["priority"])}><option value="low">منخفضة</option><option value="normal">عادية</option><option value="high">عالية</option><option value="urgent">عاجلة</option></select><select aria-label="حالة الطلب" disabled={!canManageSupport || saving || Boolean(consoleError)} className={`${fieldClass} w-auto`} value={item.status} onChange={e => void changeStatus(item.id, e.target.value as PlatformSupportTicket["status"])}><option value="open">جديد</option><option value="in_progress">قيد المتابعة</option><option value="resolved">تم الحل</option></select>{status(item.status)}</div></PlatformCard>) : <EmptyState text="لا توجد طلبات دعم مسجلة بعد." />}</div>
    {commentFor && <div className="fixed inset-0 z-50 bg-slate-950/50 p-4"><div className="mx-auto mt-24 max-w-lg rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"><h2 className="font-black">إضافة تعليق للدعم</h2><textarea className={`${fieldClass} mt-4 min-h-28`} value={comment} onChange={e => setComment(e.target.value)} placeholder="اكتب تفاصيل المتابعة أو الحل…" /><div className="mt-4 flex gap-2"><PlatformButton disabled={saving || !comment.trim()} onClick={() => void addComment()}>{saving ? "جارٍ الحفظ…" : "إضافة تعليق"}</PlatformButton><PlatformButton variant="secondary" onClick={() => setCommentFor(null)}>إلغاء</PlatformButton></div></div></div>}</section>;
}

function SettingsPage({ settings: savedSettings, consoleError, load }: DataProps) {
  const [settings, setSettings] = useState(savedSettings);
  const [saved, setSaved] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => setSettings(savedSettings), [savedSettings]);
  const persist = async () => {
    setSaving(true); setError("");
    try { await savePlatformConsoleSettings(settings); setSaved(true); await load(); window.setTimeout(() => setSaved(false), 2500); }
    catch { setError("تعذر حفظ إعدادات النظام. حاول مرة أخرى."); }
    finally { setSaving(false); }
  };
  return <section><PlatformPageHeader title="إعدادات النظام" description="إعدادات تشغيل مركزية للوحة صاحب المنصة." actions={<PlatformButton disabled={saving || Boolean(consoleError)} onClick={() => void persist()}><Save size={17} />{saving ? "جارٍ الحفظ…" : "حفظ الإعدادات"}</PlatformButton>} />
    {consoleError && <p className="mb-4 rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-100">{consoleError}</p>}
    <div className="grid gap-5 lg:grid-cols-2"><PlatformCard className="p-5"><div className="flex items-center gap-2"><SlidersHorizontal className="text-amber-700" size={20} /><h2 className="font-black">التنبيهات والعرض</h2></div><div className="mt-5 space-y-5"><label className="block text-sm font-bold">فترة تنبيه انتهاء الاشتراك (بالأيام)<input type="number" min="1" max="365" className={`${fieldClass} mt-2`} value={settings.expiryDays} onChange={e => setSettings({ ...settings, expiryDays: Number(e.target.value) })} /></label>{[["dailyDigest", "تفعيل ملخص التنبيهات اليومي"], ["compactMode", "استخدام عرض مدمج للجداول"] as const].map(([field, label]) => <label key={field} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm font-bold dark:bg-slate-800"><span>{label}</span><input type="checkbox" checked={settings[field]} onChange={e => setSettings({ ...settings, [field]: e.target.checked })} className="h-4 w-4 accent-amber-600" /></label>)}</div></PlatformCard><PlatformCard className="p-5"><div className="flex items-center gap-2"><ShieldCheck className="text-amber-700" size={20} /><h2 className="font-black">أمان المنصة</h2></div><ul className="mt-5 space-y-3 text-sm text-slate-600 dark:text-slate-300"><li>• تغييرات الشركات والحسابات تتم عبر خدمات موثوقة ومسجلة في سجل النشاط.</li><li>• كلمات المرور لا تُعرض ولا تُخزّن في واجهة الإدارة.</li><li>• إدارة الصلاحيات الحساسة محمية بسياسات Firestore والخدمات الخلفية.</li></ul></PlatformCard></div>{saved && <p className="mt-4 rounded-xl bg-emerald-100 p-3 text-sm font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">تم حفظ إعدادات النظام بنجاح.</p>}{error && <p className="mt-4 rounded-xl bg-rose-100 p-3 text-sm font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-100">{error}</p>}</section>;
}

function AdminsPage({ admins, load }: DataProps) {
  const { authSession } = useAuth();
  const roles = PLATFORM_ROLES;
  const isOwner = authSession?.userType === "platform" && authSession.role === "platform_owner";
  const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>(defaultPlatformRolePermissions);
  const [formOpen, setFormOpen] = useState(false); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [role, setRole] = useState<PlatformRole>("platform_admin");
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [editing, setEditing] = useState<PlatformUser | null>(null); const [editName, setEditName] = useState(""); const [editEmail, setEditEmail] = useState(""); const [editRole, setEditRole] = useState<PlatformRole>("platform_admin"); const [editStatus, setEditStatus] = useState<"active" | "disabled">("active"); const [useRolePermissions, setUseRolePermissions] = useState(true); const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [editingRole, setEditingRole] = useState<PlatformRole | null>(null); const [roleDraft, setRoleDraft] = useState<string[]>([]);
  useEffect(() => { if (!isOwner) return; void getPlatformPermissionConfiguration().then(setRolePermissions).catch(() => { /* Defaults remain available until the updated Functions are deployed. */ }); }, [isOwner]);
  const togglePermission = (permission: string, set: Dispatch<SetStateAction<string[]>>) => set(current => current.includes(permission) ? current.filter(item => item !== permission) : [...current, permission]);
  const create = async () => { if (name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12) return; setSaving(true); setError(""); try { await createPlatformAdmin({ name: name.trim(), email: email.trim(), password, role }); setFormOpen(false); setName(""); setEmail(""); setPassword(""); await load(); } catch { setError("تعذر إنشاء حساب المشرف. تحقّق من نشر Cloud Functions وصلاحيات حساب صاحب المنصة ثم أعد المحاولة."); } finally { setSaving(false); } };
  const update = async (admin: PlatformUser, status: "active" | "disabled") => { setSaving(true); setError(""); try { await updatePlatformAdmin({ uid: admin.uid, role: admin.role as PlatformRole, status }); await load(); } catch { setError("تعذر تحديث حساب المشرف."); } finally { setSaving(false); } };
  const openEdit = (admin: PlatformUser) => { setEditing(admin); setEditName(admin.name); setEditEmail(admin.email); setEditRole(admin.role as PlatformRole); setEditStatus(admin.status as "active" | "disabled"); setUseRolePermissions(!admin.permissionsCustomized); setEditPermissions(admin.permissions || rolePermissions[admin.role] || []); };
  const saveEdit = async () => { if (!editing || editName.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(editEmail)) return; setSaving(true); setError(""); try { await updatePlatformAdmin({ uid: editing.uid, name: editName.trim(), email: editEmail.trim(), role: editRole, status: editStatus, useRolePermissions, ...(useRolePermissions ? {} : { permissions: editPermissions }) }); setEditing(null); await load(); if (editing.uid === authSession?.uid) window.location.reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تعديل حساب المشرف."); } finally { setSaving(false); } };
  const saveRolePermissions = async () => { if (!editingRole) return; setSaving(true); setError(""); try { await updatePlatformRolePermissions({ role: editingRole, permissions: roleDraft }); setRolePermissions(current => ({ ...current, [editingRole]: roleDraft })); setEditingRole(null); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ صلاحيات المنصب."); } finally { setSaving(false); } };
  const remove = async (admin: PlatformUser) => { if (!window.confirm(`هل تريد حذف حساب ${admin.name} نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`)) return; setSaving(true); setError(""); try { await deletePlatformAdmin({ uid: admin.uid }); await load(); } catch (cause) { const message = cause instanceof Error ? cause.message : ""; setError(message && message !== "internal" ? message : "تعذر حذف الحساب لأن خدمة الحذف لم تُنشر بعد أو تعمل بإصدار قديم. انشر Cloud Functions ثم أعد المحاولة."); } finally { setSaving(false); } };
  const permissionEditor = (selected: string[], set: Dispatch<SetStateAction<string[]>>) => <div className="grid gap-2 sm:grid-cols-2">{PLATFORM_PERMISSIONS.map(permission => <label key={permission} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-xs font-bold dark:border-slate-700"><input type="checkbox" checked={selected.includes(permission)} onChange={() => togglePermission(permission, set)} className="h-4 w-4 accent-amber-600" />{PLATFORM_PERMISSION_LABELS[permission]}</label>)}</div>;
  const columns: DataTableColumn<PlatformUser>[] = [
    { key: "name", header: "المشرف", render: row => <div><p className="font-bold">{row.name}</p><p className="text-xs text-slate-500" dir="ltr">{row.email}</p></div> },
    { key: "role", header: "الدور", render: row => roleLabel[row.role] || row.role },
    { key: "permissions", header: "نطاق الصلاحيات", render: row => <PlatformBadge className="platform-badge-neutral">{(row.permissions || rolePermissions[row.role] || []).length} صلاحية{row.permissionsCustomized ? " مخصصة" : ""}</PlatformBadge> },
    { key: "status", header: "الحالة", render: row => status(row.status) }, { key: "date", header: "تاريخ الإنشاء", render: row => formatPlatformDate(row.createdAt) },
    { key: "action", header: "إجراء", render: row => { const isProtected = row.email.trim().toLowerCase() === protectedPlatformAdminEmail; const canEditProtected = authSession?.uid === row.uid && authSession.email.trim().toLowerCase() === protectedPlatformAdminEmail; if (isProtected && !canEditProtected) return <span className="text-xs font-bold text-amber-700 dark:text-amber-300">حساب محمي</span>; return <div className="flex flex-wrap gap-2"><PlatformButton variant="secondary" disabled={saving} onClick={() => openEdit(row)}>تعديل</PlatformButton>{!isProtected && <><PlatformButton variant={row.status === "active" ? "danger" : "secondary"} disabled={saving} onClick={() => void update(row, row.status === "active" ? "disabled" : "active")}>{row.status === "active" ? "تعطيل" : "تفعيل"}</PlatformButton><PlatformButton variant="danger" disabled={saving} onClick={() => void remove(row)}>حذف</PlatformButton></>}</div>; } },
  ];
  return <section><PlatformPageHeader title="المشرفون والصلاحيات" description="الحسابات الإدارية المعتمدة ونطاق وصول كل دور في المنصة." actions={isOwner ? <PlatformButton onClick={() => setFormOpen(true)}>إضافة مشرف</PlatformButton> : undefined} />
    <div className="mb-5 grid gap-3 sm:grid-cols-2"><StatCard label="حسابات إدارة المنصة" value={admins.length} icon={<ShieldCheck size={18} />} /><StatCard label="الحسابات النشطة" value={admins.filter(a => a.status === "active").length} icon={<CheckCircle2 size={18} />} /></div>{error && <p className="mb-4 rounded-xl bg-rose-100 p-3 text-sm font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-100">{error}</p>}{admins.length ? <DataTable rows={admins} columns={columns} rowKey={row => row.uid} minWidthClass="min-w-[820px]" /> : <EmptyState text="لا توجد حسابات إدارة مسجلة." />}
    <PlatformCard className="mt-5 p-5"><h2 className="font-black">مصفوفة الصلاحيات</h2><p className="mt-1 text-sm text-slate-500">اضغط على أي منصب لعرض صلاحياته وتعديلها.</p><div className="mt-4 grid gap-3 md:grid-cols-2">{roles.map(item => <button key={item} type="button" disabled={!isOwner} onClick={() => { setEditingRole(item); setRoleDraft(rolePermissions[item] || []); }} className="rounded-xl border border-slate-200 p-3 text-right transition hover:border-amber-500 disabled:cursor-default disabled:hover:border-slate-200 dark:border-slate-700"><p className="font-bold">{roleLabel[item]}</p><p className="mt-1 text-sm text-slate-500">{(rolePermissions[item] || []).length} صلاحية مفعّلة</p></button>)}</div></PlatformCard>
    {editingRole && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4"><div className="mx-auto mt-12 max-w-3xl rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"><h2 className="font-black">صلاحيات {roleLabel[editingRole]}</h2><p className="mt-1 text-sm text-slate-500">اختر الصلاحيات المتاحة لكل حساب بهذا المنصب.</p><div className="mt-4">{permissionEditor(roleDraft, setRoleDraft)}</div><div className="mt-5 flex gap-2"><PlatformButton disabled={saving} onClick={() => void saveRolePermissions()}>{saving ? "جارٍ الحفظ…" : "حفظ صلاحيات المنصب"}</PlatformButton><PlatformButton variant="secondary" disabled={saving} onClick={() => setEditingRole(null)}>إلغاء</PlatformButton></div></div></div>}
    {editing && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4"><div className="mx-auto mt-12 max-w-3xl rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"><h2 className="font-black">تعديل حساب المشرف</h2><p className="mt-1 text-sm text-slate-500">حدّث بيانات الحساب، أو خصص صلاحياته بدلًا من صلاحيات منصبه.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><label className="block text-sm font-bold">الاسم<input className={`${fieldClass} mt-1`} value={editName} onChange={e => setEditName(e.target.value)} /></label><label className="block text-sm font-bold">البريد الإلكتروني<input type="email" dir="ltr" disabled={editing.email.trim().toLowerCase() === protectedPlatformAdminEmail} className={`${fieldClass} mt-1 disabled:cursor-not-allowed disabled:opacity-60`} value={editEmail} onChange={e => setEditEmail(e.target.value)} /></label><label className="block text-sm font-bold">الدور<select disabled={editing.email.trim().toLowerCase() === protectedPlatformAdminEmail} className={`${fieldClass} mt-1 disabled:cursor-not-allowed disabled:opacity-60`} value={editRole} onChange={e => { const next = e.target.value as PlatformRole; setEditRole(next); if (useRolePermissions) setEditPermissions(rolePermissions[next] || []); }}>{roles.map(item => <option key={item} value={item}>{roleLabel[item]}</option>)}</select></label><label className="block text-sm font-bold">الحالة<select disabled={editing.email.trim().toLowerCase() === protectedPlatformAdminEmail} className={`${fieldClass} mt-1 disabled:cursor-not-allowed disabled:opacity-60`} value={editStatus} onChange={e => setEditStatus(e.target.value as typeof editStatus)}><option value="active">نشط</option><option value="disabled">معطّل</option></select></label></div><label className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold dark:bg-slate-800"><input type="checkbox" checked={!useRolePermissions} onChange={e => { setUseRolePermissions(!e.target.checked); if (e.target.checked) setEditPermissions(rolePermissions[editRole] || []); }} className="h-4 w-4 accent-amber-600" />تخصيص صلاحيات هذا الحساب</label>{!useRolePermissions && <div className="mt-3">{permissionEditor(editPermissions, setEditPermissions)}</div>}<div className="mt-5 flex gap-2"><PlatformButton disabled={saving || editName.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(editEmail)} onClick={() => void saveEdit()}>{saving ? "جارٍ الحفظ…" : "حفظ التعديل"}</PlatformButton><PlatformButton variant="secondary" disabled={saving} onClick={() => setEditing(null)}>إلغاء</PlatformButton></div></div></div>}
    {formOpen && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4"><div className="mx-auto mt-16 max-w-lg rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"><h2 className="font-black">إضافة مشرف للمنصة</h2><div className="mt-4 space-y-3"><input className={fieldClass} value={name} onChange={e => setName(e.target.value)} placeholder="الاسم" /><input type="email" className={fieldClass} value={email} onChange={e => setEmail(e.target.value)} placeholder="البريد الإلكتروني" /><input type="password" className={fieldClass} value={password} onChange={e => setPassword(e.target.value)} placeholder="كلمة مرور مؤقتة — 12 حرفًا على الأقل" /><select className={fieldClass} value={role} onChange={e => setRole(e.target.value as PlatformRole)}>{roles.map(item => <option key={item} value={item}>{roleLabel[item]}</option>)}</select></div><div className="mt-5 flex gap-2"><PlatformButton disabled={saving || name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12} onClick={() => void create()}>{saving ? "جارٍ الإنشاء…" : "إنشاء الحساب"}</PlatformButton><PlatformButton variant="secondary" onClick={() => setFormOpen(false)}>إلغاء</PlatformButton></div></div></div>}</section>;
}

type DataProps = ReturnType<typeof useManagementData> & { navigate: (path: string) => void };
