import { ChevronLeft } from "lucide-react";
import { formatPlatformDate } from "../../platformService";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { EmptyState } from "../../shared/EmptyState";
import { PlatformBadge } from "../../shared/PlatformBadge";
import { PlatformButton } from "../../shared/PlatformButton";
import { PlatformSection } from "../../shared/PlatformSection";
import type { DashboardActivity, DashboardCompany } from "./dashboardTypes";

const labels: Record<string, string> = { active: "نشطة", trial: "تجريبية", suspended: "موقوفة", expired: "منتهية", past_due: "متأخرة" };
const companyColumns = (open: (id: string) => void): readonly DataTableColumn<DashboardCompany>[] => [
  { key: "name", header: "الشركة", render: c => <strong>{c.name}</strong> },
  { key: "owner", header: "المالك", render: c => c.ownerName },
  { key: "status", header: "الحالة", render: c => <PlatformBadge>{labels[c.status] || c.status}</PlatformBadge> },
  { key: "created", header: "الإنشاء", render: c => formatPlatformDate(c.createdAt) },
  { key: "members", header: "الأعضاء", render: c => c.memberCount ?? "غير متاح" },
  { key: "orders", header: "الأوردرات", render: c => c.orderCount ?? "غير متاح" },
  { key: "open", header: "", render: c => <PlatformButton variant="ghost" onClick={() => open(c.id)}>فتح <ChevronLeft size={15} /></PlatformButton> },
];

export function CompanyTableSection({ title, companies, open }: { title: string; companies: DashboardCompany[]; open: (id: string) => void }) {
  return <PlatformSection><h2 className="mb-4 font-black">{title}</h2>{companies.length ? <DataTable rows={companies} columns={companyColumns(open)} rowKey={c => c.id} minWidthClass="min-w-[720px]" /> : <EmptyState text="لا توجد بيانات لعرضها." />}</PlatformSection>;
}
export function RecentActivity({ activities }: { activities: DashboardActivity[] }) {
  return <PlatformSection><h2 className="mb-4 font-black">آخر الأنشطة الإدارية</h2>{activities.length ? <div className="divide-y divide-slate-200 dark:divide-slate-700">{activities.map(item => <div key={item.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><strong>{item.action}</strong><span className="text-slate-500">{item.actorUid}</span><time>{formatPlatformDate(item.timestamp)}</time></div>)}</div> : <EmptyState text="لا توجد أنشطة إدارية حديثة." />}</PlatformSection>;
}
export function ExpiringCompanies({ companies, open }: { companies: DashboardCompany[]; open: (id: string) => void }) {
  return <CompanyTableSection title="الشركات القريبة من انتهاء الاشتراك" companies={companies} open={open} />;
}

