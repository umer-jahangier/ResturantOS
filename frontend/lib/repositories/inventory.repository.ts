import { get, post } from "@/lib/api-client/request";
import {
  apiCoverageSchema,
  apiIngredientSchema,
  apiMenuItemCatalogSchema,
  apiRecipeSchema,
  apiUomSchema,
  createRecipeInputSchema,
} from "@/lib/api-client/schemas/inventory.schema";
import {
  adaptCoverage,
  adaptIngredient,
  adaptMenuItemCatalogEntry,
  adaptRecipe,
  adaptUom,
} from "@/lib/adapters/inventory.adapter";
import type {
  Coverage,
  Ingredient,
  MenuItemCatalogEntry,
  Recipe,
  RecipeInput,
  Uom,
} from "@/lib/adapters/inventory.adapter";

export const InventoryRepository = {
  /** 08.1-02: the synced menu-item catalog, driving the recipe-builder's menu-item picker. */
  async listMenuItems(): Promise<MenuItemCatalogEntry[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/menu-items");
    return (raw ?? []).map((mi) => adaptMenuItemCatalogEntry(apiMenuItemCatalogSchema.parse(mi)));
  },

  async listIngredients(): Promise<Ingredient[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/ingredients");
    return (raw ?? []).map((i) => adaptIngredient(apiIngredientSchema.parse(i)));
  },

  async listUoms(): Promise<Uom[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/uom");
    return (raw ?? []).map((u) => adaptUom(apiUomSchema.parse(u)));
  },

  /** Create a new recipe version (INV-10). Rejects an empty `lines` array before any network call. */
  async createRecipe(input: RecipeInput): Promise<Recipe> {
    const raw = await post("/api/v1/inventory/recipes", createRecipeInputSchema.parse(input));
    return adaptRecipe(apiRecipeSchema.parse(raw));
  },

  async listRecipeVersions(menuItemId: string): Promise<Recipe[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/recipes", { menuItemId });
    return (raw ?? []).map((r) => adaptRecipe(apiRecipeSchema.parse(r)));
  },

  /** 08.1-03 (INV-11): recipe-coverage report for the coverage dashboard. */
  async getCoverage(): Promise<Coverage> {
    const raw = await get("/api/v1/inventory/recipes/coverage");
    return adaptCoverage(apiCoverageSchema.parse(raw));
  },
};
