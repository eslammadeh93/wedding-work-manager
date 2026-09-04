import { useEffect, useState, type FormEvent } from "react";
import {
  Crown,
  Mail,
  Pencil,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  companyManagementService,
  PlatformProvisioningUnavailableError,
} from "./companyManagementService";
import { listPlatformPlans, type PlatformPlan } from "./platformConsoleService";
import {
  daysUntil,
  formatPlatformDate,
  listPlatformCompanies,
  listPlatformCompanyMembers,
  platformDateInputValue,
} from "./platformService";
import type {
  CreateAdditionalCompanyOwnerRequest,
  CreateCompanyRequest,
  PlatformCompany,
  PlatformCompanyMember,
  UpdateCompanyRequest,
} from "./types";
import { PlatformLayout } from "./PlatformLayout";
import { platformRouteForPath } from "./routes";
import { PlatformPermissionGuard } from "./permissions/PlatformPermissionGuard";
import { PlatformPageHeader } from "./shared/PlatformPageHeader";
import { LoadingState } from "./shared/LoadingState";
import { EmptyState } from "./shared/EmptyState";
import { ErrorState } from "./shared/ErrorState";
import { DataTable, type DataTableColumn } from "./shared/DataTable";
import { FilterBar } from "./shared/FilterBar";
import { Pagination } from "./shared/Pagination";
import { PlatformButton } from "./shared/PlatformButton";
import { PlatformDashboard } from "./pages/dashboard/PlatformDashboard";
import { DeveloperToolsPage } from "./pages/developerTools/DeveloperToolsPage";
import {
  PlatformManagementPages,
  type ManagementPageId,
} from "./pages/management/PlatformManagementPages";

type View = "overview" | "companies" | "detail" | "developerTools" | "placeholder";
const statusLabel: Record<string, string> = {
  active: "نشطة",
  trial: "تجريبية",
  past_due: "متأخرة",
  expired: "منتهية",
  suspended: "موقوفة",
};
const statusClass: Record<string, string> = {
  active:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  trial: "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-white",
  past_due: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-100",
  expired: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-white",
  suspended:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-100",
};
const fieldClass =
  "w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/25";

function usePlatformCompanies(enabled: boolean) {
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = async () => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      setCompanies(await listPlatformCompanies());
    } catch {
      setError("تعذر تحميل بيانات الشركات. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (enabled) void reload(); else setLoading(false);
  }, [enabled]);
  return { companies, loading, error, reload };
}

function Status({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass[status] || "bg-slate-100 text-slate-700"}`}
    >
      {statusLabel[status] || status}
    </span>
  );
}

function CreateCompanyForm({ close, onCreated }: { close: () => void; onCreated: () => Promise<void> }) {
  const [data, setData] = useState<CreateCompanyRequest>({
    companyName: "",
    slug: "",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
    planId: "",
    plan: "",
    subscriptionStart: "",
    subscriptionEnd: "",
    maxUsers: null,
    features: [],
    status: "trial",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const availablePlans = await listPlatformPlans();
        setPlans(availablePlans);
        setData((current) => {
          if (current.planId || !availablePlans.length) return current;
          const firstPlan = availablePlans[0];
          return { ...current, planId: firstPlan.id, plan: firstPlan.name, maxUsers: firstPlan.maxUsers };
        });
      } catch {
        setPlansError("تعذر تحميل الباقات. حاول تحديث الصفحة.");
      } finally {
        setPlansLoading(false);
      }
    })();
  }, []);
  const update = (key: keyof CreateCompanyRequest, value: string | number | null) =>
    setData((previous) => ({ ...previous, [key]: value }));
  const selectPlan = (planId: string) => {
    const plan = plans.find((item) => item.id === planId);
    if (!plan) return;
    setData((current) => ({ ...current, planId: plan.id, plan: plan.name, maxUsers: plan.maxUsers }));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!data.companyName.trim()) next.companyName = "اسم الشركة مطلوب.";
    if (!data.ownerName.trim()) next.ownerName = "اسم المالك مطلوب.";
    if (!/^\S+@\S+\.\S+$/.test(data.ownerEmail))
      next.ownerEmail = "أدخل بريدًا إلكترونيًا صالحًا.";
    if (data.ownerPassword.length < 12)
      next.ownerPassword = "كلمة مرور المالك يجب أن تكون 12 حرفاً على الأقل.";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug))
      next.slug = "استخدم حروفًا إنجليزية صغيرة وأرقامًا وشرطة فقط.";
    if (!data.planId) next.plan = "اختر باقة للشركة.";
    if (
      !data.subscriptionStart ||
      !data.subscriptionEnd ||
      data.subscriptionEnd < data.subscriptionStart
    )
      next.subscriptionEnd = "تاريخ النهاية يجب ألا يسبق تاريخ البداية.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSubmitting(true);
    setMessage(null);
    try {
      await companyManagementService.createCompanyWithOwner(data);
      await onCreated();
      close();
    } catch (error) {
      setMessage(
        error instanceof PlatformProvisioningUnavailableError
          ? error.message
          : "تعذر إرسال الطلب.",
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {message && (
        <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["companyName", "اسم الشركة"],
            ["slug", "المعرّف slug"],
            ["ownerName", "اسم المالك"],
            ["ownerEmail", "بريد المالك"],
            ["ownerPassword", "كلمة مرور المالك"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-sm font-bold">
            {label}
            <input
              className={fieldClass}
              type={
                key === "ownerEmail"
                  ? "email"
                  : key === "ownerPassword"
                    ? "password"
                    : "text"
              }
              value={String(data[key])}
              onChange={(e) => update(key, e.target.value)}
            />
            {errors[key] && (
              <small className="text-rose-600">{errors[key]}</small>
            )}
          </label>
        ))}
        <label className="text-sm font-bold">
          الباقة
          <select
            className={fieldClass}
            value={data.planId}
            onChange={(e) => selectPlan(e.target.value)}
            disabled={plansLoading || !plans.length}
          >
            <option value="">{plansLoading ? "جارٍ تحميل الباقات…" : "اختر باقة"}</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.name}</option>
            ))}
          </select>
          {data.planId && <small className="mt-1 block text-xs font-normal text-slate-500">الحد: {data.maxUsers === null ? "غير محدود" : `${data.maxUsers} حساب`}</small>}
          {plansError && <small className="text-rose-600">{plansError}</small>}
          {errors.plan && <small className="text-rose-600">{errors.plan}</small>}
        </label>
        <label className="text-sm font-bold">
          الحالة
          <select
            className={fieldClass}
            value={data.status}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="trial">تجريبية</option>
            <option value="active">نشطة</option>
          </select>
        </label>
        <label className="text-sm font-bold">
          بداية الاشتراك
          <input
            className={fieldClass}
            type="date"
            value={data.subscriptionStart}
            onChange={(e) => update("subscriptionStart", e.target.value)}
          />
        </label>
        <label className="text-sm font-bold">
          نهاية الاشتراك
          <input
            className={fieldClass}
            type="date"
            value={data.subscriptionEnd}
            onChange={(e) => update("subscriptionEnd", e.target.value)}
          />
          {errors.subscriptionEnd && (
            <small className="text-rose-600">{errors.subscriptionEnd}</small>
          )}
        </label>
      </div>
      <p className="text-xs text-slate-500">
        سيتم توليد رمز شركة رقمي فريد من 6 أرقام تلقائيًا.
      </p>
      <div className="flex gap-2">
        <button
          disabled={submitting}
          className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {submitting ? "جارٍ الإرسال…" : "إرسال طلب الإنشاء"}
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded-xl border px-4 py-2 text-sm"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}

export function PlatformModule() {
  const { authSession, logout } = useAuth();
  const platformRole = authSession?.role;
  const hasPlatformPermission = (permission: string) => authSession?.userType === "platform" && authSession.permissions.includes(permission);
  const canCreateCompanies = hasPlatformPermission("platform:companies:create");
  const canUpdateCompanies = hasPlatformPermission("platform:companies:update");
  const canAddCompanyOwners = platformRole === "platform_owner";
  const canDeleteCompanies = platformRole === "platform_owner";
  const [path, setPath] = useState(() => window.location.pathname.startsWith("/platform") ? `${window.location.pathname}${window.location.search}` : "/platform");
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const go = (target: string) => {
    setPath(target);
    window.history.pushState({}, "", target);
    setMenu(false);
  };
  useEffect(() => {
    const syncPath = () => setPath(`${window.location.pathname}${window.location.search}`);
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);
  const cleanPath = path.split("?")[0];
  const view: View =
    cleanPath === "/platform/companies"
      ? "companies"
      : cleanPath.startsWith("/platform/companies/")
        ? "detail"
        : cleanPath === "/platform"
          ? "overview"
          : cleanPath === "/platform/developer-tools"
            ? "developerTools"
          : "placeholder";
  const companyId =
    view === "detail" ? decodeURIComponent(cleanPath.split("/").pop() || "") : "";
  const managementPage: ManagementPageId | null = (
    ["users", "subscriptions", "plans", "analytics", "notifications", "activity", "support", "settings", "admins"] as const
  ).find((id) => cleanPath === `/platform/${id}`) || null;
  const { companies, loading, error, reload } = usePlatformCompanies(view === "companies" || view === "detail");
  const selected = companies.find((company) => company.id === companyId);
  const route = platformRouteForPath(cleanPath);
  const companyView = view === "companies" || view === "detail";
  return (
    <PlatformLayout
      currentPath={path}
      displayName={authSession?.displayName || "صاحب المنصة"}
      role={String(authSession?.role || "platform_owner")}
      permissions={authSession?.permissions || []}
      menuOpen={menu}
      onMenuOpen={() => setMenu(true)}
      onMenuClose={() => setMenu(false)}
      onNavigate={go}
      onLogout={() => void logout()}
    >
      {route ? (
        <PlatformPermissionGuard
          permission={route.permission}
          fallback={<ErrorState message="لا تملك صلاحية فتح هذا القسم." />}
        >
          {companyView && error ? (
            <ErrorState message={error} onRetry={() => void reload()} />
          ) : companyView && loading ? (
            <LoadingState text="جارٍ تحميل بيانات المنصة…" />
          ) : (
            <>
              {view === "overview" && (
                <PlatformDashboard navigate={go} createCompany={canCreateCompanies ? () => setCreating(true) : undefined} />
              )}
              {view === "companies" && (
                <Companies
                  companies={companies}
                  go={go}
                  canCreate={canCreateCompanies}
                  canUpdate={canUpdateCompanies}
                  canDelete={canDeleteCompanies}
                  openCreate={() => setCreating(true)}
                  initialStatus={new URLSearchParams(path.split("?")[1] || "").get("status") || ""}
                />
              )}
              {view === "detail" && (
                <CompanyDetail
                  company={selected}
                  back={() => go("/platform/companies")}
                  canUpdate={canUpdateCompanies}
                  canAddOwner={canAddCompanyOwners}
                />
              )}
              {view === "developerTools" && <DeveloperToolsPage />}
              {managementPage && (
                <PlatformManagementPages page={managementPage} navigate={go} />
              )}
              {view === "placeholder" && !managementPage && (
                <section>
                  <PlatformPageHeader title={route.label} />
                  <EmptyState text={`${route.label} — قريبًا`} />
                </section>
              )}
            </>
          )}
        </PlatformPermissionGuard>
      ) : (
        <ErrorState message="المسار المطلوب غير موجود." />
      )}
      {creating && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/40 p-4">
          <div className="mx-auto mt-8 max-w-2xl rounded-2xl bg-slate-50 p-5 shadow-xl dark:bg-slate-950">
            <div className="mb-4 flex justify-between">
              <h2 className="font-black">إنشاء شركة</h2>
              <button onClick={() => setCreating(false)}>
                <X />
              </button>
            </div>
            <CreateCompanyForm close={() => setCreating(false)} onCreated={async () => { await reload(); }} />
          </div>
        </div>
      )}
    </PlatformLayout>
  );
}

function companyUpdateInitial(company: PlatformCompany): UpdateCompanyRequest {
  return {
    companyId: company.id,
    name: company.name,
    slug: company.slug,
    companyCode: company.companyCode || "",
    ownerName: company.ownerName || "",
    ownerEmail: company.ownerEmail || "",
    plan: company.plan,
    status: company.status,
    subscriptionStart: platformDateInputValue(company.subscriptionStart),
    subscriptionEnd: platformDateInputValue(company.subscriptionEnd),
    maxUsers: company.maxUsers,
    features: company.features || [],
  };
}

function Companies({
  companies,
  go,
  openCreate,
  canCreate,
  canUpdate,
  canDelete,
  initialStatus,
}: {
  companies: PlatformCompany[];
  go: (path: string) => void;
  openCreate: () => void;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  initialStatus: string;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus === "expiring" ? "" : initialStatus);
  const [plan, setPlan] = useState("");
  const [sort, setSort] = useState("name");
  const [localCompanies, setLocalCompanies] = useState(companies);
  const [editing, setEditing] = useState<PlatformCompany | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  useEffect(() => setLocalCompanies(companies), [companies]);
  const filtered = localCompanies
    .filter(
      (c) =>
        (!search ||
          [c.name, c.companyCode, c.slug].some((v) =>
            v?.toLowerCase().includes(search.toLowerCase()),
          )) &&
        (!status || c.status === status) &&
        (initialStatus !== "expiring" || (() => { const days = daysUntil(c.subscriptionEnd); return days !== null && days >= 0 && days <= 30; })()) &&
        (!plan || c.plan === plan),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : String(
            sort === "createdAt" ? b.createdAt : b.subscriptionEnd,
          ).localeCompare(
            String(sort === "createdAt" ? a.createdAt : a.subscriptionEnd),
          ),
    );
  useEffect(() => setPage(1), [search, status, plan, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedCompanies = filtered.slice((page - 1) * pageSize, page * pageSize);
  const save = async (next: UpdateCompanyRequest) => {
    setSaving(true);
    setEditError("");
    try {
      await companyManagementService.updateCompany(next);
      setLocalCompanies((current) =>
        current.map((company) =>
          company.id === next.companyId ? { ...company, ...next } : company,
        ),
      );
      setEditing(null);
      setMessage("تم تحديث الشركة بنجاح.");
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "تعذر تحديث الشركة.",
      );
    } finally {
      setSaving(false);
    }
  };
  const deleteCompany = async (company: PlatformCompany) => {
    const confirmation = window.prompt(`حذف نهائي: اكتب اسم الشركة «${company.name}» للتأكيد. سيُحذف كل ما يخصها ولا يمكن التراجع.`);
    if (confirmation === null) return;
    if (confirmation !== company.name) {
      setDeleteError("اسم الشركة غير مطابق، لم يتم الحذف.");
      return;
    }
    setDeletingId(company.id);
    setDeleteError("");
    try {
      await companyManagementService.deleteCompany({ companyId: company.id, confirmation });
      setLocalCompanies((current) => current.filter((item) => item.id !== company.id));
      setMessage("تم حذف الشركة وكل حساباتها وبياناتها نهائيًا.");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "تعذر حذف الشركة.");
    } finally {
      setDeletingId(null);
    }
  };
  const columns: readonly DataTableColumn<PlatformCompany>[] = [
    {
      key: "company",
      header: "الشركة",
      className: "font-bold",
      render: (company) => (
        <button
          onClick={() => go(`/platform/companies/${company.id}`)}
          className="text-right text-amber-700 hover:underline"
        >
          {company.name}
        </button>
      ),
    },
    {
      key: "identity",
      header: "الرمز / slug",
      render: (company) => (
        <>
          {company.companyCode}
          <br />
          <small>{company.slug}</small>
        </>
      ),
    },
    { key: "plan", header: "الباقة", render: (company) => company.plan },
    {
      key: "status",
      header: "الحالة",
      render: (company) => <Status status={company.status} />,
    },
    {
      key: "start",
      header: "البداية",
      render: (company) => formatPlatformDate(company.subscriptionStart),
    },
    {
      key: "end",
      header: "النهاية",
      render: (company) => formatPlatformDate(company.subscriptionEnd),
    },
    {
      key: "maxUsers",
      header: "الموظفون",
      render: (company) => company.maxUsers === null ? "غير محدود" : company.maxUsers,
    },
    {
      key: "members",
      header: "الأعضاء",
      render: (company) => company.memberCount ?? "غير متاح",
    },
    {
      key: "created",
      header: "الإنشاء",
      render: (company) => formatPlatformDate(company.createdAt),
    },
    {
      key: "actions",
      header: "الإجراءات",
      render: (company) => (
        <div className="flex gap-3">
          {canUpdate && <button
            onClick={() => {
              setEditing(company);
              setEditError("");
            }}
            className="flex items-center gap-1 font-bold text-amber-700"
          >
            <Pencil size={14} />
            تعديل
          </button>}
          {canDelete && <button
            disabled={deletingId === company.id}
            onClick={() => void deleteCompany(company)}
            className="flex items-center gap-1 font-bold text-rose-700 disabled:opacity-50"
          >
            <Trash2 size={14} />
            {deletingId === company.id ? "جارٍ الحذف…" : "حذف نهائي"}
          </button>}
          <button
            onClick={() => go(`/platform/companies/${company.id}`)}
            className="text-slate-600"
          >
            تفاصيل
          </button>
        </div>
      ),
    },
  ];
  return (
    <section>
      <PlatformPageHeader
        title="الشركات"
        actions={
          canCreate ? <PlatformButton onClick={openCreate}>إنشاء شركة</PlatformButton> : undefined
        }
      />
      {message && (
        <p className="mb-4 rounded-xl bg-emerald-100 p-3 text-emerald-800">
          {message}
        </p>
      )}
      {deleteError && <p className="mb-4 rounded-xl bg-rose-100 p-3 text-rose-800">{deleteError}</p>}
      <FilterBar>
        <input
          className={fieldClass}
          placeholder="بحث بالاسم أو الرمز أو slug"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={fieldClass}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">كل الحالات</option>
          {Object.entries(statusLabel).map(([key, value]) => (
            <option key={key} value={key}>
              {value}
            </option>
          ))}
        </select>
        <select
          className={fieldClass}
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
        >
          <option value="">كل الباقات</option>
          {[...new Set(localCompanies.map((c) => c.plan))].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          className={fieldClass}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="name">الاسم</option>
          <option value="createdAt">تاريخ الإنشاء</option>
          <option value="subscriptionEnd">نهاية الاشتراك</option>
        </select>
      </FilterBar>
      {filtered.length === 0 ? (
        <EmptyState text="لا توجد شركات مطابقة." />
      ) : (
        <>
          <DataTable
            rows={pagedCompanies}
            columns={columns}
            rowKey={(company) => company.id}
          />
          <Pagination
            page={page}
            pageCount={pageCount}
            onPageChange={setPage}
          />
        </>
      )}
      {editing && (
        <CompanyEditModal
          company={editing}
          initial={companyUpdateInitial(editing)}
          saving={saving}
          error={editError}
          close={() => !saving && setEditing(null)}
          save={save}
        />
      )}
    </section>
  );
}
function CompanyDetail({
  company,
  back,
  canUpdate,
  canAddOwner,
}: {
  company?: PlatformCompany;
  back: () => void;
  canUpdate: boolean;
  canAddOwner: boolean;
}) {
  const [current, setCurrent] = useState(company);
  const [editing, setEditing] = useState(false);
  const [addingOwner, setAddingOwner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"details" | "accounts">("details");
  const [members, setMembers] = useState<PlatformCompanyMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  useEffect(() => setCurrent(company), [company]);
  const loadMembers = async () => {
    if (!company?.id) return;
    setMembersLoading(true);
    setMembersError("");
    try {
      setMembers(await listPlatformCompanyMembers(company.id));
    } catch {
      setMembersError(
        "تعذر تحميل حسابات الشركة. تأكد من نشر قواعد Firestore الجديدة.",
      );
    } finally {
      setMembersLoading(false);
    }
  };
  useEffect(() => {
    if (tab === "accounts") void loadMembers();
  }, [tab, company?.id]);
  if (!current)
    return (
      <section>
        <button onClick={back} className="mb-4 text-amber-700">
          العودة للشركات
        </button>
        <EmptyState text="لم يتم العثور على الشركة المطلوبة." />
      </section>
    );
  const value = (input: unknown) =>
    input === undefined || input === null || input === ""
      ? "غير متوفر"
      : String(input);
  const items: [string, unknown][] = [
    ["رمز الشركة", current.companyCode],
    ["Slug", current.slug],
    ["اسم المالك", current.ownerName],
    ["بريد المالك", current.ownerEmail],
    ["الباقة", current.plan],
    ["الحالة", current.status],
    ["بداية الاشتراك", formatPlatformDate(current.subscriptionStart)],
    ["نهاية الاشتراك", formatPlatformDate(current.subscriptionEnd)],
    ["الموظفون", current.maxUsers === null ? "غير محدود" : current.maxUsers],
    ["عدد الأعضاء", current.memberCount ?? "غير متوفر"],
    ["تاريخ الإنشاء", formatPlatformDate(current.createdAt)],
    ["أنشأ بواسطة", current.createdBy || "غير متوفر"],
    ["المزايا", current.features?.join("، ") || "غير متوفر"],
  ];
  const initial = companyUpdateInitial(current);
  return (
    <section>
      <button onClick={back} className="mb-4 text-amber-700">
        العودة للشركات
      </button>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black">{current.name}</h1>
        <div className="flex flex-wrap gap-2">
          {canAddOwner && <button
            onClick={() => {
              setAddingOwner(true);
              setError("");
            }}
            className="flex items-center gap-2 rounded-xl border border-amber-600 px-4 py-2 text-sm font-bold text-amber-700"
          >
            <Crown size={16} />
            إضافة شريك كصاحب مشروع
          </button>}
          {canUpdate && <button
            onClick={() => {
              setEditing(true);
              setError("");
            }}
            className="flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white"
          >
            <Pencil size={16} />
            تعديل كل بيانات الشركة
          </button>}
        </div>
      </div>
      {message && (
        <p className="mb-4 rounded-xl bg-emerald-100 p-3 text-emerald-800">
          {message}
        </p>
      )}
      <div className="mb-5 flex gap-2 rounded-2xl bg-slate-200/70 p-1.5 dark:bg-slate-900">
        <button
          onClick={() => setTab("details")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold ${tab === "details" ? "bg-white text-amber-700 shadow-sm dark:bg-slate-800" : "text-slate-500"}`}
        >
          <Pencil size={16} />
          البيانات الأساسية
        </button>
        <button
          onClick={() => setTab("accounts")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold ${tab === "accounts" ? "bg-white text-amber-700 shadow-sm dark:bg-slate-800" : "text-slate-500"}`}
        >
          <Users size={16} />
          حسابات وإيميلات الشركة
        </button>
      </div>
      {tab === "details" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map(([label, item]) => (
            <div
              key={label}
              className="rounded-xl bg-white p-4 shadow-sm dark:bg-slate-900"
            >
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 font-bold">
                {label === "الحالة" ? (
                  <Status status={String(item)} />
                ) : (
                  value(item)
                )}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
          {membersLoading ? (
            <LoadingState />
          ) : membersError ? (
            <div className="rounded-xl bg-rose-50 p-4 text-rose-700">
              {membersError}
              <button
                onClick={() => void loadMembers()}
                className="mr-3 underline"
              >
                إعادة المحاولة
              </button>
            </div>
          ) : members.length === 0 ? (
            <EmptyState text="لا توجد حسابات مسجلة لهذه الشركة." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-right text-sm">
                <thead className="bg-slate-100 text-xs dark:bg-slate-800">
                  <tr>
                    <th className="p-3">الاسم</th>
                    <th className="p-3">البريد الإلكتروني</th>
                    <th className="p-3">الصلاحية</th>
                    <th className="p-3">الحالة</th>
                    <th className="p-3">الهاتف</th>
                    <th className="p-3">تاريخ الإنشاء</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr
                      key={member.uid}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="p-3 font-bold">{member.name || "—"}</td>
                      <td className="p-3">
                        <span className="flex items-center gap-2" dir="ltr">
                          <Mail size={15} className="text-amber-600" />
                          {member.email || "بدون بريد (عامل)"}
                        </span>
                      </td>
                      <td className="p-3">{member.role}</td>
                      <td className="p-3">{member.status}</td>
                      <td className="p-3" dir="ltr">
                        {member.phone || "—"}
                      </td>
                      <td className="p-3">
                        {formatPlatformDate(member.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {editing && (
        <CompanyEditModal
          company={current}
          initial={initial}
          saving={saving}
          error={error}
          close={() => !saving && setEditing(false)}
          save={async (next) => {
            setSaving(true);
            setError("");
            try {
              await companyManagementService.updateCompany(next);
              setCurrent({ ...current, ...next });
              setMessage("تم تحديث الشركة بنجاح.");
              setEditing(false);
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "تعذر تحديث الشركة.",
              );
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {addingOwner && (
        <AdditionalOwnerModal
          companyId={current.id}
          close={() => setAddingOwner(false)}
          saved={() => {
            setAddingOwner(false);
            setMessage("تم إنشاء حساب الشريك بصلاحية صاحب المشروع.");
            setCurrent({
              ...current,
              memberCount: (current.memberCount || 0) + 1,
            });
            if (tab === "accounts") void loadMembers();
          }}
        />
      )}
    </section>
  );
}

function AdditionalOwnerModal({
  companyId,
  close,
  saved,
}: {
  companyId: string;
  close: () => void;
  saved: () => void;
}) {
  const [form, setForm] = useState<CreateAdditionalCompanyOwnerRequest>({
    companyId,
    name: "",
    email: "",
    temporaryPassword: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (
      form.name.trim().length < 2 ||
      !/^\S+@\S+\.\S+$/.test(form.email) ||
      form.temporaryPassword.length < 12
    ) {
      setError("أدخل الاسم والبريد وكلمة مرور مؤقتة من 12 حرفًا على الأقل.");
      return;
    }
    setSaving(true);
    try {
      await companyManagementService.createAdditionalOwner(form);
      saved();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "تعذر إنشاء حساب الشريك.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/50 p-4">
      <form
        onSubmit={submit}
        className="mx-auto mt-16 max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"
      >
        <div className="flex justify-between">
          <div>
            <h2 className="font-black">إضافة شريك كصاحب مشروع</h2>
            <p className="mt-1 text-xs text-slate-500">
              سيحصل الحساب على نفس صلاحية صاحب المشروع داخل هذه الشركة فقط.
            </p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </div>
        <label className="block text-sm font-bold">
          اسم الشريك
          <input
            className={fieldClass}
            value={form.name}
            onChange={(e) =>
              setForm((previous) => ({ ...previous, name: e.target.value }))
            }
            required
          />
        </label>
        <label className="block text-sm font-bold">
          البريد الإلكتروني
          <input
            type="email"
            className={fieldClass}
            value={form.email}
            onChange={(e) =>
              setForm((previous) => ({ ...previous, email: e.target.value }))
            }
            required
          />
        </label>
        <label className="block text-sm font-bold">
          كلمة مرور مؤقتة
          <input
            type="password"
            minLength={12}
            className={fieldClass}
            value={form.temporaryPassword}
            onChange={(e) =>
              setForm((previous) => ({
                ...previous,
                temporaryPassword: e.target.value,
              }))
            }
            required
          />
          <small className="font-normal text-slate-500">
            لا تُخزّن في Firestore ولا تظهر بعد الإنشاء.
          </small>
        </label>
        {error && (
          <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            disabled={saving}
            className="rounded-xl bg-amber-600 px-4 py-2 font-bold text-white disabled:opacity-50"
          >
            {saving ? "جارٍ الإنشاء…" : "إنشاء حساب الشريك"}
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded-xl border px-4 py-2"
          >
            إلغاء
          </button>
        </div>
      </form>
    </div>
  );
}

function CompanyEditModal({
  company,
  initial,
  saving,
  error,
  close,
  save,
}: {
  company: PlatformCompany;
  initial: UpdateCompanyRequest;
  saving: boolean;
  error: string;
  close: () => void;
  save: (data: UpdateCompanyRequest) => Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const update = <K extends keyof UpdateCompanyRequest>(
    key: K,
    value: UpdateCompanyRequest[K],
  ) => setForm((previous) => ({ ...previous, [key]: value }));
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(form);
        }}
        className="mx-auto mt-8 max-w-2xl space-y-3 rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"
      >
        <div className="flex justify-between">
          <h2 className="font-black">تعديل الشركة</h2>
          <button type="button" onClick={close}>
            <X />
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            اسم الشركة
            <input
              className={fieldClass}
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              required
            />
          </label>
          <label>
            Slug
            <input
              className={fieldClass}
              value={form.slug}
              onChange={(e) => update("slug", e.target.value.toLowerCase())}
              required
            />
          </label>
          <label className="font-bold text-amber-600">
            كود الشركة (6 أرقام)
            <input
              className={`${fieldClass} border-amber-500`}
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="100001"
              value={form.companyCode}
              onChange={(e) =>
                update(
                  "companyCode",
                  e.target.value.replace(/\D/g, "").slice(0, 6),
                )
              }
              required
            />
            <small className="mt-1 block text-xs font-normal text-slate-500">
              استبدل الكود القديم بكود رقمي فريد، مثل 100001.
            </small>
          </label>
          <label>
            اسم المالك
            <input
              className={fieldClass}
              value={form.ownerName}
              onChange={(e) => update("ownerName", e.target.value)}
              required
            />
          </label>
          <label>
            بريد المالك
            <input
              type="email"
              className={fieldClass}
              value={form.ownerEmail}
              onChange={(e) => update("ownerEmail", e.target.value)}
              required
            />
          </label>
          <label>
            الباقة
            <input className={`${fieldClass} cursor-not-allowed opacity-70`} value={form.plan} disabled />
            <small className="mt-1 block text-xs text-slate-500">يتم تغيير الباقة وحد الموظفين من صفحة الاشتراكات.</small>
          </label>
          <label>
            الحالة
            <select
              className={fieldClass}
              value={form.status}
              onChange={(e) =>
                update(
                  "status",
                  e.target.value as UpdateCompanyRequest["status"],
                )
              }
            >
              {Object.keys(statusLabel).map((status) => (
                <option key={status} value={status}>
                  {statusLabel[status]}
                </option>
              ))}
            </select>
          </label>
          <label>
            تاريخ البداية
            <input
              type="date"
              className={fieldClass}
              value={form.subscriptionStart}
              onChange={(e) => update("subscriptionStart", e.target.value)}
              required
            />
          </label>
          <label>
            تاريخ النهاية
            <input
              type="date"
              className={fieldClass}
              value={form.subscriptionEnd}
              onChange={(e) => update("subscriptionEnd", e.target.value)}
              required
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          تعديل بريد المالك هنا يحدّث بيانات الشركة المعروضة فقط، ولا يغيّر حساب
          Firebase Auth.
        </p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          disabled={saving}
          className="rounded-xl bg-amber-600 px-4 py-2 font-bold text-white"
        >
          {saving ? "جارٍ الحفظ…" : "حفظ التعديلات"}
        </button>
      </form>
    </div>
  );
}
