import type { ReactNode } from "react";
import { useAuth } from "../../../context/AuthContext";
import {
  isPlatformRole,
  platformRoleHasPermission,
  type PlatformPermission,
} from "./platformPermissions";

interface PlatformPermissionGuardProps {
  permission: PlatformPermission;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PlatformPermissionGuard({
  permission,
  children,
  fallback = null,
}: PlatformPermissionGuardProps) {
  const { authSession, loading } = useAuth();
  if (loading) return null;
  const role = authSession?.role;
  const allowed =
    authSession?.userType === "platform" &&
    isPlatformRole(role) &&
    platformRoleHasPermission(role, permission);
  return allowed ? <>{children}</> : <>{fallback}</>;
}
