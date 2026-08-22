"use client";

import { useUoms } from "@/lib/hooks/inventory/use-inventory";
import type { Uom } from "@/lib/adapters/inventory.adapter";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50";

interface UomSelectProps {
  value: string;
  onChange: (code: string) => void;
  onBlur?: () => void;
  name?: string;
  /** Restrict to one dimension (WEIGHT / VOLUME / COUNT) when the caller knows it. */
  measureType?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

/**
 * Picks a unit from the tenant's own `units_of_measure` registry instead of accepting whatever
 * someone types.
 *
 * <p>Free-text units were not only a data-entry annoyance. Inventory converts a goods receipt into
 * the ingredient's stock unit by looking the code up in this exact registry — so a vendor catalog
 * row saved with "kgs" or "Kilogram" resolves to nothing, the receipt is taken at face value, and
 * the ingredient's quantity and moving-average cost are wrong by whatever the conversion would
 * have been. Typing the unit and converting by the unit are the same list; this makes them the
 * same list in the UI too.
 *
 * <p>A value that is not in the registry is still offered as an option rather than dropped: a row
 * saved before this existed must remain editable without silently blanking its unit on the next
 * save. It is marked so the person editing can see it needs fixing.
 */
export function UomSelect({
  value,
  onChange,
  onBlur,
  name,
  measureType,
  placeholder = "Select a unit…",
  disabled,
  "aria-label": ariaLabel,
}: UomSelectProps) {
  const { data: uoms, isLoading, isError } = useUoms();

  const available: Uom[] = measureType
    ? (uoms ?? []).filter((u) => u.measureType === measureType)
    : (uoms ?? []);

  const isKnown = available.some((u) => u.code === value);
  // A failed registry is not a registry with nothing in it, so a value cannot be judged "legacy"
  // against a list that never arrived — see the placeholder below.
  const hasLegacyValue = value !== "" && !isKnown && !isLoading && !isError;

  return (
    <select
      name={name}
      aria-label={ariaLabel}
      className={selectClass}
      value={value}
      disabled={disabled || isError}
      aria-invalid={isError || undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    >
      {/*
       * Three placeholders, not two (UI-SPEC §8).
       *
       * When `useUoms` FAILED this rendered "Select a unit…" over an empty option list — a
       * control that looks operable, offers nothing, and tells a person their tenant has no units
       * configured. That is GA-001 inside a `<select>`, and on this particular control it is
       * worse than a cosmetic lie: the docblock above explains that a goods receipt is converted
       * by looking the code up in this exact registry, so a row saved while the list was
       * unreachable is a quantity and a moving-average cost that are silently wrong.
       *
       * The select is DISABLED on failure rather than left inert-looking, so the form cannot be
       * completed against a registry the product could not read.
       */}
      <option value="">
        {isLoading ? "Loading units…" : isError ? "Unit list unavailable" : placeholder}
      </option>
      {hasLegacyValue ? <option value={value}>{value} — not a unit in your list</option> : null}
      {available.map((u) => (
        <option key={u.id} value={u.code}>
          {u.code} · {u.name}
        </option>
      ))}
    </select>
  );
}
