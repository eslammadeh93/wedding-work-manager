import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  Building2,
  CircleGauge,
  ClipboardList,
  CreditCard,
  Headphones,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import type { PlatformPermission } from "./permissions/platformPermissions";

export type PlatformRouteId =
  | "dashboard"
  | "companies"
  | "users"
  | "subscriptions"
  | "analytics"
  | "notifications"
  | "activity"
  | "developerTools"
  | "support"
  | "settings"
  | "admins";

export interface PlatformRouteDefinition {
  id: PlatformRouteId;
  path: string;
  label: string;
  icon: LucideIcon;
  permission: PlatformPermission;
  implemented: boolean;
}

export const PLATFORM_ROUTES: readonly PlatformRouteDefinition[] = [
  {
    id: "dashboard",
    path: "/platform",
    label: "لوحة التحكم",
    icon: CircleGauge,
    permission: "platform:dashboard:read",
    implemented: true,
  },
  {
    id: "companies",
    path: "/platform/companies",
    label: "الشركات",
    icon: Building2,
    permission: "platform:companies:read",
    implemented: true,
  },
  {
    id: "users",
    path: "/platform/users",
    label: "المستخدمون",
    icon: Users,
    permission: "platform:users:read",
    implemented: true,
  },
  {
    id: "subscriptions",
    path: "/platform/subscriptions",
    label: "الاشتراكات",
    icon: CreditCard,
    permission: "platform:subscriptions:read",
    implemented: true,
  },
  {
    id: "analytics",
    path: "/platform/analytics",
    label: "الإحصائيات",
    icon: BarChart3,
    permission: "platform:dashboard:read",
    implemented: true,
  },
  {
    id: "notifications",
    path: "/platform/notifications",
    label: "الإشعارات",
    icon: Bell,
    permission: "platform:notifications:manage",
    implemented: true,
  },
  {
    id: "activity",
    path: "/platform/activity",
    label: "سجل النشاط",
    icon: ClipboardList,
    permission: "platform:audit_logs:read",
    implemented: true,
  },
  {
    id: "support",
    path: "/platform/support",
    label: "الدعم الفني",
    icon: Headphones,
    permission: "platform:support:manage",
    implemented: true,
  },
  {
    id: "settings",
    path: "/platform/settings",
    label: "إعدادات النظام",
    icon: Settings,
    permission: "platform:settings:manage",
    implemented: true,
  },
  {
    id: "admins",
    path: "/platform/admins",
    label: "المشرفون والصلاحيات",
    icon: ShieldCheck,
    permission: "platform:admins:manage",
    implemented: true,
  },
  {
    id: "developerTools",
    path: "/platform/developer-tools",
    label: "Developer Tools",
    icon: Wrench,
    permission: "platform:developer_tools:manage",
    implemented: true,
  },
] as const;

export const platformRouteForPath = (
  path: string,
): PlatformRouteDefinition | undefined => {
  if (path.startsWith("/platform/companies/"))
    return PLATFORM_ROUTES.find((route) => route.id === "companies");
  return PLATFORM_ROUTES.find((route) => route.path === path);
};
