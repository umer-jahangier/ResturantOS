/**
 * An <input type="date"> yields a bare calendar date ("2026-07-22") carrying no timezone. Pinning
 * it to midnight *UTC* puts it ahead of local midnight in every positive-offset zone (PKT is
 * +05:00), so picking "today" produced an effectiveFrom up to a day in the future. Coverage counts
 * a menu item as covered only when `effective_from <= now()` (RecipeService.getCoverage), while the
 * versions table keys off `is_current` — so the recipe showed "Current: Yes" and the coverage count
 * never moved. Interpret the picked date as LOCAL midnight, which is always at or before now.
 *
 * Returns undefined for a partial/invalid value so the caller falls back to the server's
 * Instant.now() default instead of throwing a RangeError out of the submit handler.
 */
export function calendarDateToInstant(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const local = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(local.getTime()) ? undefined : local.toISOString();
}
