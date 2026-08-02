import { Crown, LockKeyhole } from "lucide-react";
import { PLATFORM_ROUTES, type PlatformRouteDefinition } from "./routes";
import {
  isPlatformRole,
  platformRoleHasPermission,
  type PlatformRole,
} from "./permissions/platformPermissions";
import { PlatformBadge } from "./shared/PlatformBadge";

const navigationGroups = [
  ["dashboard", "companies", "users"],
  ["subscriptions", "analytics", "activity"],
  ["notifications", "support"],
  ["settings", "admins"],
] as const;

interface PlatformNavigationProps {
  currentPath: string;
  role: string;
  onNavigate: (path: string) => void;
}

export function PlatformNavigation({
  currentPath,
  role,
  onNavigate,
}: PlatformNavigationProps) {
  const platformRole: PlatformRole | null = isPlatformRole(role) ? role : null;
  const visibleRoutes = platformRole
    ? PLATFORM_ROUTES.filter((route) =>
        platformRoleHasPermission(platformRole, route.permission),
      )
    : [];
  const active = (route: PlatformRouteDefinition) =>
    route.id === "companies"
      ? currentPath.startsWith("/platform/companies")
      : currentPath === route.path;

  return (
    <div>
      <div className="mb-6 flex items-center gap-3 px-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-slate-800 dark:text-amber-300">
          <Crown size={21} strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-black">منصة الإدارة</p>
          <p className="text-xs font-medium text-slate-500">Super Admin</p>
        </div>
      </div>
      <nav aria-label="أقسام منصة الإدارة">
        {navigationGroups.map((group, groupIndex) => (
          <div
            key={group.join("-")}
            className={
              groupIndex === 0
                ? "space-y-0.5"
                : "mt-2 space-y-0.5 border-t border-slate-200 pt-2 dark:border-slate-800"
            }
          >
            {visibleRoutes
              .filter((route) =>
                (group as readonly string[]).includes(route.id),
              )
              .map((route) => {
                const Icon = route.icon;
                const isActive = active(route);
                return (
                  <button
                    key={route.id}
                    type="button"
                    onClick={() => onNavigate(route.path)}
                    aria-current={isActive ? "page" : undefined}
                    title={
                      !route.implemented
                        ? `${route.label} — قيد التطوير`
                        : route.label
                    }
                    className={`platform-nav-item relative flex min-h-10 w-full items-center gap-2.5 overflow-hidden rounded-lg px-3 py-2 text-right text-sm font-bold ${isActive ? "bg-amber-100/80 text-amber-800 dark:bg-slate-800 dark:text-white" : "text-slate-600 hover:bg-amber-50/70 dark:text-slate-300 dark:hover:bg-slate-800/70"}`}
                  >
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1 right-0 w-0.5 rounded-l-full bg-amber-600 dark:bg-amber-300"
                      />
                    )}
                    <Icon
                      size={18}
                      strokeWidth={1.8}
                      className={`shrink-0 ${isActive ? "text-amber-700 dark:text-amber-300" : "text-slate-500"}`}
                    />
                    <span className="min-w-0 flex-1 whitespace-nowrap">
                      {route.label}
                    </span>
                    {!route.implemented && (
                      <PlatformBadge
                        className="h-5 w-5 shrink-0"
                        aria-label="قيد التطوير"
                      >
                        <LockKeyhole size={11} strokeWidth={1.8} />
                      </PlatformBadge>
                    )}
                  </button>
                );
              })}
          </div>
        ))}
      </nav>
    </div>
  );
}
