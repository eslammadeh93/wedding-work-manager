import { Loader2 } from "lucide-react";
export function LoadingState({
  text = "جارٍ تحميل البيانات…",
}: {
  text?: string;
}) {
  return (
    <div
      className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"
      role="status"
    >
      <Loader2 className="animate-spin" size={18} />
      {text}
    </div>
  );
}
