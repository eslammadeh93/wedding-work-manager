import type { ComponentPropsWithoutRef, ReactNode } from "react";

type PlatformButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type PlatformButtonProps = ComponentPropsWithoutRef<"button"> & {
  children: ReactNode;
  variant?: PlatformButtonVariant;
};

export function PlatformButton({
  children,
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: PlatformButtonProps) {
  return (
    <button
      type={type}
      className={`platform-button platform-button--${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
