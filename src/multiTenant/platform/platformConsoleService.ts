import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase/config";

export type PlatformPlan = {
  id: string;
  name: string;
  maxUsers: number | null;
};

export type PlatformSupportTicket = {
  id: string;
  companyId: string;
  companyName: string;
  subject: string;
  status: "open" | "in_progress" | "resolved";
  priority: "low" | "normal" | "high" | "urgent";
  assignedTo?: string | null;
  source?: "company_user" | "platform_support";
  requesterName?: string;
  requesterEmail?: string;
  requesterRole?: string;
  lastAction?: string;
  lastActionByName?: string;
  lastActionByEmail?: string;
  lastActionAt?: string;
  activity?: { id: string; action: string; actorName: string; actorEmail: string; createdAt?: string }[];
  commentCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type PlatformNotification = {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  status: "unread" | "read" | "archived";
  companyId?: string | null;
  createdAt?: string;
};

export type PlatformConsoleSettings = {
  expiryDays: number;
  compactMode: boolean;
  dailyDigest: boolean;
};

type Result = { success: boolean; message: string };
type PermissionConfigurationResult = Result & { rolePermissions?: Record<string, string[]> };

export type SupportApprovalRequest = { sessionId: string; expiresAtMs: number; message: string };
export type SupportSessionAuditLog = { id: string; action: string; actorUid: string; detail: string; companyId: string; collection: string; documentId: string; operation: string; changedFields: string[]; entityLabel: string; changes: { field: string; before: string; after: string }[]; createdAt: string | null };
export type SupportSessionAudit = { id: string; companyId: string; companyName: string; status: string; platformActorName: string; platformActorEmail: string; recipientName: string; recipientEmail: string; recipientPhone: string; requestedAt: string | null; activatedAt: string | null; endedAt: string | null; expiresAtMs: number; auditLogs: SupportSessionAuditLog[] };

export async function listSupportImpersonationAuditLogs(): Promise<SupportSessionAudit[]> {
  const call = httpsCallable<undefined, Result & { sessions?: SupportSessionAudit[] }>(functions, 'listSupportImpersonationAuditLogs');
  const result = (await call()).data;
  if (!result.success || !result.sessions) throw new Error(result.message);
  return result.sessions;
}

export async function startSupportImpersonationRequest(data: { companyId: string; recipientPhone: string }): Promise<SupportApprovalRequest> {
  const call = httpsCallable<typeof data, Result & Partial<SupportApprovalRequest>>(functions, 'startSupportImpersonationRequest');
  const result = (await call(data)).data;
  if (!result.success || !result.sessionId || !result.expiresAtMs) throw new Error(result.message);
  return { sessionId: result.sessionId, expiresAtMs: result.expiresAtMs, message: result.message };
}

export async function verifySupportImpersonationCode(data: { sessionId: string; code: string }): Promise<{ customToken: string; expiresAtMs: number; companyName: string }> {
  const call = httpsCallable<typeof data, Result & { customToken?: string; expiresAtMs?: number; companyName?: string }>(functions, 'verifySupportImpersonationCode');
  const result = (await call(data)).data;
  if (!result.success || !result.customToken || !result.expiresAtMs) throw new Error(result.message);
  return { customToken: result.customToken, expiresAtMs: result.expiresAtMs, companyName: result.companyName || '' };
}

export async function resolveStuckSupportImpersonationSession(data: { action: 'resume' | 'end'; phone?: string }): Promise<{ customToken?: string; message: string }> {
  const call = httpsCallable<typeof data, Result & { customToken?: string }>(functions, 'resolveStuckSupportImpersonationSession');
  const result = (await call(data)).data;
  if (!result.success) throw new Error(result.message);
  return { customToken: result.customToken, message: result.message };
}

export async function getPlatformConsoleState(): Promise<{
  settings: PlatformConsoleSettings;
  supportTickets: PlatformSupportTicket[];
  notifications: PlatformNotification[];
}> {
  const call = httpsCallable<undefined, {
    settings: PlatformConsoleSettings;
    supportTickets: PlatformSupportTicket[];
    notifications: PlatformNotification[];
  }>(functions, "getPlatformConsoleState");
  return (await call()).data;
}

export async function savePlatformConsoleSettings(
  settings: PlatformConsoleSettings,
): Promise<void> {
  const call = httpsCallable<PlatformConsoleSettings, Result>(
    functions,
    "savePlatformConsoleSettings",
  );
  const result = await call(settings);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function createPlatformSupportTicket(data: {
  companyId: string;
  subject: string;
}): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "createPlatformSupportTicket");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function updatePlatformSupportTicket(data: {
  ticketId: string;
  status: PlatformSupportTicket["status"];
  priority?: PlatformSupportTicket["priority"];
  assignedTo?: string | null;
}): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "updatePlatformSupportTicket");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function addPlatformSupportComment(data: { ticketId: string; body: string }): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "addPlatformSupportComment");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function createPlatformNotification(data: {
  title: string;
  body: string;
  severity: PlatformNotification["severity"];
  companyId?: string | null;
}): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "createPlatformNotification");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function updatePlatformNotification(data: {
  notificationId: string;
  status: PlatformNotification["status"];
}): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "updatePlatformNotification");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function deletePlatformNotification(data: { notificationId: string }): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "deletePlatformNotification");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function setPlatformMemberStatus(data: {
  companyId: string;
  memberUid: string;
  status: "active" | "disabled";
}): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "setPlatformMemberStatus");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function updatePlatformMember(data: {
  companyId: string;
  memberUid: string;
  name: string;
  email: string;
}): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "updatePlatformMember");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function setPlatformMemberTemporaryPassword(data: {
  companyId: string;
  memberUid: string;
  temporaryPassword: string;
}): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "setPlatformMemberTemporaryPassword");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function managePlatformSubscription(data: {
  companyId: string;
  planId: string;
  status: "trial" | "active" | "past_due" | "expired" | "suspended";
  subscriptionEnd: string;
}): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "managePlatformSubscription");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function listPlatformPlans(): Promise<PlatformPlan[]> {
  const call = httpsCallable<undefined, Result & { plans?: PlatformPlan[] }>(functions, "listPlatformPlans");
  const result = await call();
  if (!result.data.success || !result.data.plans) throw new Error(result.data.message);
  return result.data.plans;
}

export async function createPlatformPlan(data: { name: string; maxUsers: number | null }): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "createPlatformPlan");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function updatePlatformPlan(data: { planId: string; name: string; maxUsers: number | null }): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "updatePlatformPlan");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function createPlatformAdmin(data: {
  name: string;
  email: string;
  password: string;
  role: "platform_owner" | "platform_admin" | "platform_support" | "platform_billing" | "platform_read_only";
  /** When false, permissions contains a per-account override for the selected role. */
  useRolePermissions?: boolean;
  permissions?: string[];
}): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "createPlatformAdmin");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function updatePlatformAdmin(data: {
  uid: string;
  name?: string;
  email?: string;
  role: "platform_owner" | "platform_admin" | "platform_support" | "platform_billing" | "platform_read_only";
  status: "active" | "disabled";
  permissions?: string[];
  useRolePermissions?: boolean;
}): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "updatePlatformAdmin");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function getPlatformPermissionConfiguration(): Promise<Record<string, string[]>> {
  const call = httpsCallable<undefined, PermissionConfigurationResult>(functions, "getPlatformPermissionConfiguration");
  const result = await call();
  if (!result.data.success || !result.data.rolePermissions) throw new Error(result.data.message);
  return result.data.rolePermissions;
}

export async function updatePlatformRolePermissions(data: { role: string; permissions: string[] }): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "updatePlatformRolePermissions");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function deletePlatformAdmin(data: { uid: string }): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "deletePlatformAdmin");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}
