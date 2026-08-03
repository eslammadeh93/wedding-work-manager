import { httpsCallable } from "firebase/functions";
import type { AuthSession } from "../../../types";
import { functions } from "../../../../firebase/config";
import type { DeveloperToolProgress, DeveloperToolResult } from "./developerToolsTypes";

const PAGE_LIMIT = 10;
const UPDATED_AGGREGATE_FIELDS = [
  "memberCount",
  "activeMemberCount",
  "orderCount",
  "lastActivityAt",
  "platformAggregates/overview",
  "platformAggregates/monthly_*",
];

interface PlannedUpdate {
  companyId: string;
  fields?: string[];
  missingAggregateFields?: string[];
}

interface RebuildPage {
  success: boolean;
  dryRun: boolean;
  processed: number;
  nextCursor: string | null;
  pageTotals?: { companyCount?: number; memberCount?: number; orderCount?: number };
  estimatedReads: number;
  complete?: boolean;
  runId?: string;
  warnings?: string[];
  fieldsUpdated?: string[];
  plannedUpdates?: PlannedUpdate[];
  incompleteCompanies?: PlannedUpdate[];
}

const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const createDeveloperRunId = (kind: "dryrun" | "rebuild") =>
  `platform-dashboard-${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

export async function executeDashboardAggregateTool({
  session,
  dryRun,
  runId,
  onProgress,
}: {
  session: AuthSession | null;
  dryRun: boolean;
  runId: string;
  onProgress: (progress: DeveloperToolProgress) => void;
}): Promise<DeveloperToolResult> {
  if (session?.userType !== "platform" || session.role !== "platform_owner") {
    throw new Error("هذه الأداة متاحة لصاحب المنصة فقط.");
  }

  const callable = httpsCallable<
    { dryRun: boolean; limit: number; runId: string; cursor?: string },
    RebuildPage
  >(functions, "rebuildPlatformAggregates");
  const pages: RebuildPage[] = [];
  let cursor: string | null = null;
  do {
    const response = await callable({
      dryRun,
      limit: PAGE_LIMIT,
      runId,
      ...(cursor ? { cursor } : {}),
    });
    if (!response.data.success || response.data.dryRun !== dryRun) {
      throw new Error("استجابة rebuildPlatformAggregates غير صالحة.");
    }
    if (!dryRun && response.data.runId !== runId) {
      throw new Error("معرّف التشغيل في الاستجابة لا يطابق الطلب.");
    }
    pages.push(response.data);
    cursor = response.data.nextCursor || null;
    onProgress({
      processed: pages.reduce((sum, page) => sum + numeric(page.processed), 0),
      pages: pages.length,
    });
  } while (cursor);

  const plannedUpdates = pages.flatMap((page) => page.plannedUpdates || []);
  const incomplete = pages.flatMap((page) => page.incompleteCompanies || []);
  const responseWarnings = pages.flatMap((page) => page.warnings || []);
  const warnings = [
    ...responseWarnings,
    ...incomplete.map((company) =>
      `${company.companyId}: حقول ناقصة — ${(company.missingAggregateFields || []).join(", ")}`,
    ),
  ];
  const responseFields = pages.flatMap((page) => page.fieldsUpdated || []);
  const plannedFields = plannedUpdates.flatMap((company) => company.fields || []);
  const finalPage = pages.at(-1);

  return {
    processed: pages.reduce((sum, page) => sum + numeric(page.processed), 0),
    companies: pages.reduce((sum, page) => sum + numeric(page.pageTotals?.companyCount), 0),
    members: pages.reduce((sum, page) => sum + numeric(page.pageTotals?.memberCount), 0),
    orders: pages.reduce((sum, page) => sum + numeric(page.pageTotals?.orderCount), 0),
    estimatedReads: pages.reduce((sum, page) => sum + numeric(page.estimatedReads), 0),
    pages: pages.length,
    complete: dryRun ? cursor === null : finalPage?.complete === true,
    warnings: [...new Set(warnings)],
    fieldsUpdated: [...new Set(responseFields.length ? responseFields : dryRun ? plannedFields : UPDATED_AGGREGATE_FIELDS)].sort(),
    runId,
  };
}
