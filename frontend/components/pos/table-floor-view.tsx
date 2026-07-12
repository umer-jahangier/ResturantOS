"use client";

import { useTables } from "@/lib/hooks/pos/use-orders";
import type { DiningTable } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface TableFloorViewProps {
  onTableSelect?: (table: DiningTable) => void;
}

export function TableFloorView({ onTableSelect }: TableFloorViewProps) {
  const { data: tables = [], isLoading } = useTables();

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 p-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
        <span className="text-3xl">🪑</span>
        <p className="text-sm">No tables configured</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 p-4">
      {tables.map((table) => (
        <button
          key={table.id}
          data-testid={`table-${table.tableName.toLowerCase().replace(/\s+/g, "-")}`}
          onClick={() => onTableSelect?.(table)}
          className={cn(
            "min-h-[80px] rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition-colors active:scale-95",
            table.status === "AVAILABLE"
              ? "border-green-400 bg-green-50 hover:bg-green-100"
              : "border-orange-400 bg-orange-50 hover:bg-orange-100 cursor-default"
          )}
        >
          <span className="font-semibold text-sm">{table.tableName}</span>
          <span
            className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium",
              table.status === "AVAILABLE"
                ? "bg-green-100 text-green-700"
                : "bg-orange-100 text-orange-700"
            )}
          >
            {table.status === "AVAILABLE" ? "Available" : "Occupied"}
          </span>
          <span className="text-xs text-muted-foreground">{table.capacity} seats</span>
        </button>
      ))}
    </div>
  );
}
