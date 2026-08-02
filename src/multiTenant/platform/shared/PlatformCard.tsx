import type { ComponentPropsWithoutRef, ReactNode } from "react";

type PlatformCardProps = ComponentPropsWithoutRef<"div"> & {
  children: ReactNode;
};

export function PlatformCard({
  children,
  className = "",
  ...props
}: PlatformCardProps) {
  return (
    <div className={`platform-card ${className}`} {...props}>
      {children}
    </div>
  );
}
