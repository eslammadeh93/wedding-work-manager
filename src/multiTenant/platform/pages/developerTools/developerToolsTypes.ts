export type DeveloperToolId = "dashboard-dry-run" | "dashboard-rebuild";
export type DeveloperToolRisk = "low" | "critical";
export type DeveloperActionStatus = "running" | "success" | "error";

export interface DeveloperToolProgress {
  processed: number;
  pages: number;
}

export interface DeveloperToolResult {
  processed: number;
  companies: number;
  members: number;
  orders: number;
  estimatedReads: number;
  pages: number;
  complete: boolean;
  warnings: string[];
  fieldsUpdated: string[];
  runId: string;
}

export interface DeveloperActionRecord {
  id: string;
  toolId: DeveloperToolId;
  toolName: string;
  risk: DeveloperToolRisk;
  status: DeveloperActionStatus;
  actorUid: string;
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  result: DeveloperToolResult | null;
  error: string | null;
  auditTarget: "platformAuditLogs";
}

export interface DeveloperToolExecutionState {
  running: boolean;
  progress: DeveloperToolProgress;
  result: DeveloperToolResult | null;
  error: string;
  success: string;
}
