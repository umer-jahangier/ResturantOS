import { z } from "zod";

/**
 * Wire shape of a branch's service-charge policy (F20).
 *
 * ```
 * GET /api/v1/pos/branches/{branchId}/service-charge   pos.menu.view
 * PUT /api/v1/pos/branches/{branchId}/service-charge   pos.service_charge.manage
 * ```
 *
 * `ratePct` arrives as a JSON number from Jackson's BigDecimal serialisation but is declared to
 * accept a string too, exactly as `apiTaxClassSchema.ratePct` already does — a BigDecimal is
 * configured per-service to serialise either way and a schema that only accepts one of them
 * empties the screen the day that setting differs.
 *
 * The GET never 404s: a branch nobody has configured answers with `enabled: false`, which is a
 * real policy and not an absence. That is what lets the screen render one form for both cases
 * instead of an empty state it would then have to explain.
 */
export const apiServiceChargePolicySchema = z.object({
  branchId: z.string().uuid(),
  enabled: z.boolean(),
  ratePct: z.string().or(z.number()).transform(Number),
  label: z.string(),
  dineIn: z.boolean(),
  takeaway: z.boolean(),
  pickup: z.boolean(),
  /**
   * Whether THIS caller may change it. The server answers it because the server owns the
   * permission catalogue; the screen renders read-only rather than refusing the page, so a
   * manager asked "why is there 5% on my bill" can look the answer up.
   */
  canManage: z.boolean(),
});

export type ApiServiceChargePolicy = z.infer<typeof apiServiceChargePolicySchema>;

/**
 * PUT is a REPLACE — every field, every time. Same contract, and the same reason, as
 * `updateTaxClassInputSchema`: this codebase has already paid once for a tax field destroyed by a
 * client that omitted it.
 *
 * `ratePct` is required even when `enabled` is false, so switching the charge back on later shows
 * the rate it used to be rather than a blank the user has to re-derive. The server refuses
 * `enabled` at 0% and refuses `enabled` with no channel selected, each naming the field.
 */
export const updateServiceChargeInputSchema = z.object({
  enabled: z.boolean(),
  ratePct: z.number().min(0).max(100),
  label: z.string().min(1).max(60),
  dineIn: z.boolean(),
  takeaway: z.boolean(),
  pickup: z.boolean(),
});
export type UpdateServiceChargeInput = z.infer<typeof updateServiceChargeInputSchema>;
