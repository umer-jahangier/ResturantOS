import { Skeleton } from "@/components/ui/skeleton";

const columnWidths = ["w-16", "w-32", "w-24", "w-20", "w-28"] as const;

interface DataTableSkeletonProps {
  columns?: number;
  rows?: number;
}

export function DataTableSkeleton({ columns = 5, rows = 8 }: DataTableSkeletonProps) {
  const colWidths = columnWidths.slice(0, columns);
  const filledCols =
    columns <= columnWidths.length
      ? colWidths
      : [
          ...colWidths,
          ...Array.from({ length: columns - columnWidths.length }, (_, i) =>
            columnWidths[i % columnWidths.length],
          ),
        ];

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border">
      {/* Header row */}
      <div className="flex items-center gap-4 border-b border-border bg-muted/40 px-4 py-3">
        {filledCols.map((w, i) => (
          <Skeleton key={i} className={`h-4 ${w}`} />
        ))}
      </div>

      {/* Body rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0"
        >
          {filledCols.map((w, colIndex) => (
            <Skeleton key={colIndex} className={`h-4 ${w}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
