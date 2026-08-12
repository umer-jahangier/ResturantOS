"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { useOpenPeriods } from "@/lib/hooks/finance/use-periods";
import { formatIsoDateLong, localIsoToday } from "@/lib/utils/open-period-entry-date";
import type { AccountingPeriod } from "@/lib/models/finance.model";

interface OpenPeriodDatePickerProps {
  value: string;
  onChange: (isoDate: string) => void;
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

/** "2026-08" → Date(2026, 7, 1). Month keys are compared and shifted as strings elsewhere. */
function monthKeyToDate(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, 1);
}

function shiftMonthKey(key: string, delta: number): string {
  const d = monthKeyToDate(key);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function OpenPeriodDatePicker({ value, onChange }: OpenPeriodDatePickerProps) {
  const periodsQuery = useOpenPeriods();
  const { data: openPeriods, isLoading } = periodsQuery;

  /*
   * The month on show used to be `useState(() => new Date(initial…))`, seeded from `value` on the
   * FIRST render — the render where `value` is still "" because the open-periods query has not
   * resolved. The initialiser never runs again, so the calendar stayed parked on the current month
   * while the form went on to select a date in a completely different one. That is the whole of
   * the walkthrough's screenshot: a grid headed "August 2026" in which every cell is disabled,
   * over the words "Selected: 2025-08-01". The selection was never on screen.
   *
   * So the view now FOLLOWS the value, and state holds only the user's own chevron navigation.
   * Deriving instead of mirroring means there is no stale copy to go out of date.
   */
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const anchorMonthKey = monthOverride ?? (value ? value.slice(0, 7) : localIsoToday().slice(0, 7));
  const viewMonth = useMemo(() => monthKeyToDate(anchorMonthKey), [anchorMonthKey]);

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

  // GA-001 shape 2, live in this file until now: `isError` was never destructured, so a
  // finance-service outage fell through to `!openPeriods?.length` and told the accountant their
  // books have no open periods — advice ("Seed COA and periods first") that would be actively
  // wrong to follow. Error is answered before empty, always.
  if (periodsQuery.isError) {
    return (
      <QueryErrorNotice
        what="the open accounting periods"
        error={periodsQuery.error}
        onRetry={() => void periodsQuery.refetch()}
        isRetrying={periodsQuery.isFetching}
      />
    );
  }

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Loading open accounting periods"
        className="h-64 animate-pulse rounded-md border bg-muted"
      />
    );
  }

  if (!openPeriods?.length) {
    return (
      <p className="rounded-md border border-dashed p-3 text-body text-muted-foreground">
        No accounting period is open, so an entry cannot be dated. Open or provision a period on
        the Periods screen first.
      </p>
    );
  }

  const todayIso = localIsoToday();

  return (
    <div className="rounded-md border p-3">
      <div className="mb-3 flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          onClick={() => setMonthOverride(shiftMonthKey(anchorMonthKey, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-body font-medium">{monthLabel}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Next month"
          onClick={() => setMonthOverride(shiftMonthKey(anchorMonthKey, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-label text-muted-foreground">
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
          const isToday = iso === todayIso;
          return (
            <button
              key={iso}
              type="button"
              disabled={!selectable}
              onClick={() => onChange(iso)}
              aria-pressed={selected}
              aria-label={
                selectable
                  ? formatIsoDateLong(iso)
                  : `${formatIsoDateLong(iso)} — not in an open accounting period`
              }
              title={selectable ? undefined : "Not in an open accounting period"}
              className={`h-9 rounded-lg font-mono text-body tabular-nums ${
                selected
                  ? "bg-primary text-primary-foreground"
                  : selectable
                    ? "hover:bg-accent"
                    : "cursor-not-allowed text-muted-foreground/40"
              } ${isToday && !selected ? "ring-1 ring-border-interactive" : ""}`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
      {value && (
        <p className="mt-3 text-small text-muted-foreground">
          Selected: <span className="font-medium text-foreground">{formatIsoDateLong(value)}</span>
        </p>
      )}
    </div>
  );
}

export { OpenPeriodDatePicker };
