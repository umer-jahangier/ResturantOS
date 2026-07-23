import { get, post, put } from "@/lib/api-client/request";
import {
  apiCoverageSchema,
  apiIngredientSchema,
  apiItemCategoryNodeSchema,
  apiItemCategorySchema,
  apiMenuItemCatalogSchema,
  apiRecipeCostPreviewSchema,
  apiRecipeSchema,
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
import {
  adaptCoverage,
  adaptIngredient,
  adaptItemCategory,
  adaptItemCategoryNode,
  adaptMenuItemCatalogEntry,
  adaptRecipe,
  adaptRecipeCostPreview,
  adaptStockLevelsResponse,
  adaptUom,
} from "@/lib/adapters/inventory.adapter";
import type {
  Coverage,
  CreateItemCategoryInput,
  Ingredient,
  IngredientInput,
  ItemCategory,
  ItemCategoryNode,
  MenuItemCatalogEntry,
  MoveItemCategoryInput,
  PreviewRecipeCostInput,
  Recipe,
  RecipeCostPreview,
  RecipeInput,
  StockLevelsResponse,
  UpdateIngredientInput,
  UpdateItemCategoryInput,
  Uom,
} from "@/lib/adapters/inventory.adapter";

export interface IngredientListFilters {
  search?: string;
  categoryId?: string;
  status?: string;
}

export const InventoryRepository = {
  /** 08.1-02: the synced menu-item catalog, driving the recipe-builder's menu-item picker. */
  async listMenuItems(): Promise<MenuItemCatalogEntry[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/menu-items");
    return (raw ?? []).map((mi) => adaptMenuItemCatalogEntry(apiMenuItemCatalogSchema.parse(mi)));
  },

  // ── Item categories (INV-13) ─────────────────────────────────────────────────────────────
  async listCategories(includeArchived = false): Promise<ItemCategory[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/categories", { includeArchived });
    return (raw ?? []).map((c) => adaptItemCategory(apiItemCategorySchema.parse(c)));
  },

  async getCategoryTree(includeArchived = false): Promise<ItemCategoryNode[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/categories/tree", { includeArchived });
    return (raw ?? []).map((n) => adaptItemCategoryNode(apiItemCategoryNodeSchema.parse(n)));
  },

  async createCategory(input: CreateItemCategoryInput): Promise<ItemCategory> {
    const raw = await post(
      "/api/v1/inventory/categories",
      createItemCategoryInputSchema.parse(input),
    );
    return adaptItemCategory(apiItemCategorySchema.parse(raw));
  },

  async updateCategory(id: string, input: UpdateItemCategoryInput): Promise<ItemCategory> {
    const raw = await put(
      `/api/v1/inventory/categories/${id}`,
      updateItemCategoryInputSchema.parse(input),
    );
    return adaptItemCategory(apiItemCategorySchema.parse(raw));
  },

  async moveCategory(id: string, newParentId: string | null): Promise<ItemCategory> {
    const input: MoveItemCategoryInput = { newParentId };
    const raw = await put(
      `/api/v1/inventory/categories/${id}/parent`,
      moveItemCategoryInputSchema.parse(input),
    );
    return adaptItemCategory(apiItemCategorySchema.parse(raw));
  },

  /** D-04: archive is a POST sub-resource, never DELETE — nothing is destroyed. */
  async archiveCategory(id: string): Promise<ItemCategory> {
    const raw = await post(`/api/v1/inventory/categories/${id}/archive`);
    return adaptItemCategory(apiItemCategorySchema.parse(raw));
  },

  async restoreCategory(id: string): Promise<ItemCategory> {
    const raw = await post(`/api/v1/inventory/categories/${id}/restore`);
    return adaptItemCategory(apiItemCategorySchema.parse(raw));
  },

  // ── Ingredients (INV-01/INV-14) ──────────────────────────────────────────────────────────
  async listIngredients(filters?: IngredientListFilters): Promise<Ingredient[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/ingredients", {
      search: filters?.search,
      categoryId: filters?.categoryId,
      status: filters?.status,
    });
    return (raw ?? []).map((i) => adaptIngredient(apiIngredientSchema.parse(i)));
  },

  async getIngredient(id: string): Promise<Ingredient> {
    const raw = await get(`/api/v1/inventory/ingredients/${id}`);
    return adaptIngredient(apiIngredientSchema.parse(raw));
  },

  async createIngredient(input: IngredientInput): Promise<Ingredient> {
    const raw = await post(
      "/api/v1/inventory/ingredients",
      createIngredientInputSchema.parse(input),
    );
    return adaptIngredient(apiIngredientSchema.parse(raw));
  },

  async updateIngredient(id: string, input: UpdateIngredientInput): Promise<Ingredient> {
    const raw = await put(
      `/api/v1/inventory/ingredients/${id}`,
      updateIngredientInputSchema.parse(input),
    );
    return adaptIngredient(apiIngredientSchema.parse(raw));
  },

  /** D-04: archive/restore are POST sub-resources — there is no `del` call anywhere here. */
  async archiveIngredient(id: string): Promise<Ingredient> {
    const raw = await post(`/api/v1/inventory/ingredients/${id}/archive`);
    return adaptIngredient(apiIngredientSchema.parse(raw));
  },

  async restoreIngredient(id: string): Promise<Ingredient> {
    const raw = await post(`/api/v1/inventory/ingredients/${id}/restore`);
    return adaptIngredient(apiIngredientSchema.parse(raw));
  },

  async listUoms(): Promise<Uom[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/uom");
    return (raw ?? []).map((u) => adaptUom(apiUomSchema.parse(u)));
  },

  // ── Stock levels (INV-15) ────────────────────────────────────────────────────────────────
  /** `branchId` is required — the backend refuses any branchId that isn't the caller's own. */
  async getStockLevels(branchId: string, search?: string): Promise<StockLevelsResponse> {
    const raw = await get("/api/v1/inventory/stock", { branchId, search });
    return adaptStockLevelsResponse(apiStockLevelsResponseSchema.parse(raw));
  },

  // ── Recipes (INV-02/INV-10/INV-11) ───────────────────────────────────────────────────────
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

  /** INV-15: non-persisting plate-cost preview for the live recipe-authoring cost panel. */
  async previewRecipeCost(input: PreviewRecipeCostInput): Promise<RecipeCostPreview> {
    const raw = await post(
      "/api/v1/inventory/recipes/preview",
      previewRecipeCostInputSchema.parse(input),
    );
    return adaptRecipeCostPreview(apiRecipeCostPreviewSchema.parse(raw));
  },
};
