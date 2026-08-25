import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase/config";

export type PlatformSupportTicket = {
  id: string;
  companyId: string;
  companyName: string;
  subject: string;
  status: "open" | "in_progress" | "resolved";
  priority: "low" | "normal" | "high" | "urgent";
  assignedTo?: string | null;
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
  plan: string;
  status: "trial" | "active" | "past_due" | "expired" | "suspended";
  subscriptionEnd: string;
}): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "managePlatformSubscription");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function createPlatformAdmin(data: {
  name: string;
  email: string;
  password: string;
  role: "platform_owner" | "platform_admin" | "platform_support" | "platform_billing" | "platform_read_only";
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
}): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "updatePlatformAdmin");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}

export async function deletePlatformAdmin(data: { uid: string }): Promise<void> {
  const call = httpsCallable<typeof data, Result>(functions, "deletePlatformAdmin");
  const result = await call(data);
  if (!result.data.success) throw new Error(result.data.message);
}
