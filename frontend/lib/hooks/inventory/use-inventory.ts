"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InventoryRepository } from "@/lib/repositories/inventory.repository";
import type { Recipe, RecipeInput } from "@/lib/adapters/inventory.adapter";
// Type-only import — permitted from a lib/hooks/** file (the ESLint layer-boundary rule only
// blocks components/**); mirrors use-purchasing.ts's exact justification for this import.
import type { ApiError } from "@/lib/api-client/errors";

const MENU_ITEMS_KEY = ["inventory", "menu-items"];
const INGREDIENTS_KEY = ["inventory", "ingredients"];
const UOMS_KEY = ["inventory", "uoms"];
const RECIPES_KEY = ["inventory", "recipes"];
const COVERAGE_KEY = ["inventory", "coverage"];

/** 08.1-02: the synced menu-item catalog — drives the recipe-builder's menu-item picker. */
export function useMenuItemCatalog() {
  return useQuery({ queryKey: MENU_ITEMS_KEY, queryFn: () => InventoryRepository.listMenuItems() });
}

export function useIngredients() {
  return useQuery({ queryKey: INGREDIENTS_KEY, queryFn: () => InventoryRepository.listIngredients() });
}

export function useUoms() {
  return useQuery({ queryKey: UOMS_KEY, queryFn: () => InventoryRepository.listUoms() });
}

/**
 * INV-10: author a new recipe version. Invalidates BOTH the coverage key and the broad recipes
 * list key (not just one menuItemId) — the picker may re-query any menu item's versions, and a
 * newly-authored recipe must immediately close a coverage gap on the dashboard.
 */
export function useCreateRecipe() {
  const qc = useQueryClient();
  return useMutation<Recipe, ApiError, RecipeInput>({
    mutationFn: (input) => InventoryRepository.createRecipe(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: COVERAGE_KEY });
      qc.invalidateQueries({ queryKey: RECIPES_KEY });
    },
  });
}

export function useRecipeVersions(menuItemId: string) {
  return useQuery({
    queryKey: [...RECIPES_KEY, menuItemId],
    queryFn: () => InventoryRepository.listRecipeVersions(menuItemId),
    enabled: Boolean(menuItemId),
  });
}

/** 08.1-03 (INV-11): recipe-coverage totals + missing list, for the coverage dashboard. */
export function useCoverage() {
  return useQuery({ queryKey: COVERAGE_KEY, queryFn: () => InventoryRepository.getCoverage() });
}
