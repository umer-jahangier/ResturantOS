import type { ApiEligibleCashier } from "@/lib/api-client/schemas/till-cashier.schema";
import type { EligibleCashier } from "@/lib/models/till-cashier.model";

/**
 * Layer-2 (§7.2.5): wire row → domain row for the "open a drawer for…" picker (F11).
 *
 * <p>A straight field map today, and it stays a function anyway: the boundary is what lets the
 * wire shape change without every consumer changing with it, and the ESLint layer rule is what
 * keeps repositories from handing raw `z.infer` types to hooks.
 */
export function adaptEligibleCashier(raw: ApiEligibleCashier): EligibleCashier {
  return {
    userId: raw.userId,
    name: raw.name,
    email: raw.email,
    roleCode: raw.roleCode,
    hasOpenTill: raw.hasOpenTill,
  };
}
