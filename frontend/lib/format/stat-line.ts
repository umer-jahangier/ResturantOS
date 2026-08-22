/**
 * The demo's back-office subtitle, as a function rather than as a template people retype.
 *
 * <h3>What it is</h3>
 *
 * Every one of `Docs/NEXUS_ERP_Demo.html`'s eleven back-office screens states its scale in one
 * `·`-separated line beneath the title — `138 ingredients · 5 alerts · Last count: Today 08:00`.
 * Measured, the shape is always **[scale] · [exception] · [freshness]**, and its value is that a
 * reader knows the size and the health of a list before their eyes reach it.
 *
 * <h3>Why a helper and not a template literal</h3>
 *
 * Because the parts are conditional. "5 alerts" must not render when there are none, and
 * "Last count: —" must not render at all — a freshness fact this system cannot compute is an
 * absence, not a placeholder (D-38-16). Hand-written, that is
 * `[a, b && c, d ? e : ""].filter(Boolean).join(" · ")` re-typed per screen, and the first time
 * someone writes `${a} · ${b}` unconditionally the product ships `12 vendors ·  · `.
 *
 * <h3>The rule this file exists to enforce (plan 38-07)</h3>
 *
 * <b>A subtitle must reconcile with the grid beneath it.</b> A line reading "138 ingredients"
 * above a table showing 42 is worse than no line: the reader now distrusts both numbers and has
 * no way to tell which one is lying. So callers derive every count from the SAME array they hand
 * to `DataGrid`, and where a filter has narrowed that array they say so ("42 of 138 shown").
 * {@link countLine} exists so that sentence has one spelling.
 */

import { formatNumber } from "@/lib/format/locale";
export function statLine(...parts: Array<string | false | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ");
}

/** `1 vendor` / `12 vendors` — the scale part, pluralised without a second `if` at each site. */
export function countLine(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

/**
 * The scale part when a filter is narrowing the list: `42 of 138 ingredients`.
 *
 * <p>Both numbers are stated because the alternative — silently showing the filtered count —
 * makes a filtered screen and an empty warehouse look identical.
 */
export function filteredCountLine(
  shown: number,
  total: number,
  singular: string,
  plural = `${singular}s`,
): string {
  if (shown === total) return countLine(total, singular, plural);
  return `${formatNumber(shown)} of ${formatNumber(total)} ${total === 1 ? singular : plural}`;
}
