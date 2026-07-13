"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface PeriodRange {
  from: string;
  to: string;
}

type Preset = "this-month" | "last-month" | "last-90-days" | "this-quarter" | "custom";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** PUR-06: analytics period presets. Kept in one place so page + tests agree on the math. */
export function thisMonthRange(): PeriodRange {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

function lastMonthRange(): PeriodRange {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: isoDate(from), to: isoDate(to) };
}

function last90DaysRange(): PeriodRange {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 89);
  return { from: isoDate(from), to: isoDate(now) };
}

function thisQuarterRange(): PeriodRange {
  const now = new Date();
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const from = new Date(now.getFullYear(), quarterStartMonth, 1);
  const to = new Date(now.getFullYear(), quarterStartMonth + 3, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

const PRESET_RANGES: Record<Exclude<Preset, "custom">, () => PeriodRange> = {
  "this-month": thisMonthRange,
  "last-month": lastMonthRange,
  "last-90-days": last90DaysRange,
  "this-quarter": thisQuarterRange,
};

const PRESET_OPTIONS: { value: Preset; label: string }[] = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "last-90-days", label: "Last 90 days" },
  { value: "this-quarter", label: "This quarter" },
  { value: "custom", label: "Custom" },
];

/** PUR-06: period selector for the spend analytics page. Presets + a custom from/to fallback. */
export function PeriodPicker({
  value,
  onChange,
  className,
}: {
  value: PeriodRange;
  onChange: (range: PeriodRange) => void;
  className?: string;
}) {
  const [preset, setPreset] = useState<Preset>("this-month");

  function handlePresetChange(next: Preset) {
    setPreset(next);
    if (next === "custom") {
      return;
    }
    onChange(PRESET_RANGES[next]());
  }

  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Period
        <select
          aria-label="Analytics period"
          value={preset}
          onChange={(e) => handlePresetChange(e.target.value as Preset)}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {preset === "custom" && (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <Input
              type="date"
              aria-label="Custom period from"
              value={value.from}
              max={value.to}
              onChange={(e) => onChange({ from: e.target.value, to: value.to })}
              className="w-36"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <Input
              type="date"
              aria-label="Custom period to"
              value={value.to}
              min={value.from}
              onChange={(e) => onChange({ from: value.from, to: e.target.value })}
              className="w-36"
            />
          </label>
        </>
      )}
    </div>
  );
}
