import { Construction, LockKeyhole } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { ConfirmDialog } from "../../shared/ConfirmDialog";
import { PlatformBadge } from "../../shared/PlatformBadge";
import { PlatformCard } from "../../shared/PlatformCard";
import { PlatformPageHeader } from "../../shared/PlatformPageHeader";
import { createDeveloperRunId, executeDashboardAggregateTool } from "./developerToolsService";
import { loadDeveloperActions, rememberSuccessfulRunId, saveDeveloperAction, wasRunIdSuccessful } from "./developerActionsStorage";
import { DeveloperToolCard } from "./DeveloperToolCard";
import { RecentDeveloperActions } from "./RecentDeveloperActions";
import type { DeveloperActionRecord, DeveloperToolExecutionState, DeveloperToolId, DeveloperToolRisk } from "./developerToolsTypes";

const REQUIRED_CONFIRMATION = "REBUILD PRODUCTION";
const emptyState = (): DeveloperToolExecutionState => ({ running: false, progress: { processed: 0, pages: 0 }, result: null, error: "", success: "" });
const futureTools = [
  { title: "Health Check", description: "فحص سلامة خدمات المنصة وCloud Functions." },
  { title: "Database Statistics", description: "عرض إحصاءات قاعدة البيانات." },
  { title: "Verify Firestore Integrity", description: "التحقق من سلامة البيانات واكتشاف التناقضات." },
  { title: "Refresh Dashboard Cache", description: "تحديث بيانات Dashboard المؤقتة." },
  { title: "Repair Aggregates", description: "إعادة إصلاح بيانات التجميع عند الحاجة." },
  { title: "Test Notifications", description: "إرسال إشعار تجريبي." },
  { title: "Test Email", description: "إرسال بريد إلكتروني تجريبي." },
  { title: "Test WhatsApp", description: "إرسال رسالة واتساب تجريبية." },
  { title: "Background Jobs", description: "إدارة ومراقبة المهام الخلفية." },
  { title: "Storage Cleanup", description: "تنظيف الملفات المؤقتة." },
  { title: "Recalculate Company Counters", description: "إعادة احتساب مؤشرات وأعداد الشركات." },
  { title: "View Cloud Function Status", description: "متابعة حالة Cloud Functions وتشغيلها." },
  { title: "Backup & Restore", description: "إدارة النسخ الاحتياطية واستعادة البيانات." },
] as const;

export function DeveloperToolsPage() {
  const { authSession } = useAuth();
  const [actions, setActions] = useState<DeveloperActionRecord[]>(loadDeveloperActions);
  const [states, setStates] = useState<Record<DeveloperToolId, DeveloperToolExecutionState>>({
    "dashboard-dry-run": emptyState(),
    "dashboard-rebuild": emptyState(),
  });
  const [runningTool, setRunningTool] = useState<DeveloperToolId | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pendingRunId, setPendingRunId] = useState("");

  const lastActions = useMemo(() => ({
    "dashboard-dry-run": actions.find((action) => action.toolId === "dashboard-dry-run"),
    "dashboard-rebuild": actions.find((action) => action.toolId === "dashboard-rebuild"),
  }), [actions]);

  const updateState = (toolId: DeveloperToolId, patch: Partial<DeveloperToolExecutionState>) =>
    setStates((current) => ({ ...current, [toolId]: { ...current[toolId], ...patch } }));

  const execute = async ({ toolId, toolName, risk, dryRun, runId }: { toolId: DeveloperToolId; toolName: string; risk: DeveloperToolRisk; dryRun: boolean; runId: string }) => {
    if (runningTool) return;
    if (!dryRun && wasRunIdSuccessful(runId)) {
      updateState(toolId, { error: "تم استخدام runId بنجاح من قبل، ولن يُعاد استخدامه." });
      return;
    }
    const action: DeveloperActionRecord = {
      id: crypto.randomUUID(), toolId, toolName, risk, status: "running", actorUid: authSession?.uid || "unknown",
      runId, startedAt: new Date().toISOString(), finishedAt: null, result: null, error: null, auditTarget: "platformAuditLogs",
    };
    setActions(saveDeveloperAction(action));
    setRunningTool(toolId);
    updateState(toolId, { running: true, progress: { processed: 0, pages: 0 }, result: null, error: "", success: "" });
    try {
      const result = await executeDashboardAggregateTool({
        session: authSession,
        dryRun,
        runId,
        onProgress: (progress) => updateState(toolId, { progress }),
      });
      if (!dryRun) rememberSuccessfulRunId(runId);
      const completed: DeveloperActionRecord = { ...action, status: "success", finishedAt: new Date().toISOString(), result };
      setActions(saveDeveloperAction(completed));
      updateState(toolId, { running: false, result, success: dryRun ? "اكتمل Dashboard Dry Run بنجاح." : "اكتمل Dashboard Rebuild بنجاح." });
    } catch (caught) {
      const firebaseError = caught as { code?: unknown; message?: unknown };
      const message = `${String(firebaseError.code || "functions/unknown")}: ${String(firebaseError.message || "تعذر تنفيذ الأداة.")}`;
      const failed: DeveloperActionRecord = { ...action, status: "error", finishedAt: new Date().toISOString(), error: message };
      setActions(saveDeveloperAction(failed));
      updateState(toolId, { running: false, error: message });
    } finally {
      setRunningTool(null);
    }
  };

  const openRebuildConfirmation = () => {
    setPendingRunId(createDeveloperRunId("rebuild"));
    setConfirmation("");
    setConfirmOpen(true);
  };

  return (
    <section className="min-w-0 pb-8">
      <PlatformPageHeader title="Developer Tools" description="أدوات تشغيل وصيانة متقدمة لصاحب المنصة فقط. جميع العمليات تستخدم جلسة Firebase الحالية." actions={<PlatformBadge className="border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200"><LockKeyhole size={14} /> Platform Owner Only</PlatformBadge>} />
      <div className="grid gap-5 xl:grid-cols-2">
        <DeveloperToolCard
          title="Dashboard Dry Run"
          description="معاينة آمنة لحساب Aggregates دون كتابة أي بيانات."
          risk="low"
          actionLabel="تشغيل Dry Run"
          state={states["dashboard-dry-run"]}
          lastAction={lastActions["dashboard-dry-run"]}
          disabled={runningTool !== null}
          onExecute={() => void execute({ toolId: "dashboard-dry-run", toolName: "Dashboard Dry Run", risk: "low", dryRun: true, runId: createDeveloperRunId("dryrun") })}
        />
        <DeveloperToolCard
          title="Dashboard Rebuild"
          description="إعادة بناء Aggregates في Production. تتطلب تأكيدًا نصيًا صريحًا وتُسجل محليًا."
          risk="critical"
          actionLabel="بدء Rebuild"
          state={states["dashboard-rebuild"]}
          lastAction={lastActions["dashboard-rebuild"]}
          disabled={runningTool !== null}
          onExecute={openRebuildConfirmation}
        />
      </div>

      <div className="mt-7">
        <h2 className="mb-3 text-lg font-black">Coming Soon</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {futureTools.map((tool) => <PlatformCard key={tool.title} className="flex min-h-40 flex-col p-4 opacity-75"><div className="flex items-start justify-between gap-3"><div><h3 className="font-black">{tool.title}</h3><p className="mt-1.5 text-sm leading-6 text-slate-500">{tool.description}</p></div><Construction className="mt-0.5 shrink-0 text-slate-400" size={20} /></div><button type="button" disabled className="mt-auto w-fit rounded-xl border px-3 py-2 text-xs font-bold opacity-60">Coming Soon</button></PlatformCard>)}
        </div>
      </div>

      <RecentDeveloperActions actions={actions} />
      <ConfirmDialog
        open={confirmOpen}
        title="Dashboard Rebuild — Production"
        description={<div className="space-y-3"><p>هذه عملية كتابة حساسة. اكتب <strong dir="ltr">{REQUIRED_CONFIRMATION}</strong> للمتابعة.</p><input autoFocus autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={runningTool !== null} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950" dir="ltr" /><p className="break-all text-xs text-slate-500" dir="ltr">runId: {pendingRunId}</p></div>}
        confirmLabel="تنفيذ Rebuild"
        dangerous
        busy={runningTool === "dashboard-rebuild"}
        confirmDisabled={confirmation !== REQUIRED_CONFIRMATION || !pendingRunId}
        onClose={() => { if (!runningTool) setConfirmOpen(false); }}
        onConfirm={() => {
          if (confirmation !== REQUIRED_CONFIRMATION || !pendingRunId) return;
          setConfirmOpen(false);
          void execute({ toolId: "dashboard-rebuild", toolName: "Dashboard Rebuild", risk: "critical", dryRun: false, runId: pendingRunId });
        }}
      />
    </section>
  );
}
