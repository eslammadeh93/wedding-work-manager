import type { HTMLAttributes, ReactNode } from "react";

export function PlatformTableContainer({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`platform-table-container ${className}`} {...props}>
      {children}
    </div>
  );
}
