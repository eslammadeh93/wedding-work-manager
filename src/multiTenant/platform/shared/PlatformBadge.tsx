import type { HTMLAttributes, ReactNode } from "react";

export function PlatformBadge({
  children,
  className = "",
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode; tone?: "warning" | "neutral" }) {
  return (
    <span className={`platform-badge ${tone ? `platform-badge-${tone}` : ""} ${className}`} {...props}>
      {children}
    </span>
  );
}
