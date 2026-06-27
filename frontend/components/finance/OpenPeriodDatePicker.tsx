"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOpenPeriods } from "@/lib/hooks/finance/use-periods";
import type { AccountingPeriod } from "@/lib/models/finance.model";

interface OpenPeriodDatePickerProps {
  value: string;
  onChange: (isoDate: string) => void;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isDateInOpenPeriod(date: Date, periods: AccountingPeriod[]): boolean {
  const iso = toIsoDate(date);
  return periods.some((p) => iso >= p.startDate && iso <= p.endDate);
}

function OpenPeriodDatePicker({ value, onChange }: OpenPeriodDatePickerProps) {
  const { data: openPeriods, isLoading } = useOpenPeriods();
  const initial = value ? parseIsoDate(value) : new Date();
  const [viewMonth, setViewMonth] = useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1),
  );

  const monthLabel = viewMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const days = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<Date | null> = [];
    for (let i = 0; i < firstDay; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(new Date(year, month, day));
    }
    return cells;
  }, [viewMonth]);

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded border bg-muted" />;
  }

  if (!openPeriods?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No open accounting periods. Seed COA and periods first.
      </p>
    );
  }

  return (
    <div className="rounded-md border p-3">
      <div className="mb-3 flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          onClick={() =>
            setViewMonth(
              (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1),
            )
          }
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">{monthLabel}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Next month"
          onClick={() =>
            setViewMonth(
              (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1),
            )
          }
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, index) => {
          if (!day) return <span key={`empty-${index}`} />;
          const iso = toIsoDate(day);
          const selectable = isDateInOpenPeriod(day, openPeriods);
          const selected = value === iso;
          return (
            <button
              key={iso}
              type="button"
              disabled={!selectable}
              onClick={() => onChange(iso)}
              className={`h-9 rounded text-sm font-mono tabular-nums ${
                selected
                  ? "bg-primary text-primary-foreground"
                  : selectable
                    ? "hover:bg-accent"
                    : "cursor-not-allowed text-muted-foreground/40"
              }`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
      {value && (
        <p className="mt-3 text-xs text-muted-foreground">
          Selected: <span className="font-mono tabular-nums">{value}</span>
        </p>
      )}
    </div>
  );
}

export { OpenPeriodDatePicker };
