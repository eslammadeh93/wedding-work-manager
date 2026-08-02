import type { ReactNode } from "react";

interface PlatformPageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PlatformPageHeader({
  title,
  description,
  actions,
}: PlatformPageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3 border-0 bg-transparent p-0 dark:bg-transparent">
      <div>
        <h1 className="text-2xl font-black">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
