"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTables } from "@/lib/hooks/pos/use-orders";
import type { DiningTable } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

interface TableSelectComboboxProps {
  value: string | null;
  onChange: (tableId: string | null) => void;
  className?: string;
  disabled?: boolean;
}

const TABLE_STATUS_LABEL: Record<DiningTable["status"], string> = {
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  NEEDS_BUSSING: "Needs bussing",
};

const TABLE_STATUS_CLASS: Record<DiningTable["status"], string> = {
  AVAILABLE: "bg-success/15 text-success border-success/30",
  OCCUPIED: "bg-info/15 text-info border-info/30",
  NEEDS_BUSSING: "bg-warning/15 text-warning border-warning/30",
};

/**
 * Searchable table selector (D-03/POS-18, UI-SPEC §1) — reused by the terminal (this
 * plan) and, per UI-SPEC §3, Order Management's "Assign Table" action (a later plan).
 * OCCUPIED options render `disabled` + `aria-disabled` and are unselectable; table
 * selection is always optional (a "No table" option is always first).
 */
export function TableSelectCombobox({ value, onChange, className, disabled }: TableSelectComboboxProps) {
  const { data: tables = [] } = useTables();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = tables.find((t) => t.id === value) ?? null;

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return trimmed ? tables.filter((t) => t.tableName.toLowerCase().includes(trimmed)) : tables;
  }, [tables, query]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const select = (tableId: string | null) => {
    onChange(tableId);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select table"
        data-testid="table-select-trigger"
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.tableName : "No table (optional)"}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-lg">
          <div className="relative border-b p-1.5">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tables…"
              aria-label="Search tables"
              className="h-8 pl-8 text-sm"
            />
          </div>
          <ul role="listbox" aria-label="Tables" className="max-h-56 overflow-y-auto p-1">
            <li role="option" aria-selected={value === null}>
              <button
                type="button"
                onClick={() => select(null)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Check className={cn("size-3.5", value === null ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                No table (optional)
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">No tables match</li>
            ) : (
              filtered.map((table) => (
                <TableOption key={table.id} table={table} selected={value === table.id} onSelect={() => select(table.id)} />
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

interface TableOptionProps {
  table: DiningTable;
  selected: boolean;
  onSelect: () => void;
}

function TableOption({ table, selected, onSelect }: TableOptionProps) {
  const isOccupied = table.status === "OCCUPIED";
  return (
    <li role="option" aria-selected={selected} aria-disabled={isOccupied} data-testid={`table-option-${table.tableName}`}>
      <button
        type="button"
        disabled={isOccupied}
        onClick={onSelect}
        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <span className="flex items-center gap-2 truncate">
          <Check className={cn("size-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
          {table.tableName}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
            TABLE_STATUS_CLASS[table.status],
          )}
        >
          {TABLE_STATUS_LABEL[table.status]}
        </span>
      </button>
    </li>
  );
}
