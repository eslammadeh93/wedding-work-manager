import type { ReactNode } from "react";
import { PlatformTableContainer } from "./PlatformTableContainer";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}
interface DataTableProps<T> {
  rows: readonly T[];
  columns: readonly DataTableColumn<T>[];
  rowKey: (row: T) => string;
  minWidthClass?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  minWidthClass = "min-w-[900px]",
}: DataTableProps<T>) {
  return (
    <PlatformTableContainer>
      <table className={`w-full text-right text-sm ${minWidthClass}`}>
        <thead className="bg-slate-100 text-xs dark:bg-slate-800">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={`p-3 ${column.className || ""}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-t border-slate-100 transition hover:bg-amber-50/60 dark:border-slate-800 dark:hover:bg-slate-800/60"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`p-3 ${column.className || ""}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </PlatformTableContainer>
  );
}
