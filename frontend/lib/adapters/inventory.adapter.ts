import type { z } from "zod";
import type {
  apiCoverageSchema,
  apiIngredientSchema,
  apiMenuItemCatalogSchema,
  apiRecipeSchema,
  apiUomSchema,
  createRecipeInputSchema,
} from "@/lib/api-client/schemas/inventory.schema";

export type MenuItemCatalogEntry = z.infer<typeof apiMenuItemCatalogSchema>;
export type Ingredient = z.infer<typeof apiIngredientSchema>;
export type Uom = z.infer<typeof apiUomSchema>;
export type Recipe = z.infer<typeof apiRecipeSchema>;
/** Write payload for `POST /api/v1/inventory/recipes` (mirrors the create-recipe request). */
export type RecipeInput = z.infer<typeof createRecipeInputSchema>;
export type Coverage = z.infer<typeof apiCoverageSchema>;

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
