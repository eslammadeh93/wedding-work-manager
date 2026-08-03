import { useCallback, useEffect, useState } from "react";
import { Building2, CalendarDays, ClipboardList, Plus, Users } from "lucide-react";
import { EmptyState } from "../../shared/EmptyState";
import { ErrorState } from "../../shared/ErrorState";
import { LoadingState } from "../../shared/LoadingState";
import { PlatformBadge } from "../../shared/PlatformBadge";
import { PlatformButton } from "../../shared/PlatformButton";
import { PlatformPageHeader } from "../../shared/PlatformPageHeader";
import { StatCard } from "../../shared/StatCard";
import { CompanyTableSection, ExpiringCompanies, RecentActivity } from "./CompanyLists";
import { getPlatformDashboard } from "./dashboardService";
import type { PlatformDashboardDto } from "./dashboardTypes";
import { GrowthChart } from "./GrowthChart";

export function PlatformDashboard({ navigate, createCompany }: { navigate: (path: string) => void; createCompany: () => void }) {
  const [data, setData] = useState<PlatformDashboardDto | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { setData(await getPlatformDashboard()); } catch { setError("تعذر تحميل لوحة المنصة. تأكد من توفر خدمة الخلفية ثم حاول مجددًا."); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <LoadingState text="جارٍ تحميل مؤشرات المنصة…" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <EmptyState text="لا توجد بيانات Dashboard متاحة." />;
  const s = data.summary; const cards = [
    ["إجمالي الشركات", s.companyCount, "/platform/companies", "كل الشركات", Building2], ["الشركات النشطة", s.activeCompanyCount, "/platform/companies?status=active", "اشتراكات نشطة", Building2], ["الشركات التجريبية", s.trialCompanyCount, "/platform/companies?status=trial", "ضمن الفترة التجريبية", Building2], ["الشركات المتوقفة", s.suspendedCompanyCount, "/platform/companies?status=suspended", "موقوفة إداريًا", Building2], ["الشركات المنتهية", s.expiredCompanyCount, "/platform/companies?status=expired", "انتهى اشتراكها", CalendarDays], ["تنتهي قريبًا", s.expiringSoonCompanyCount, "/platform/companies?status=expiring", "خلال 30 يومًا", CalendarDays], ["إجمالي المستخدمين", s.memberCount, "", "أعضاء جميع الشركات", Users], ["إجمالي الأوردرات", s.orderCount, "", "العدد التراكمي", ClipboardList], ["أوردرات اليوم", s.ordersToday, "", "حسب UTC", ClipboardList], ["أوردرات الشهر", s.ordersCurrentMonth, "", "الشهر الحالي", ClipboardList], ["شركات جديدة هذا الشهر", s.newCompaniesCurrentMonth, "", "حسب تاريخ الإنشاء", Building2],
  ] as const;
  return <section>
    <PlatformPageHeader title="لوحة المنصة" description="مؤشرات تشغيلية مجمعة وآمنة لأداء المنصة والشركات." actions={<PlatformButton onClick={createCompany}><Plus size={17} />إنشاء شركة</PlatformButton>} />
    {data.isPartial && <div className="mb-4"><PlatformBadge className="platform-badge-warning">البيانات جزئية حتى تنفيذ Rebuild المعتمد للشركات القديمة</PlatformBadge></div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, path, description, Icon]) => <div key={label}><StatCard label={label} value={value} description={description} icon={<Icon size={18} />} onClick={path ? () => navigate(path) : undefined} /></div>)}</div>
    <div className="mt-5 grid min-w-0 gap-4 lg:mt-6 xl:grid-cols-2"><GrowthChart title="نمو الشركات شهريًا" points={data.monthlyCompanies} /><GrowthChart title="نمو الأوردرات شهريًا" points={data.monthlyOrders} /></div>
    <div className="mt-5 space-y-5"><CompanyTableSection title="أحدث الشركات" companies={data.latestCompanies} open={id => navigate(`/platform/companies/${id}`)} /><CompanyTableSection title="الشركات الأكثر نشاطًا" companies={data.topCompanies} open={id => navigate(`/platform/companies/${id}`)} /><RecentActivity activities={data.recentPlatformActivity} /><ExpiringCompanies companies={data.expiringCompanies} open={id => navigate(`/platform/companies/${id}`)} /></div>
  </section>;
}
