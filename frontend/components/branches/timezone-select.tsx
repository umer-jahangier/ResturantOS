"use client";

import { useMemo } from "react";

import { Combobox } from "@/components/ui/combobox";
import type { SelectOption } from "@/components/ui/select";

/**
 * The branch's IANA time zone, chosen from a list rather than typed.
 *
 * <h2>Why this is a picker and not a text input</h2>
 *
 * <p>A branch's zone is not cosmetic: `reporting-service/BusinessDay.java` cuts the trading day on
 * it (`occurredAt.atZone(branchZone)`), so a value Java cannot resolve puts every order, till
 * session and report on that branch onto a date nothing can compute. `/app/settings` offers a free
 * text box with the placeholder `Asia/Karachi` and nothing between the user and `PKT`, `GMT+5` or
 * `Pakistan Time` — none of which is an IANA name.
 *
 * <p>The server now refuses a zone it cannot resolve (`BranchService.requireZone`), which is where
 * that rule belongs. This is the other half: making the wrong answer unreachable rather than
 * merely refused, so nobody has to discover the rule by tripping it.
 *
 * <h2>Where the list comes from</h2>
 *
 * <p>`Intl.supportedValuesOf("timeZone")` — the browser's own zone database, so it is exactly the
 * set the platform can resolve and it does not go stale in a hard-coded array. It has been in
 * every evergreen browser since 2022. Where it is missing the component falls back to a short
 * regional list plus whatever value the branch already holds, so an existing zone is never
 * silently dropped from the control that edits it.
 */

const FALLBACK_ZONES = [
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "UTC",
];

/** Every zone this browser can resolve, with `current` guaranteed present. */
export function timezoneOptions(current?: string | null): SelectOption[] {
  let zones: string[];
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    zones = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : FALLBACK_ZONES;
  } catch {
    zones = FALLBACK_ZONES;
  }
  if (current && !zones.includes(current)) {
    zones = [current, ...zones];
  }
  return zones.map((zone) => ({ value: zone, label: zone.replace(/_/g, " ") }));
}

export function TimezoneSelect({
  id,
  value,
  onChange,
  disabled,
  "aria-invalid": ariaInvalid,
  "aria-describedby": describedBy,
}: {
  id?: string;
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const options = useMemo(() => timezoneOptions(value), [value]);

  return (
    <Combobox
      id={id}
      options={options}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      placeholder="Search time zones…"
      emptyLabel="No time zone matches that"
      aria-invalid={ariaInvalid}
      aria-describedby={describedBy}
    />
  );
}
