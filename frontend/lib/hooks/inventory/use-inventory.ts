"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InventoryRepository } from "@/lib/repositories/inventory.repository";
import type { IngredientListFilters } from "@/lib/repositories/inventory.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useDebouncedValue } from "@/lib/hooks/use-debounce";
import type {
  Coverage,
  CreateItemCategoryInput,
  CreateStockCountInput,
  CreateStorageLocationInput,
  CreateTransferInput,
  CreateUomInput,
  GlAccountOption,
  GlAccountUsage,
  Ingredient,
  IngredientInput,
  ItemCategory,
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
// Type-only import — permitted from a lib/hooks/** file (the ESLint layer-boundary rule only
// blocks components/**); mirrors use-purchasing.ts's exact justification for this import.
import type { ApiError } from "@/lib/api-client/errors";

/**
 * 08.1-02: the synced menu-item catalog — drives the recipe-builder's menu-item picker.
 *
 * @param refetchInterval Pass a millisecond interval (default `false`, i.e. off) to poll — used
 * by RecipeFormDialog's inline "+ Create new menu item" quick-create: a menu item created in
 * pos-service reaches THIS list asynchronously, via a RabbitMQ event
 * (MenuItemCatalogConsumer), so the dialog polls briefly rather than assuming it is already
 * there the instant the create call returns.
 */
export function useMenuItemCatalog(refetchInterval: number | false = false) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.inventory.menuItems(branchId),
    queryFn: () => InventoryRepository.listMenuItems(),
    enabled: isAuthenticated && !!branchId,
    refetchInterval,
  });
}

// ── Item categories (INV-13) ───────────────────────────────────────────────────────────────

export function useCategories(includeArchived = false) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: [...queryKeys.inventory.categories(branchId), includeArchived],
    queryFn: () => InventoryRepository.listCategories(includeArchived),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useCategoryTree(includeArchived = false) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: [...queryKeys.inventory.categoryTree(branchId), includeArchived],
    queryFn: () => InventoryRepository.getCategoryTree(includeArchived),
    enabled: isAuthenticated && !!branchId,
  });
}

/** create/update/archive/restore category invalidates categories, categoryTree AND ingredients
 * (an ingredient row renders its category name). */
function invalidateCategoryQueries(qc: ReturnType<typeof useQueryClient>, branchId: string) {
  qc.invalidateQueries({ queryKey: ["inventory", branchId, "categories"] });
  // Belt-and-suspenders: the broad "categories" prefix above already covers the tree (its key
  // nests under the same prefix), but invalidating the registry's own factory keeps this call
  // site correct even if that nesting ever changes.
  qc.invalidateQueries({ queryKey: queryKeys.inventory.categoryTree(branchId) });
  qc.invalidateQueries({ queryKey: ["inventory", branchId, "ingredients"] });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<ItemCategory, ApiError, CreateItemCategoryInput>({
    mutationFn: (input) => InventoryRepository.createCategory(input),
    onSuccess: () => invalidateCategoryQueries(qc, branchId),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<ItemCategory, ApiError, { id: string; input: UpdateItemCategoryInput }>({
    mutationFn: ({ id, input }) => InventoryRepository.updateCategory(id, input),
    onSuccess: () => invalidateCategoryQueries(qc, branchId),
  });
}

export function useMoveCategory() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<ItemCategory, ApiError, { id: string; input: MoveItemCategoryInput }>({
    mutationFn: ({ id, input }) => InventoryRepository.moveCategory(id, input.newParentId ?? null),
    onSuccess: () => invalidateCategoryQueries(qc, branchId),
  });
}

export function useArchiveCategory() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<ItemCategory, ApiError, string>({
    mutationFn: (id) => InventoryRepository.archiveCategory(id),
    onSuccess: () => invalidateCategoryQueries(qc, branchId),
  });
}

export function useRestoreCategory() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<ItemCategory, ApiError, string>({
    mutationFn: (id) => InventoryRepository.restoreCategory(id),
    onSuccess: () => invalidateCategoryQueries(qc, branchId),
  });
}

// ── Ingredients (INV-01/INV-14) ───────────────────────────────────────────────────────────

export function useIngredients(filters?: IngredientListFilters) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.inventory.ingredients(branchId, filters),
    queryFn: () => InventoryRepository.listIngredients(filters),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useIngredient(id: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.inventory.ingredient(branchId, id),
    queryFn: () => InventoryRepository.getIngredient(id),
    enabled: isAuthenticated && !!branchId && !!id,
  });
}

/** create/update/archive/restore ingredient invalidates ingredients, stockLevels AND categories
 * (category ingredient counts change). */
function invalidateIngredientQueries(qc: ReturnType<typeof useQueryClient>, branchId: string) {
  qc.invalidateQueries({ queryKey: ["inventory", branchId, "ingredients"] });
  qc.invalidateQueries({ queryKey: ["inventory", branchId, "stock-levels"] });
  qc.invalidateQueries({ queryKey: ["inventory", branchId, "categories"] });
}

export function useCreateIngredient() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Ingredient, ApiError, IngredientInput>({
    mutationFn: (input) => InventoryRepository.createIngredient(input),
    onSuccess: () => invalidateIngredientQueries(qc, branchId),
  });
}

export function useUpdateIngredient() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Ingredient, ApiError, { id: string; input: UpdateIngredientInput }>({
    mutationFn: ({ id, input }) => InventoryRepository.updateIngredient(id, input),
    onSuccess: (_data, variables) => {
      invalidateIngredientQueries(qc, branchId);
      qc.invalidateQueries({ queryKey: queryKeys.inventory.ingredient(branchId, variables.id) });
    },
  });
}

export function useArchiveIngredient() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Ingredient, ApiError, string>({
    mutationFn: (id) => InventoryRepository.archiveIngredient(id),
    onSuccess: (_data, id) => {
      invalidateIngredientQueries(qc, branchId);
      qc.invalidateQueries({ queryKey: queryKeys.inventory.ingredient(branchId, id) });
    },
  });
}

export function useRestoreIngredient() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Ingredient, ApiError, string>({
    mutationFn: (id) => InventoryRepository.restoreIngredient(id),
    onSuccess: (_data, id) => {
      invalidateIngredientQueries(qc, branchId);
      qc.invalidateQueries({ queryKey: queryKeys.inventory.ingredient(branchId, id) });
    },
  });
}

export function useUoms() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.inventory.uoms(branchId),
    queryFn: () => InventoryRepository.listUoms(),
    enabled: isAuthenticated && !!branchId,
  });
}

/**
 * Adds a house unit. Invalidates ingredients too, not just uoms: the ingredient form's Stock and
 * Recipe selects are built from this list, so a newly added unit has to be offerable immediately
 * rather than after a reload.
 */
export function useCreateUom() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Uom, ApiError, CreateUomInput>({
    mutationFn: (input) => InventoryRepository.createUom(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.uoms(branchId) });
      qc.invalidateQueries({ queryKey: ["inventory", branchId, "ingredients"] });
    },
  });
}

// ── Storage locations (V10) ───────────────────────────────────────────────────────────────

export function useStorageLocations(includeArchived = false) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<StorageLocation[]>({
    queryKey: [...queryKeys.inventory.storageLocations(branchId), includeArchived],
    queryFn: () => InventoryRepository.listStorageLocations(includeArchived),
    enabled: isAuthenticated && !!branchId,
  });
}

/** Every location write invalidates ingredients as well — an ingredient row renders its storage
 * location's name, mirroring `invalidateCategoryQueries`'s reasoning above. */
function invalidateStorageLocationQueries(qc: ReturnType<typeof useQueryClient>, branchId: string) {
  qc.invalidateQueries({ queryKey: queryKeys.inventory.storageLocations(branchId) });
  qc.invalidateQueries({ queryKey: ["inventory", branchId, "ingredients"] });
}

export function useCreateStorageLocation() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<StorageLocation, ApiError, CreateStorageLocationInput>({
    mutationFn: (input) => InventoryRepository.createStorageLocation(input),
    onSuccess: () => invalidateStorageLocationQueries(qc, branchId),
  });
}

export function useUpdateStorageLocation() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<StorageLocation, ApiError, { id: string; input: UpdateStorageLocationInput }>({
    mutationFn: ({ id, input }) => InventoryRepository.updateStorageLocation(id, input),
    onSuccess: () => invalidateStorageLocationQueries(qc, branchId),
  });
}

export function useArchiveStorageLocation() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<StorageLocation, ApiError, string>({
    mutationFn: (id) => InventoryRepository.archiveStorageLocation(id),
    onSuccess: () => invalidateStorageLocationQueries(qc, branchId),
  });
}

export function useRestoreStorageLocation() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<StorageLocation, ApiError, string>({
    mutationFn: (id) => InventoryRepository.restoreStorageLocation(id),
    onSuccess: () => invalidateStorageLocationQueries(qc, branchId),
  });
}

// ── GL accounts (category form pickers) ───────────────────────────────────────────────────

/**
 * Chart-of-accounts options for one of a category's three GL slots, debounced off the picker's
 * keystrokes.
 *
 * <p>A blank query is deliberately still enabled, unlike `useAccountSearch` in the finance
 * namespace: the dropdown should show a first page the moment it opens rather than an empty box
 * until the user guesses at a search term. Filtering by account type happens server-side, so the
 * browser never holds the unfiltered chart.
 */
export function useGlAccountSearch(usage: GlAccountUsage, query: string, enabled = true) {
  const { branchId, isAuthenticated } = useCurrentUser();
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  return useQuery<GlAccountOption[]>({
    queryKey: queryKeys.inventory.glAccounts(branchId, usage, debouncedQuery),
    queryFn: () => InventoryRepository.searchGlAccounts(usage, debouncedQuery || undefined),
    enabled: enabled && isAuthenticated && !!branchId,
  });
}

// ── Stock levels (INV-15) ─────────────────────────────────────────────────────────────────

/**
 * Plain query, `enabled` only when `branchId` is truthy. The registry's `stockLevels` factory
 * doesn't carry a `search` segment (it's scoped to ingredientId/categoryId filters), so `search`
 * is appended as an extra tuple element — matches the `useCategories`/`useCategoryTree`
 * `includeArchived` extension pattern above — so a changed search term produces a distinct key
 * and actually triggers a refetch of the server-filtered list.
 */
export function useStockLevels(search?: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<StockLevelsResponse>({
    queryKey: [...queryKeys.inventory.stockLevels(branchId), search],
    queryFn: () => InventoryRepository.getStockLevels(branchId, search),
    enabled: isAuthenticated && !!branchId,
  });
}

// ── Recipes (INV-02/INV-10/INV-11) ────────────────────────────────────────────────────────

/**
 * INV-10: author a new recipe version. Invalidates recipes, recipeVersions for that menu item,
 * and coverage — a newly-authored recipe must immediately close a coverage gap on the dashboard.
 */
export function useCreateRecipe() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Recipe, ApiError, RecipeInput>({
    mutationFn: (input) => InventoryRepository.createRecipe(input),
    onSuccess: (recipe) => {
      qc.invalidateQueries({ queryKey: ["inventory", branchId, "coverage"] });
      qc.invalidateQueries({ queryKey: ["inventory", branchId, "recipes"] });
      qc.invalidateQueries({
        queryKey: queryKeys.inventory.recipeVersions(branchId, recipe.menuItemId),
      });
    },
  });
}

/**
 * The ingredient form's "Produced by" options. Enabled unconditionally rather than only when the
 * item type is PREPARED/BOTH: the list is small, and having it already in cache is what lets the
 * picker appear filled the instant someone switches the type, instead of flashing empty.
 */
export function useRecipeOptions() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<RecipeOption[]>({
    queryKey: queryKeys.inventory.recipeOptions(branchId),
    queryFn: () => InventoryRepository.listRecipeOptions(),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useRecipeVersions(menuItemId: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.inventory.recipeVersions(branchId, menuItemId),
    queryFn: () => InventoryRepository.listRecipeVersions(menuItemId),
    enabled: isAuthenticated && !!branchId && Boolean(menuItemId),
  });
}

/** 08.1-03 (INV-11): recipe-coverage totals + three-state items, for the coverage dashboard. */
export function useCoverage() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<Coverage>({
    queryKey: queryKeys.inventory.coverage(branchId),
    queryFn: () => InventoryRepository.getCoverage(),
    enabled: isAuthenticated && !!branchId,
  });
}

/**
 * INV-15: live plate-cost preview for the recipe-authoring panel. Debounces `input` at 400ms
 * before it reaches the query key so typing does not fire a request per keystroke.
 * `placeholderData` keeps the previous computed values visible (dimmed) while a recompute is in
 * flight — the UI contract forbids a blank panel between keystrokes. `enabled` is false when
 * there are no lines.
 */
export function useRecipeCostPreview(input: PreviewRecipeCostInput) {
  const { branchId, isAuthenticated } = useCurrentUser();
  const debouncedInput = useDebouncedValue(input, 400);
  const fingerprint = useMemo(() => JSON.stringify(debouncedInput), [debouncedInput]);
  return useQuery<RecipeCostPreview>({
    queryKey: queryKeys.inventory.costPreview(branchId, fingerprint),
    queryFn: () => InventoryRepository.previewRecipeCost(debouncedInput),
    enabled: isAuthenticated && !!branchId && debouncedInput.lines.length > 0,
    placeholderData: (previous) => previous,
  });
}

// ── Stock operations (INV-15 Screen 7, plan 08.2-17) ──────────────────────────────────────────
// The four Phase-8 write endpoints (opening-balance/receipts/transfers/counts) had no hook at
// all until this plan — 08.2-12 only covered the read side (useStockLevels above). Every
// mutation here invalidates the same `["inventory", branchId, "stock-levels"]` broad-prefix key
// `invalidateIngredientQueries` already uses, so the stock screen refetches immediately on any
// write from its own dialogs.

/** Records a one-time opening balance for an ingredient at a branch. */
export function useRecordOpeningBalance() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<void, ApiError, OpeningBalanceInput>({
    mutationFn: (input) => InventoryRepository.recordOpeningBalance(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory", branchId, "stock-levels"] });
    },
  });
}

/** Logs a receipt for one ingredient (INV-04) — a multi-line receipt form calls this once per
 * line (`ReceiveStockRequest` has no `lines` array on the real backend contract). */
export function useReceiveStock() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<ReceiptResult, ApiError, ReceiveStockInput>({
    mutationFn: (input) => InventoryRepository.receiveStock(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory", branchId, "stock-levels"] });
    },
  });
}

/** Ships an inter-branch transfer (INV-05). */
export function useShipTransfer() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Transfer, ApiError, CreateTransferInput>({
    mutationFn: (input) => InventoryRepository.shipTransfer(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory", branchId, "stock-levels"] });
      qc.invalidateQueries({ queryKey: ["inventory", branchId, "pending-transfers"] });
    },
  });
}

/**
 * GET /api/v1/inventory/transfers/pending (08.2-17 backend addition — no list endpoint existed
 * for in-transit transfers before this plan; ship/receive were write-only). No registry factory
 * exists for this key yet (`query-keys.ts` is 08.2-05's file) — the manual partial-array key
 * mirrors the cross-entity invalidation convention already used elsewhere in this file.
 */
export function usePendingTransfers() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<Transfer[]>({
    queryKey: ["inventory", branchId, "pending-transfers"],
    queryFn: () => InventoryRepository.listPendingTransfers(branchId),
    enabled: isAuthenticated && !!branchId,
  });
}

/** Receives an in-transit transfer (INV-05) — invalidates both stockLevels and the pending list. */
export function useReceiveTransfer() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<Transfer, ApiError, ReceiveTransferInput>({
    mutationFn: (input) => InventoryRepository.receiveTransfer(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory", branchId, "stock-levels"] });
      qc.invalidateQueries({ queryKey: ["inventory", branchId, "pending-transfers"] });
    },
  });
}

/** Posts a stock count with variance (INV-06). */
export function usePostStockCount() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<StockCount, ApiError, CreateStockCountInput>({
    mutationFn: (input) => InventoryRepository.postStockCount(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory", branchId, "stock-levels"] });
    },
  });
}
