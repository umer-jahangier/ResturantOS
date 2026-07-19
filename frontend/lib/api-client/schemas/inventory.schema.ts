import { z } from "zod";

// `qty`/`yieldServings`/`yieldPct`/`reorderPoint`/`toBaseFactor` are backend BigDecimal fields
// (RecipeDtos.java / InventoryDtos.java) with no custom Jackson serializer, so the real API
// returns them as a JSON number (e.g. `100` or `12.5`), not a string — coerce either shape to a
// string so downstream qty/yield formatting has one consistent type (mirrors purchasing.schema's
// `qtyField`).
const qtyField = z.union([z.string(), z.number()]).transform((v) => String(v));

// Mirrors MenuItemCatalogDto (services/inventory-service .../dto/MenuItemCatalogDtos.java) — the
// 08.1-02 read-model synced from pos-service's menu catalog via MenuItemCatalogConsumer.
export const apiMenuItemCatalogSchema = z.object({
  menuItemId: z.string().uuid(),
  name: z.string(),
  categoryName: z.string().nullable().optional(),
  active: z.boolean(),
  basePricePaisa: z.number().int(),
});

// Mirrors InventoryDtos.IngredientDto exactly (id/name/sku/baseUomCode/category/reorderPoint/active).
export const apiIngredientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sku: z.string().nullable().optional(),
  baseUomCode: z.string(),
  category: z.string().nullable().optional(),
  reorderPoint: qtyField,
  active: z.boolean(),
});

// Mirrors InventoryDtos.UomDto (id/code/name/baseUnitCode/toBaseFactor) — returned by
// GET /api/v1/inventory/uom (UnitOfMeasureController).
export const apiUomSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  baseUnitCode: z.string().nullable().optional(),
  toBaseFactor: qtyField,
});

// One ingredient line in the create-recipe write payload — mirrors RecipeDtos.RecipeLineDto's
// writable fields (ingredientId, qty, uomCode, yieldPct). `qty`/`uomCode` are client-required;
// `yieldPct` is optional (server-side default applies when omitted).
export const recipeLineInputSchema = z.object({
  ingredientId: z.string().uuid(),
  qty: z.string().min(1, "Quantity is required"),
  uomCode: z.string().min(1, "Unit is required"),
  yieldPct: z.number().optional(),
});

// Mirrors the (implied) CreateRecipeRequest write payload for `POST /api/v1/inventory/recipes` —
// menuItemId + yieldServings + optional effectiveFrom/name + at least one ingredient line.
export const createRecipeInputSchema = z.object({
  menuItemId: z.string().uuid(),
  yieldServings: z.string().min(1, "Yield (servings) is required"),
  effectiveFrom: z.string().nullable().optional(),
  name: z.string().optional(),
  lines: z.array(recipeLineInputSchema).min(1, "Add at least one ingredient line"),
});

// Mirrors RecipeDtos.RecipeLineDto exactly (id/ingredientId/qty/uomCode/yieldPct).
export const apiRecipeLineSchema = z.object({
  id: z.string().uuid(),
  ingredientId: z.string().uuid(),
  qty: qtyField,
  uomCode: z.string(),
  yieldPct: qtyField.nullable().optional(),
});

// Mirrors RecipeDtos.RecipeDto exactly (id/menuItemId/version/current/effectiveFrom/
// yieldServings/name/lines).
export const apiRecipeSchema = z.object({
  id: z.string().uuid(),
  menuItemId: z.string().uuid(),
  version: z.number().int(),
  current: z.boolean(),
  effectiveFrom: z.string(),
  yieldServings: qtyField,
  name: z.string().nullable().optional(),
  lines: z.array(apiRecipeLineSchema),
});

// Mirrors RecipeDtos.MissingMenuItemDto (menuItemId/name) — one active catalog menu item with no
// effective recipe as of the report time (INV-11).
export const apiMissingMenuItemSchema = z.object({
  menuItemId: z.string().uuid(),
  name: z.string(),
});

// Mirrors RecipeDtos.CoverageResponse exactly (totalActiveMenuItems/covered/missing) — the
// GET /api/v1/inventory/recipes/coverage report (INV-11).
export const apiCoverageSchema = z.object({
  totalActiveMenuItems: z.number().int(),
  covered: z.number().int(),
  missing: z.array(apiMissingMenuItemSchema),
});
