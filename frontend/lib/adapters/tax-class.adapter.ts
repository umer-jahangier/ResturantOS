import type { ApiTaxClass } from "@/lib/api-client/schemas/tax-class.schema";
import type { TaxClass, TaxSource } from "@/lib/models/tax-class.model";

const TAX_SOURCES = new Set<TaxSource>(["ITEM", "CATEGORY", "ITEM_CUSTOM", "NONE"]);

/**
 * An unrecognised source degrades to NONE rather than throwing.
 *
 * <p>`source` is a LABEL — it decides whether the screen writes "Follows Mains" or "Set on this
 * item" beside a rate the server has already resolved. It is not the rate and it is not a
 * security control, so throwing on an unknown value would empty a whole menu screen over a
 * caption. Same trade `adaptItemRoute` makes for routing sources.
 */
export function adaptTaxSource(raw: string | null | undefined): TaxSource {
  const upper = raw?.toUpperCase();
  return upper && TAX_SOURCES.has(upper as TaxSource) ? (upper as TaxSource) : "NONE";
}

export function adaptTaxClass(raw: ApiTaxClass): TaxClass {
  return {
    id: raw.id,
    code: raw.code,
    name: raw.name,
    ratePct: raw.ratePct,
    active: raw.active,
    // Absent counts mean "not reported", and the safe reading of that is ZERO USES — the number
    // is only ever used to WARN before a delete, and the server refuses a delete that would
    // orphan a menu regardless. Defaulting high would print a scary count nothing measured.
    categoryCount: raw.categoryCount ?? 0,
    itemCount: raw.itemCount ?? 0,
  };
}

/**
 * How a rate is written next to a dish. One function so the Menu screen, the item dialog and the
 * category dialog cannot drift into three phrasings of the same fact.
 */
export function formatTaxRate(ratePct: number): string {
  return `${ratePct.toFixed(2)}%`;
}
