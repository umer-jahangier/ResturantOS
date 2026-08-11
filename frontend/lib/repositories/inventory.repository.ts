import { get, post, put } from "@/lib/api-client/request";
import {
  apiCoverageSchema,
  apiGlAccountOptionSchema,
  apiIngredientSchema,
  apiItemCategoryNodeSchema,
  apiItemCategorySchema,
  apiMenuItemCatalogSchema,
  apiReceiptResultSchema,
  apiRecipeCostPreviewSchema,
  apiRecipeOptionSchema,
  apiRecipeSchema,
  apiStockCountSchema,
  apiStockLevelsResponseSchema,
  apiStorageLocationSchema,
  apiTransferSchema,
  apiUomSchema,
  createIngredientInputSchema,
  createItemCategoryInputSchema,
  createRecipeInputSchema,
  createStockCountInputSchema,
  createStorageLocationInputSchema,
  createTransferInputSchema,
  createUomInputSchema,
  updateUomInputSchema,
  moveItemCategoryInputSchema,
  previewRecipeCostInputSchema,
  receiveStockInputSchema,
  receiveTransferInputSchema,
  recordOpeningBalanceInputSchema,
  updateIngredientInputSchema,
  updateItemCategoryInputSchema,
  updateStorageLocationInputSchema,
} from "@/lib/api-client/schemas/inventory.schema";
import {
  adaptCoverage,
  adaptIngredient,
  adaptItemCategory,
  adaptItemCategoryNode,
  adaptMenuItemCatalogEntry,
  adaptReceiptResult,
  adaptRecipe,
  adaptRecipeCostPreview,
  adaptRecipeOption,
  adaptStockCount,
  adaptStockLevelsResponse,
  adaptStorageLocation,
  adaptTransfer,
  adaptUom,
} from "@/lib/adapters/inventory.adapter";
import type {
  Coverage,
  CreateItemCategoryInput,
  CreateStockCountInput,
  CreateStorageLocationInput,
  CreateTransferInput,
  CreateUomInput,
  UpdateUomInput,
  GlAccountOption,
  GlAccountUsage,
  Ingredient,
  IngredientInput,
  ItemCategory,
  ItemCategoryNode,
  MenuItemCatalogEntry,
  MoveItemCategoryInput,
  OpeningBalanceInput,
  PreviewRecipeCostInput,
  ReceiptResult,
  ReceiveStockInput,
  ReceiveTransferInput,
  Recipe,
  RecipeCostPreview,
  RecipeInput,
  RecipeOption,
  StockCount,
  StockLevelsResponse,
  StorageLocation,
  Transfer,
  UpdateIngredientInput,
  UpdateItemCategoryInput,
  UpdateStorageLocationInput,
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

  /**
   * Chart-of-accounts options for one of a category's three GL slots. Served by inventory's own
   * narrow proxy onto finance-service, so the caller needs only `inventory.item.view` — not
   * `finance.coa.view`, which would carry the whole finance read surface. The server filters to
   * active accounts of the types `usage` accepts; the browser never filters the chart itself.
   */
  async searchGlAccounts(usage: GlAccountUsage, q?: string): Promise<GlAccountOption[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/gl-accounts", { usage, q });
    return (raw ?? []).map((a) => apiGlAccountOptionSchema.parse(a));
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

  /**
   * @param includeRetired only the SETUP screen passes true, so a retired unit is shown AS retired
   *   rather than vanishing with no explanation of where it went. Every picker leaves it false.
   */
  async listUoms(includeRetired = false): Promise<Uom[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/uom", { includeRetired });
    return (raw ?? []).map((u) => adaptUom(apiUomSchema.parse(u)));
  },

  /** Creates a house unit alongside the standard set. This endpoint has existed since 08.2-01 and
   * had no caller until the Setup screen — which is why every tenant's unit list was whatever the
   * lazy standard provisioning gave it, and nothing else. */
  async createUom(input: CreateUomInput): Promise<Uom> {
    const raw = await post("/api/v1/inventory/uom", createUomInputSchema.parse(input));
    return adaptUom(apiUomSchema.parse(raw));
  },

  /** Correct a unit. The CODE cannot be changed — see `updateUomInputSchema` for why. */
  async updateUom(id: string, input: UpdateUomInput): Promise<Uom> {
    const raw = await put(`/api/v1/inventory/uom/${id}`, updateUomInputSchema.parse(input));
    return adaptUom(apiUomSchema.parse(raw));
  },

  /**
   * Retire — never delete. Refused with 422 and a message naming what still references the unit,
   * which the caller must render: a bare failure toast turns a correct refusal into an apparently
   * broken button.
   */
  async archiveUom(id: string): Promise<Uom> {
    const raw = await post(`/api/v1/inventory/uom/${id}/archive`);
    return adaptUom(apiUomSchema.parse(raw));
  },

  async restoreUom(id: string): Promise<Uom> {
    const raw = await post(`/api/v1/inventory/uom/${id}/restore`);
    return adaptUom(apiUomSchema.parse(raw));
  },

  // ── Storage locations (V10) ──────────────────────────────────────────────────────────────
  async listStorageLocations(includeArchived = false): Promise<StorageLocation[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/storage-locations", { includeArchived });
    return (raw ?? []).map((s) => adaptStorageLocation(apiStorageLocationSchema.parse(s)));
  },

  async createStorageLocation(input: CreateStorageLocationInput): Promise<StorageLocation> {
    const raw = await post(
      "/api/v1/inventory/storage-locations",
      createStorageLocationInputSchema.parse(input),
    );
    return adaptStorageLocation(apiStorageLocationSchema.parse(raw));
  },

  async updateStorageLocation(
    id: string,
    input: UpdateStorageLocationInput,
  ): Promise<StorageLocation> {
    const raw = await put(
      `/api/v1/inventory/storage-locations/${id}`,
      updateStorageLocationInputSchema.parse(input),
    );
    return adaptStorageLocation(apiStorageLocationSchema.parse(raw));
  },

  /** D-04: archive is a POST sub-resource, never DELETE — and the server refuses while live
   * ingredients are still filed here rather than silently detaching them. */
  async archiveStorageLocation(id: string): Promise<StorageLocation> {
    const raw = await post(`/api/v1/inventory/storage-locations/${id}/archive`);
    return adaptStorageLocation(apiStorageLocationSchema.parse(raw));
  },

  async restoreStorageLocation(id: string): Promise<StorageLocation> {
    const raw = await post(`/api/v1/inventory/storage-locations/${id}/restore`);
    return adaptStorageLocation(apiStorageLocationSchema.parse(raw));
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

  /** Current recipe versions, labelled by menu item — the ingredient form's "Produced by" options. */
  async listRecipeOptions(): Promise<RecipeOption[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/recipes/options");
    return (raw ?? []).map((r) => adaptRecipeOption(apiRecipeOptionSchema.parse(r)));
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

  // ── Stock operations (INV-15 Screen 7, plan 08.2-17) ─────────────────────────────────────
  /** Records a one-time opening balance. The endpoint returns no body (`ApiResponse<Void>`). */
  async recordOpeningBalance(input: OpeningBalanceInput): Promise<void> {
    await post("/api/v1/inventory/opening-balance", recordOpeningBalanceInputSchema.parse(input));
  },

  /** Logs a receipt for one ingredient — `ReceiptDtos.ReceiveStockRequest` carries no `lines`
   * array; a multi-line receipt form issues one call per line (see StockReceiptDialog.tsx). */
  async receiveStock(input: ReceiveStockInput): Promise<ReceiptResult> {
    const raw = await post("/api/v1/inventory/receipts", receiveStockInputSchema.parse(input));
    return adaptReceiptResult(apiReceiptResultSchema.parse(raw));
  },

  async shipTransfer(input: CreateTransferInput): Promise<Transfer> {
    const raw = await post(
      "/api/v1/inventory/transfers/ship",
      createTransferInputSchema.parse(input),
    );
    return adaptTransfer(apiTransferSchema.parse(raw));
  },

  async receiveTransfer(input: ReceiveTransferInput): Promise<Transfer> {
    const raw = await post(
      "/api/v1/inventory/transfers/receive",
      receiveTransferInputSchema.parse(input),
    );
    return adaptTransfer(apiTransferSchema.parse(raw));
  },

  /** `branchId` is required — mirrors `getStockLevels`'s own-branch-only contract. */
  async listPendingTransfers(branchId: string): Promise<Transfer[]> {
    const raw = await get<unknown[]>("/api/v1/inventory/transfers/pending", { branchId });
    return (raw ?? []).map((t) => adaptTransfer(apiTransferSchema.parse(t)));
  },

  async postStockCount(input: CreateStockCountInput): Promise<StockCount> {
    const raw = await post("/api/v1/inventory/counts", createStockCountInputSchema.parse(input));
    return adaptStockCount(apiStockCountSchema.parse(raw));
  },
};
