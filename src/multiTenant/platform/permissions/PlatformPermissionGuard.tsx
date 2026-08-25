import type { ReactNode } from "react";
import { useAuth } from "../../../context/AuthContext";
import { type PlatformPermission } from "./platformPermissions";

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
  const allowed =
    authSession?.userType === "platform" &&
    authSession.permissions.includes(permission);
  return allowed ? <>{children}</> : <>{fallback}</>;
}
