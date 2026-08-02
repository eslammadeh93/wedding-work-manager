import type { ReactNode } from "react";

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
      role="search"
    >
      {children}
    </div>
  );
}
