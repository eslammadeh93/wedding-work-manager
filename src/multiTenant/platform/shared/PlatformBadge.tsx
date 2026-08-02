import type { HTMLAttributes, ReactNode } from "react";

export function PlatformBadge({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
  return (
    <span className={`platform-badge ${className}`} {...props}>
      {children}
    </span>
  );
}
