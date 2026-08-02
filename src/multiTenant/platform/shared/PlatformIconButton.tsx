import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

interface PlatformIconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export const PlatformIconButton = forwardRef<
  HTMLButtonElement,
  PlatformIconButtonProps
>(function PlatformIconButton(
  { label, children, className = "", type = "button", title, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title || label}
      className={`platform-icon-button ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});
