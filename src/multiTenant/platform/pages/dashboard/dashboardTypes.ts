export interface DashboardSummary { companyCount: number; activeCompanyCount: number; trialCompanyCount: number; suspendedCompanyCount: number; expiredCompanyCount: number; expiringSoonCompanyCount: number; memberCount: number; orderCount: number; ordersToday: number; ordersCurrentMonth: number; newCompaniesCurrentMonth: number }
export interface DashboardSeriesPoint { month: string; value: number }
export interface DashboardCompany { id: string; name: string; ownerName: string; status: string; createdAt: string | null; subscriptionEnd: string | null; memberCount: number | null; orderCount: number | null; activeMemberCount: number | null; lastActivityAt: string | null }
export interface DashboardActivity { id: string; action: string; actorUid: string; companyId: string | null; timestamp: string | null }
export interface PlatformDashboardDto { summary: DashboardSummary; monthlyCompanies: DashboardSeriesPoint[]; monthlyOrders: DashboardSeriesPoint[]; latestCompanies: DashboardCompany[]; topCompanies: DashboardCompany[]; recentPlatformActivity: DashboardActivity[]; expiringCompanies: DashboardCompany[]; generatedAt: string; aggregateUpdatedAt: string | null; isPartial: boolean }

