import type { z } from "zod";
import type {
  apiCoverageSchema,
  apiIngredientSchema,
  apiItemCategoryNodeSchema,
  apiItemCategorySchema,
  apiMenuItemCatalogSchema,
  apiMenuItemCoverageSchema,
  apiRecipeCostPreviewSchema,
  apiRecipeSchema,
  apiStockLevelSchema,
  apiStockLevelsResponseSchema,
  apiUomSchema,
  createIngredientInputSchema,
  createItemCategoryInputSchema,
  createRecipeInputSchema,
  moveItemCategoryInputSchema,
  previewRecipeCostInputSchema,
  updateIngredientInputSchema,
  updateItemCategoryInputSchema,
} from "@/lib/api-client/schemas/inventory.schema";

export type MenuItemCatalogEntry = z.infer<typeof apiMenuItemCatalogSchema>;
export type Ingredient = z.infer<typeof apiIngredientSchema>;
export type Uom = z.infer<typeof apiUomSchema>;
export type Recipe = z.infer<typeof apiRecipeSchema>;
/** Write payload for `POST /api/v1/inventory/recipes` (mirrors the create-recipe request). */
export type RecipeInput = z.infer<typeof createRecipeInputSchema>;
export type Coverage = z.infer<typeof apiCoverageSchema>;

// ── Item categories ─────────────────────────────────────────────────────────────────────────
export type ItemCategory = z.infer<typeof apiItemCategorySchema>;
export type ItemCategoryNode = z.infer<typeof apiItemCategoryNodeSchema>;
/** Write payload for `POST /api/v1/inventory/categories`. */
export type CreateItemCategoryInput = z.infer<typeof createItemCategoryInputSchema>;
/** Write payload for `PUT /api/v1/inventory/categories/{id}`. */
export type UpdateItemCategoryInput = z.infer<typeof updateItemCategoryInputSchema>;
/** Write payload for `PUT /api/v1/inventory/categories/{id}/parent`. */
export type MoveItemCategoryInput = z.infer<typeof moveItemCategoryInputSchema>;

// ── Ingredients ──────────────────────────────────────────────────────────────────────────────
/** Write payload for `POST /api/v1/inventory/ingredients`. */
export type IngredientInput = z.infer<typeof createIngredientInputSchema>;
/** Write payload for `PUT /api/v1/inventory/ingredients/{id}`. */
export type UpdateIngredientInput = z.infer<typeof updateIngredientInputSchema>;

// ── Stock levels ─────────────────────────────────────────────────────────────────────────────
export type StockLevel = z.infer<typeof apiStockLevelSchema>;
export type StockLevelsResponse = z.infer<typeof apiStockLevelsResponseSchema>;

// ── Recipe cost preview / coverage ───────────────────────────────────────────────────────────
export type RecipeCostPreview = z.infer<typeof apiRecipeCostPreviewSchema>;
/** Write payload for `POST /api/v1/inventory/recipes/preview`. */
export type PreviewRecipeCostInput = z.infer<typeof previewRecipeCostInputSchema>;
export type MenuItemCoverage = z.infer<typeof apiMenuItemCoverageSchema>;
/** The three-state coverage classification — import the union from here, never re-declare it. */
export type CoverageState = "COVERED" | "SCHEDULED" | "NO_RECIPE";

export function adaptMenuItemCatalogEntry(raw: MenuItemCatalogEntry): MenuItemCatalogEntry {
  return raw;
}

export function adaptIngredient(raw: Ingredient): Ingredient {
  return raw;
}

export function adaptUom(raw: Uom): Uom {
  return raw;
}

export function adaptRecipe(raw: Recipe): Recipe {
  return raw;
}

export function adaptCoverage(raw: Coverage): Coverage {
  return raw;
}

export function adaptItemCategory(raw: ItemCategory): ItemCategory {
  return raw;
}

export function adaptItemCategoryNode(raw: ItemCategoryNode): ItemCategoryNode {
  return raw;
}

export function adaptStockLevel(raw: StockLevel): StockLevel {
  return raw;
}

export function adaptStockLevelsResponse(raw: StockLevelsResponse): StockLevelsResponse {
  return raw;
}

export function adaptRecipeCostPreview(raw: RecipeCostPreview): RecipeCostPreview {
  return raw;
}
