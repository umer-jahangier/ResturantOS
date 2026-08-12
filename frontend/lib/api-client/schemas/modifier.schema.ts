import { z } from "zod";

/**
 * Layer-1 wire schemas for the modifier catalogue (S6) — "no chilli", "extra cheese +Rs 150".
 *
 * <h3>Money is an integer here and stays one</h3>
 *
 * `priceDeltaPaisa` is BIGINT paisa on the wire and `z.number().int()` here. It is deliberately
 * SIGNED: "no cheese, -Rs 50" is as real as "extra cheese, +Rs 150". Nothing in this file, the
 * adapter, or the dialog divides it by 100 — rendering goes through the shared money formatter,
 * which is the only reason the screen, the printed bill and the ledger agree to the paisa.
 */
export const apiModifierOptionSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  name: z.string(),
  priceDeltaPaisa: z.number().int(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});

export type ApiModifierOption = z.infer<typeof apiModifierOptionSchema>;

/**
 * `required` and `minSelect` are the same fact and the server keeps them in agreement (a CHECK
 * constraint as well as a service rule). Both are on the wire because the dialog renders the word
 * "Required" and the validator reads the number.
 *
 * `optionCount` counts LIVE options including retired ones — the number the manage screen prints
 * so "choose 2 of 1" is visible before it is saved.
 */
export const apiModifierGroupSchema = z.object({
  id: z.string().uuid(),
  menuItemId: z.string().uuid(),
  name: z.string(),
  required: z.boolean(),
  minSelect: z.number().int(),
  maxSelect: z.number().int(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  optionCount: z.number().int(),
  options: z.array(apiModifierOptionSchema),
});

export type ApiModifierGroup = z.infer<typeof apiModifierGroupSchema>;

export const createModifierGroupInputSchema = z.object({
  name: z.string().min(1).max(100),
  required: z.boolean(),
  minSelect: z.number().int().min(0).max(50),
  maxSelect: z.number().int().min(1).max(50),
  sortOrder: z.number().int().optional(),
});
export type CreateModifierGroupInput = z.infer<typeof createModifierGroupInputSchema>;

/**
 * PUT is a REPLACE — `sortOrder` and `active` are REQUIRED here for the reason
 * `updateMenuItemInputSchema` makes `taxRateCode` required: an omitted key read as "clear it"
 * destroys configuration on an unrelated rename, and this codebase has already paid for that once.
 */
export const updateModifierGroupInputSchema = createModifierGroupInputSchema.extend({
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type UpdateModifierGroupInput = z.infer<typeof updateModifierGroupInputSchema>;

export const createModifierInputSchema = z.object({
  name: z.string().min(1).max(100),
  priceDeltaPaisa: z.number().int(),
  sortOrder: z.number().int().optional(),
});
export type CreateModifierInput = z.infer<typeof createModifierInputSchema>;

export const updateModifierInputSchema = createModifierInputSchema.extend({
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type UpdateModifierInput = z.infer<typeof updateModifierInputSchema>;
