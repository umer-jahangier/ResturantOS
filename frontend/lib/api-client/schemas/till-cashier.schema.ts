import { z } from "zod";

/**
 * Layer-1 (§7.2.5): the RAW wire shape of pos-service's `EligibleCashierDto` — one person a duty
 * manager may open a cash drawer for at this branch (F11).
 *
 * <p>Lives in its own file rather than in `pos.schema.ts` for the reason `order-bill.schema.ts`
 * does: it belongs to a distinct endpoint with its own permission
 * (`GET /api/v1/pos/tills/cashiers`, gated on `pos.till.open.other`), and keeping it separate keeps
 * the till-session shapes readable.
 *
 * <p>Not `strictObject` — a later plan adding a field to the row must not blank the picker. Every
 * field below is REQUIRED though, because each one is load-bearing on screen: a row with no
 * `userId` cannot be selected, and one with no `name` renders as an empty, unclickable line.
 */
export const apiEligibleCashierSchema = z.object({
  userId: z.string().uuid(),
  /** Full name, already falling back to the login address server-side. Never blank. */
  name: z.string(),
  email: z.string(),
  /** Their role AT THIS BRANCH — a person can hold a different one elsewhere. */
  roleCode: z.string(),
  /** They already hold an open drawer; opening a second one would be refused. */
  hasOpenTill: z.boolean(),
});

export const apiEligibleCashierListSchema = z.array(apiEligibleCashierSchema);

export type ApiEligibleCashier = z.infer<typeof apiEligibleCashierSchema>;
