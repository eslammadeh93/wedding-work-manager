import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { PlatformBadge } from "../../shared/PlatformBadge";
import { PlatformSection } from "../../shared/PlatformSection";
import type { DeveloperActionRecord } from "./developerToolsTypes";

const columns: readonly DataTableColumn<DeveloperActionRecord>[] = [
  { key: "tool", header: "الأداة", render: (row) => <span className="font-bold">{row.toolName}</span> },
  { key: "time", header: "وقت التشغيل", render: (row) => new Date(row.startedAt).toLocaleString("ar-EG") },
  { key: "risk", header: "الخطورة", render: (row) => row.risk === "critical" ? "حرج" : "منخفض" },
  { key: "status", header: "الحالة", render: (row) => <PlatformBadge className={row.status === "success" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : row.status === "error" ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}>{row.status}</PlatformBadge> },
  { key: "runId", header: "runId", render: (row) => <code dir="ltr" className="text-xs">{row.runId}</code> },
  { key: "result", header: "النتيجة", render: (row) => row.result ? `${row.result.processed} processed · ${row.result.pages} pages` : row.error || "جارٍ التنفيذ" },
];

export function RecentDeveloperActions({ actions }: { actions: DeveloperActionRecord[] }) {
  return (
    <PlatformSection className="mt-8 w-full min-w-0 max-w-full scroll-mt-6">
      <div className="mb-4">
        <h2 className="text-lg font-black">Recent Developer Actions</h2>
        <p className="mt-1 text-xs text-slate-500">محفوظ محليًا مؤقتًا، وبنية السجل جاهزة للربط لاحقًا مع platformAuditLogs.</p>
      </div>
      {actions.length ? <DataTable rows={actions} columns={columns} rowKey={(row) => row.id} minWidthClass="min-w-[850px]" /> : <p className="py-6 text-center text-sm text-slate-500">لا توجد عمليات مسجلة بعد.</p>}
    </PlatformSection>
  );
}
