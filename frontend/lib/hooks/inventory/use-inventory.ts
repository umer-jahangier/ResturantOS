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
  Ingredient,
  IngredientInput,
  ItemCategory,
  MoveItemCategoryInput,
  PreviewRecipeCostInput,
  Recipe,
  RecipeCostPreview,
  RecipeInput,
  StockLevelsResponse,
  UpdateIngredientInput,
  UpdateItemCategoryInput,
} from "@/lib/adapters/inventory.adapter";
// Type-only import — permitted from a lib/hooks/** file (the ESLint layer-boundary rule only
// blocks components/**); mirrors use-purchasing.ts's exact justification for this import.
import type { ApiError } from "@/lib/api-client/errors";

/** 08.1-02: the synced menu-item catalog — drives the recipe-builder's menu-item picker. */
export function useMenuItemCatalog() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.inventory.menuItems(branchId),
    queryFn: () => InventoryRepository.listMenuItems(),
    enabled: isAuthenticated && !!branchId,
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
