import type { ReactNode } from "react";
import { X } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  confirmDisabled?: boolean;
  dangerous?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "تأكيد",
  busy = false,
  confirmDisabled = false,
  dangerous = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="platform-confirm-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
      >
        <div className="flex items-center justify-between">
          <h2 id="platform-confirm-title" className="font-black">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="إغلاق"
          >
            <X />
          </button>
        </div>
        <div className="my-4 text-sm text-slate-600 dark:text-slate-300">
          {description}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={`rounded-xl px-4 py-2 font-bold text-white disabled:opacity-50 ${dangerous ? "bg-rose-600" : "bg-amber-600"}`}
          >
            {busy ? "جارٍ التنفيذ…" : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border px-4 py-2"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
