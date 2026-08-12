import { z } from "zod";

/**
 * Layer-1 wire shapes for `GET /api/v1/pos/menu/routing?branchId=` (S1-01).
 *
 * <h3>Why this is not in `pos.schema.ts`</h3>
 *
 * Two reasons. The honest first one: `pos.schema.ts` was being rewritten by another change in the
 * same working tree, and a file-scoped commit cannot take half of a file. The better second one:
 * this is a per-branch routing PROJECTION, not the POS menu contract — the same split that already
 * puts `terminal.schema.ts` and `receipt-config.schema.ts` beside it rather than inside it.
 *
 * <h3>`source` is a plain string, not a `z.enum`</h3>
 *
 * Same rule the station schema records: an unrecognised value must not be a PARSE FAILURE,
 * because a parse failure on this response empties the whole screen. A sixth route source would
 * turn a cosmetic mislabel into an outage. The narrowing happens in the adapter, where an unknown
 * value degrades to a safe default.
 */

export const apiCategoryRouteSchema = z.object({
  categoryId: z.string().uuid(),
  categoryName: z.string(),
  sortOrder: z.number().int().nullable().optional(),
  active: z.boolean().nullable().optional(),
  /** The category's route AT THIS BRANCH. Null means it has none. */
  stationId: z.string().uuid().nullable().optional(),
  stationCode: z.string().nullable().optional(),
  stationName: z.string().nullable().optional(),
});
export type ApiCategoryRoute = z.infer<typeof apiCategoryRouteSchema>;

export const apiItemRouteSchema = z.object({
  itemId: z.string().uuid(),
  itemName: z.string(),
  categoryId: z.string().uuid().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  active: z.boolean().nullable().optional(),
  /** The item's OWN route at this branch — null means "follow the category". */
  stationId: z.string().uuid().nullable().optional(),
  /** Where it ACTUALLY fires, resolved server-side. Never re-derived on this side. */
  effectiveStationId: z.string().uuid().nullable().optional(),
  effectiveStationCode: z.string().nullable().optional(),
  effectiveStationName: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
});
export type ApiItemRoute = z.infer<typeof apiItemRouteSchema>;

export const apiMenuRoutingSchema = z.object({
  branchId: z.string().uuid(),
  categories: z.array(apiCategoryRouteSchema).nullable().optional(),
  items: z.array(apiItemRouteSchema).nullable().optional(),
});
export type ApiMenuRouting = z.infer<typeof apiMenuRoutingSchema>;

/**
 * The body both writes take. `stationId: null` is the CLEAR verb and is the reason this is
 * `.nullable()` rather than `.optional()` — pos-service reads a null station as "remove this
 * route", so "clear" is only expressible if null can actually be sent.
 */
export const assignStationInputSchema = z.object({
  stationId: z.string().uuid().nullable(),
});
export type AssignStationInput = z.infer<typeof assignStationInputSchema>;
