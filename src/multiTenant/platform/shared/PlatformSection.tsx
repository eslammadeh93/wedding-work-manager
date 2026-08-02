import type { HTMLAttributes, ReactNode } from "react";

export function PlatformSection({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section className={`platform-section ${className}`} {...props}>
      {children}
    </section>
  );
}
