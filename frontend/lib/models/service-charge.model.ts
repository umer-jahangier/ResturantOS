/**
 * One branch's service-charge policy (F20).
 *
 * The percentage every check at that branch is billed on top of the food, before tax. Computed
 * server-side inside the order transaction and snapshotted onto the order, so a bill reprinted
 * after a rate change still describes what the guest actually paid.
 */
export interface ServiceChargePolicy {
  branchId: string;
  /** Off is the default and the only safe one — see the V24 migration. */
  enabled: boolean;
  /** Percent, 0–100. Never a float near money: it multiplies paisa server-side via BigDecimal. */
  ratePct: number;
  /** What the guest reads on the paper. "Service charge" unless the branch renamed it. */
  label: string;
  /** Which channels it applies to. Dine-in only by default — a counter guest waits on themselves. */
  dineIn: boolean;
  takeaway: boolean;
  pickup: boolean;
  /** Whether the signed-in user may change it. False renders the screen read-only, not refused. */
  canManage: boolean;
}

/**
 * How a service charge is written wherever a rate is shown beside it. One function so the
 * settings screen, the charge page and the printed bill cannot drift into three phrasings.
 */
export function formatServiceChargeRate(ratePct: number): string {
  return `${ratePct.toFixed(2)}%`;
}
