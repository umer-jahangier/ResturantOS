"use client";

import type { StationType } from "@/lib/models/pos.model";

/**
 * The station type control (D-28-01).
 *
 * <h3>Why this is a fixed select and never a text input</h3>
 *
 * A type decides which physical screen a station's tickets appear on. Free text is how one
 * restaurant ends up with "Bar", "bar" and "BAR " as three different stations, two of which
 * nobody is watching — and the drinks on them are never made. The values are a closed Java enum
 * and a database CHECK constraint (plan 28-02); this control exists so an admin is offered the
 * list rather than guessing at it, not as the guard. The guard is the constraint.
 *
 * <h3>Five types, three screens</h3>
 *
 * Shown per option, because the distinction is not obvious and getting it wrong is expensive.
 * Naming a DESSERT station does not create a fourth display — its tickets land on the kitchen
 * screen alongside the hot line. An admin choosing between the kitchen-family types is naming a
 * station, not creating a screen, and the option text says so.
 */

export const STATION_TYPE_OPTIONS: {
  value: StationType;
  label: string;
  screen: string;
  hint: string;
}[] = [
  {
    value: "KITCHEN",
    label: "Kitchen",
    screen: "Kitchen screen",
    hint: "The hot line. This is what every station in the product was before station types existed.",
  },
  {
    value: "BAR",
    label: "Bar",
    screen: "Bar screen",
    hint: "Drinks. Bar tickets go to their own screen and never land on the kitchen board.",
  },
  {
    value: "PANTRY",
    label: "Pantry",
    screen: "Kitchen screen",
    hint: "Cold prep, salads and sides. Shares the kitchen screen with the hot line.",
  },
  {
    value: "EXPO",
    label: "Expo (the pass)",
    screen: "Expo screen",
    hint: "The pass, where a whole order is assembled before it goes out.",
  },
  {
    value: "DESSERT",
    label: "Dessert",
    screen: "Kitchen screen",
    hint: "The sweet station. Shares the kitchen screen.",
  },
];

const OPTION_BY_VALUE = new Map(STATION_TYPE_OPTIONS.map((o) => [o.value, o]));

export function stationTypeLabel(type: StationType): string {
  return OPTION_BY_VALUE.get(type)?.label ?? type;
}

export function stationTypeScreen(type: StationType): string {
  return OPTION_BY_VALUE.get(type)?.screen ?? "Kitchen screen";
}

export function StationTypeSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: StationType;
  onChange: (next: StationType) => void;
  disabled?: boolean;
}) {
  const selected = OPTION_BY_VALUE.get(value);

  return (
    <div className="space-y-1.5">
      <select
        id={id}
        data-testid="station-type-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as StationType)}
        className="h-8 w-full rounded-lg border border-border-interactive bg-transparent px-2.5 text-small transition-colors focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 dark:bg-surface-2"
      >
        {STATION_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} — {option.screen}
          </option>
        ))}
      </select>
      {selected ? (
        <p data-testid="station-type-hint" className="text-label text-muted-foreground">
          {selected.hint}
        </p>
      ) : null}
    </div>
  );
}
