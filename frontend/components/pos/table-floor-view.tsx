"use client";

import { useState } from "react";
import { CheckCircle2, Sparkles, Utensils } from "lucide-react";
import { useTables } from "@/lib/hooks/pos/use-orders";
import { useTableDetail } from "@/lib/hooks/pos/use-tables";
import { OrderTableDetailDrawer } from "@/components/pos/order-table-detail-drawer";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DiningTable, TableStatus } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface TableFloorViewProps {
  /**
   * Fires ONLY on an AVAILABLE-table tap (UI-SPEC §2): the caller (page.tsx, plan 06)
   * binds the page-level `selectedTableId` and switches to the Terminal tab so a new
   * DRAFT order is created against that table. OCCUPIED/NEEDS_BUSSING taps never call
   * this — they open the shared Order/Table Detail drawer locally instead (below).
   */
  onTableSelect?: (table: DiningTable) => void;
}

const STATE_CONFIG: Record<
  TableStatus,
  { border: string; bg: string; icon: typeof CheckCircle2; label: string }
> = {
  AVAILABLE: { border: "border-success", bg: "bg-success/10", icon: CheckCircle2, label: "Available" },
  OCCUPIED: { border: "border-info", bg: "bg-info/10", icon: Utensils, label: "Occupied" },
  NEEDS_BUSSING: { border: "border-warning", bg: "bg-warning/10", icon: Sparkles, label: "Needs Bussing" },
};

export function TableFloorView({ onTableSelect }: TableFloorViewProps) {
  const { data: tables = [], isLoading } = useTables();
  // OCCUPIED/NEEDS_BUSSING tap target — the SAME shared drawer used by Order Management
  // (plan 09), resolved by tableId. Never a second table-detail UI (UI-SPEC hard rule).
  const [detailTable, setDetailTable] = useState<DiningTable | null>(null);

  const handleTap = (table: DiningTable) => {
    if (table.status === "AVAILABLE") {
      onTableSelect?.(table);
      return;
    }
    setDetailTable(table);
  };

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
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 p-4">
        {tables.map((table) => (
          <TableTile key={table.id} table={table} onTap={handleTap} />
        ))}
      </div>

      <OrderTableDetailDrawer
        open={detailTable !== null}
        onOpenChange={(open) => {
          if (!open) setDetailTable(null);
        }}
        tableId={detailTable?.id ?? null}
        tableName={detailTable?.tableName ?? null}
      />
    </>
  );
}

interface TableTileProps {
  table: DiningTable;
  onTap: (table: DiningTable) => void;
}

function TableTile({ table, onTap }: TableTileProps) {
  const config = STATE_CONFIG[table.status];
  const Icon = config.icon;

  // Derived-order-status badge for OCCUPIED tiles only (UI-SPEC §2 / POS-15 "clear
  // status indicators at a glance") — called unconditionally (hook rules), gated by an
  // empty tableId for non-OCCUPIED tiles, same pattern as the shared drawer's own
  // useTableDetail(isTableMode ? tableId : "") call.
  const detailQuery = useTableDetail(table.status === "OCCUPIED" ? table.id : "");
  const derivedStatus = table.status === "OCCUPIED" ? (detailQuery.data?.derivedStatus ?? null) : null;

  return (
    <button
      type="button"
      data-testid={`table-${table.tableName.toLowerCase().replace(/\s+/g, "-")}`}
      onClick={() => onTap(table)}
      className={cn(
        "touch-target min-h-[80px] rounded-xl border-2 flex flex-col items-center justify-center gap-1 p-2 transition-colors active:scale-95",
        config.border,
        config.bg,
      )}
    >
      <span className="font-semibold text-sm">{table.tableName}</span>
      <span className="inline-flex items-center gap-1 text-xs font-medium">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {config.label}
      </span>
      {derivedStatus && <StatusBadge status={derivedStatus} className="text-[10px]" />}
      <span className="text-xs text-muted-foreground">{table.capacity} seats</span>
    </button>
  );
}
