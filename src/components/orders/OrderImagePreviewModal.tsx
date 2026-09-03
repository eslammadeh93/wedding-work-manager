import React from 'react';
import { X } from 'lucide-react';
import { toSafeExternalUrl } from '../../utils/security';

interface OrderImagePreviewModalProps {
  url: string | null;
  onClose: () => void;
  title: string;
}

const drivePreviewUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)drive\.google\.com$/i.test(parsed.hostname)) return null;
    const pathId = parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1];
    const queryId = parsed.searchParams.get('id');
    const id = pathId || queryId;
    return id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview` : null;
  } catch {
    return null;
  }
};

/** Shows an order design image without navigating away from the order. */
export const OrderImagePreviewModal: React.FC<OrderImagePreviewModalProps> = ({ url, onClose, title }) => {
  const safeUrl = url ? toSafeExternalUrl(url) : null;
  const embeddedDriveUrl = safeUrl ? drivePreviewUrl(safeUrl) : null;

  React.useEffect(() => {
    if (!safeUrl) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, safeUrl]);

  if (!safeUrl) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={title} className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="truncate text-sm font-black text-slate-900 dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close image preview">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 bg-slate-100 p-2 dark:bg-slate-950">
          {embeddedDriveUrl ? (
            <iframe src={embeddedDriveUrl} title={title} className="h-full w-full rounded-2xl border-0 bg-white" allow="autoplay" />
          ) : (
            <img src={safeUrl} alt={title} className="h-full w-full rounded-2xl object-contain" />
          )}
        </div>
      </section>
    </div>
  );
};
