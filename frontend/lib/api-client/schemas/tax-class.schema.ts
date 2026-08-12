import { z } from "zod";

/**
 * Wire shape of the tenant's sales-tax catalogue (F16).
 *
 * ```
 * GET    /api/v1/pos/tax-classes        pos.menu.view
 * POST   /api/v1/pos/tax-classes        pos.tax.manage
 * PUT    /api/v1/pos/tax-classes/{id}   pos.tax.manage
 * DELETE /api/v1/pos/tax-classes/{id}   pos.tax.manage
 * ```
 *
 * `ratePct` arrives as a JSON number from Jackson's BigDecimal serialisation but is declared to
 * accept a string too, exactly as `apiMenuItemSchema.taxRatePct` already does — a BigDecimal is
 * configured per-service to serialise either way and a schema that only accepts one of them
 * empties the screen the day that setting differs.
 */
export const apiTaxClassSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  ratePct: z
    .string()
    .or(z.number())
    .transform(Number),
  active: z.boolean(),
  /** How many categories inherit this class, and how many items override to it. */
  categoryCount: z.number().int().nonnegative().optional(),
  itemCount: z.number().int().nonnegative().optional(),
});

export type ApiTaxClass = z.infer<typeof apiTaxClassSchema>;

/**
 * `ratePct` is REQUIRED on create, including when it is zero.
 *
 * A zero-rated class is a real thing (exempt food, exports); a class whose rate nobody filled in
 * is not. Making the field optional would let the second masquerade as the first — the absent-vs-
 * zero confusion that produced the defect this feature closes.
 */
export const createTaxClassInputSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  ratePct: z.number().min(0).max(100),
});
export type CreateTaxClassInput = z.infer<typeof createTaxClassInputSchema>;

/**
 * PUT is a REPLACE — every field, every time, `active` included. Same contract, and the same
 * reason, as `updateMenuItemInputSchema`: this codebase has already paid once for a tax field
 * destroyed by a client that omitted it.
 */
export const updateTaxClassInputSchema = createTaxClassInputSchema.extend({
  active: z.boolean(),
});
export type UpdateTaxClassInput = z.infer<typeof updateTaxClassInputSchema>;
