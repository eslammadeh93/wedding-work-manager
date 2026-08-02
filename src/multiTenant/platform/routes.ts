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
    implemented: false,
  },
  {
    id: "subscriptions",
    path: "/platform/subscriptions",
    label: "الاشتراكات",
    icon: CreditCard,
    permission: "platform:subscriptions:read",
    implemented: false,
  },
  {
    id: "analytics",
    path: "/platform/analytics",
    label: "الإحصائيات",
    icon: BarChart3,
    permission: "platform:dashboard:read",
    implemented: false,
  },
  {
    id: "notifications",
    path: "/platform/notifications",
    label: "الإشعارات",
    icon: Bell,
    permission: "platform:dashboard:read",
    implemented: false,
  },
  {
    id: "activity",
    path: "/platform/activity",
    label: "سجل النشاط",
    icon: ClipboardList,
    permission: "platform:audit_logs:read",
    implemented: false,
  },
  {
    id: "support",
    path: "/platform/support",
    label: "الدعم الفني",
    icon: Headphones,
    permission: "platform:companies:read",
    implemented: false,
  },
  {
    id: "settings",
    path: "/platform/settings",
    label: "إعدادات النظام",
    icon: Settings,
    permission: "platform:admins:manage",
    implemented: false,
  },
  {
    id: "admins",
    path: "/platform/admins",
    label: "المشرفون والصلاحيات",
    icon: ShieldCheck,
    permission: "platform:admins:manage",
    implemented: false,
  },
] as const;

export const platformRouteForPath = (
  path: string,
): PlatformRouteDefinition | undefined => {
  if (path.startsWith("/platform/companies/"))
    return PLATFORM_ROUTES.find((route) => route.id === "companies");
  return PLATFORM_ROUTES.find((route) => route.path === path);
};
