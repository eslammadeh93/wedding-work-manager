import type { ReactNode } from "react";
import { PlatformCard } from "./PlatformCard";

interface StatCardProps {
  label: string;
  value: ReactNode;
  description?: string;
  icon?: ReactNode;
  loading?: boolean;
  onClick?: () => void;
}

export function StatCard({ label, value, description, icon, loading, onClick }: StatCardProps) {
  const className = "w-full p-4 text-right";
  const content = (
    <>
      <div className="flex items-center justify-between gap-2"><p className="text-xs text-slate-500">{label}</p>{icon && <span className="text-amber-700">{icon}</span>}</div>
      <p className="mt-2 text-2xl font-black text-amber-700">{loading ? "…" : (value ?? 0)}</p>
      {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${className} transition hover:-translate-y-0.5 hover:shadow-md`}
    >
      {content}
    </button>
  ) : (
    <PlatformCard className={className}>{content}</PlatformCard>
  );
}
