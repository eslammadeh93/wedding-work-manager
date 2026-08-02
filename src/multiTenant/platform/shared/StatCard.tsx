import type { ReactNode } from "react";
import { PlatformCard } from "./PlatformCard";

interface StatCardProps {
  label: string;
  value: ReactNode;
  onClick?: () => void;
}

export function StatCard({ label, value, onClick }: StatCardProps) {
  const className = "w-full p-4 text-right";
  const content = (
    <>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-amber-700">{value}</p>
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
