import { httpsCallable } from "firebase/functions";
import app, { functions } from "../../../../firebase/config";
import type { PlatformDashboardDto } from "./dashboardTypes";
import { normalizeDashboard } from "./dashboardNormalization";

export async function getPlatformDashboard(): Promise<PlatformDashboardDto> {
  const callable = httpsCallable<Record<string, never>, PlatformDashboardDto>(functions, "getPlatformDashboard");
  try {
    const response = await callable({});
    return normalizeDashboard(response.data);
  } catch (error) {
    if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) {
      const firebaseError = error as { code?: unknown; message?: unknown };
      console.error("[platform-dashboard] callable failed", {
        code: String(firebaseError.code || "functions/unknown"),
        message: String(firebaseError.message || "Unknown error"),
        functionName: "getPlatformDashboard",
        region: "us-central1",
        projectId: app.options.projectId || "unknown",
      });
    }
    throw error;
  }
}
