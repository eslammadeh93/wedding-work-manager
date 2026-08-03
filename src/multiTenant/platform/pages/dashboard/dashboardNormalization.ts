import type { PlatformDashboardDto } from "./dashboardTypes";

const safeNumber = (value: unknown) =>
  Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export function normalizeDashboard(data: PlatformDashboardDto): PlatformDashboardDto {
  return {
    ...data,
    summary: Object.fromEntries(
      Object.entries(data.summary || {}).map(([key, value]) => [key, safeNumber(value)]),
    ) as unknown as PlatformDashboardDto["summary"],
    monthlyCompanies: (data.monthlyCompanies || []).map((point) => ({ ...point, value: safeNumber(point.value) })),
    monthlyOrders: (data.monthlyOrders || []).map((point) => ({ ...point, value: safeNumber(point.value) })),
    latestCompanies: data.latestCompanies || [], topCompanies: data.topCompanies || [], recentPlatformActivity: data.recentPlatformActivity || [], expiringCompanies: data.expiringCompanies || [], isPartial: Boolean(data.isPartial),
  };
}
