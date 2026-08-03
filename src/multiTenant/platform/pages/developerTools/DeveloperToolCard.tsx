import { CheckCircle2, Clipboard, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { PlatformBadge } from "../../shared/PlatformBadge";
import { PlatformButton } from "../../shared/PlatformButton";
import { PlatformCard } from "../../shared/PlatformCard";
import type { DeveloperActionRecord, DeveloperToolExecutionState, DeveloperToolRisk } from "./developerToolsTypes";

const riskLabels: Record<DeveloperToolRisk, string> = { low: "Low Risk", critical: "High Risk" };

export function DeveloperToolCard({
  title,
  description,
  risk,
  actionLabel,
  state,
  lastAction,
  disabled,
  onExecute,
}: {
  title: string;
  description: string;
  risk: DeveloperToolRisk;
  actionLabel: string;
  state: DeveloperToolExecutionState;
  lastAction?: DeveloperActionRecord;
  disabled: boolean;
  onExecute: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const report = state.result || lastAction?.result || null;
  const copyReport = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const progressWidth = state.running ? Math.min(90, 12 + state.progress.pages * 18) : report ? 100 : 0;

  return (
    <PlatformCard className={`relative flex h-full flex-col gap-4 overflow-hidden border-2 p-5 ${risk === "critical" ? "!border-rose-300 bg-gradient-to-br from-white to-rose-50/80 dark:!border-rose-800 dark:from-slate-900 dark:to-rose-950/30" : "!border-emerald-300 bg-gradient-to-br from-white to-emerald-50/80 dark:!border-emerald-800 dark:from-slate-900 dark:to-emerald-950/30"}`}>
      <span aria-hidden="true" className={`absolute inset-y-0 right-0 w-1.5 ${risk === "critical" ? "bg-rose-500" : "bg-emerald-500"}`} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <PlatformBadge className={risk === "critical" ? "border border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300" : "border border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"}>
          {risk === "critical" ? <TriangleAlert size={14} /> : <ShieldCheck size={14} />}
          {riskLabels[risk]}
        </PlatformBadge>
      </div>

      <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
        <p><strong className="text-slate-700 dark:text-slate-200">آخر تشغيل: </strong>{lastAction ? new Date(lastAction.startedAt).toLocaleString("ar-EG") : "لم تُشغّل بعد"}</p>
        <p><strong className="text-slate-700 dark:text-slate-200">آخر نتيجة: </strong>{lastAction?.status || "—"}</p>
      </div>

      {(state.running || state.progress.pages > 0) && (
        <div aria-live="polite">
          <div className="mb-1 flex justify-between text-xs"><span>Progress</span><span>{state.progress.pages} pages · {state.progress.processed} processed</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-full bg-amber-500 transition-all" style={{ width: `${progressWidth}%` }} /></div>
        </div>
      )}

      {state.success && <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle2 size={17} />{state.success}</p>}
      {state.error && <p role="alert" className="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"><TriangleAlert size={17} />{state.error}</p>}

      {report && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["processed", "companies", "members", "orders", "estimatedReads", "pages"] as const).map((key) => <div key={key} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800"><p className="text-[11px] text-slate-500">{key}</p><p className="font-black">{report[key]}</p></div>)}
          </div>
          <p className="text-sm"><strong>complete: </strong>{String(report.complete)}</p>
          <p className="text-sm"><strong>warnings: </strong>{report.warnings.length ? report.warnings.join("، ") : "لا توجد"}</p>
          <p className="break-words text-sm"><strong>fieldsUpdated: </strong>{report.fieldsUpdated.length ? report.fieldsUpdated.join(", ") : "لا توجد"}</p>
          <PlatformButton variant="secondary" onClick={() => void copyReport()}><Clipboard size={16} />{copied ? "تم النسخ" : "نسخ التقرير"}</PlatformButton>
        </div>
      )}

      <div className="mt-auto">
        <PlatformButton variant={risk === "critical" ? "danger" : "primary"} disabled={disabled || state.running} onClick={onExecute}>
          {state.running ? <><Loader2 size={17} className="animate-spin" />جارٍ التنفيذ…</> : actionLabel}
        </PlatformButton>
      </div>
    </PlatformCard>
  );
}
