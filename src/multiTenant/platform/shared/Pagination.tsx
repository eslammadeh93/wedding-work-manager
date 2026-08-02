interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageCount, onPageChange }: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <nav
      aria-label="صفحات النتائج"
      className="mt-4 flex items-center justify-center gap-3"
    >
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="rounded-xl border px-3 py-2 text-sm disabled:opacity-40"
      >
        السابق
      </button>
      <span className="text-sm text-slate-500">
        صفحة {page} من {pageCount}
      </span>
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        className="rounded-xl border px-3 py-2 text-sm disabled:opacity-40"
      >
        التالي
      </button>
    </nav>
  );
}
