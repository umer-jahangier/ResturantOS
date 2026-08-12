/**
 * One rate in the tenant's sales-tax catalogue (F16).
 *
 * A menu CATEGORY names one as its default and every item under it inherits; one item may
 * override. `usageCount` is what turns Delete from a button into an informed decision.
 */
export interface TaxClass {
  id: string;
  /** The tax authority's code — the bucket a return files under. Unique per tenant. */
  code: string;
  /** What a person calls it, and what the guest's bill prints. */
  name: string;
  /** Percent, 0–100. Never a float near money: it multiplies paisa server-side via BigDecimal. */
  ratePct: number;
  /** A retired class stops being OFFERED; the items already on it keep their rate. */
  active: boolean;
  categoryCount: number;
  itemCount: number;
}

/**
 * Where an item's rate came from. A caption, never a control — the server has already resolved
 * the rate itself.
 */
export type TaxSource = "ITEM" | "CATEGORY" | "ITEM_CUSTOM" | "NONE";
