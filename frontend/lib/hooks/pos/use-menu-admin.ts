"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { MenuCategory, MenuItem } from "@/lib/models/pos.model";
import type { CreateMenuCategoryInput, CreateMenuItemInput } from "@/lib/api-client/schemas/pos.schema";
// Type-only import — permitted from a lib/hooks/** file (the ESLint layer-boundary rule only
// blocks components/**); mirrors use-inventory.ts's exact justification for this import.
import type { ApiError } from "@/lib/api-client/errors";

// Menu Items management page (self-serve menu creation) + RecipeFormDialog's inline quick-create.
// Distinct from menu-grid.tsx's read-only useMenuCategories/useMenuItems (order-taking, active
// only) — these are the ADMIN listings (include inactive) and the write mutations, none of which
// existed anywhere in the frontend before this feature: pos-service had a complete, working,
// event-publishing item CRUD API that nothing ever called.

export function useMenuCategoriesAdmin() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.menuCategoriesAdmin(branchId),
    queryFn: () => PosRepository.getMenuCategoriesForAdmin(),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useMenuItemsAdmin(categoryId?: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.menuItemsAdmin(branchId, categoryId),
    queryFn: () => PosRepository.getMenuItemsForAdmin(categoryId),
    enabled: isAuthenticated && !!branchId,
  });
}

/** Create/activate/deactivate for either items or categories invalidates every menu query —
 * both the admin listings AND the order-taking grid's own (active-only) queries, since a newly
 * created or reactivated item/category must appear there too. */
function invalidateMenuQueries(qc: ReturnType<typeof useQueryClient>, branchId: string) {
  qc.invalidateQueries({ queryKey: ["pos", branchId, "menu-categories"] });
  qc.invalidateQueries({ queryKey: ["pos", branchId, "menu-items"] });
}

export function useCreateMenuCategory() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<MenuCategory, ApiError, CreateMenuCategoryInput>({
    mutationFn: (input) => PosRepository.createMenuCategory(input),
    onSuccess: () => invalidateMenuQueries(qc, branchId),
  });
}

export function useUpdateMenuCategory() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<MenuCategory, ApiError, { id: string; input: CreateMenuCategoryInput }>({
    mutationFn: ({ id, input }) => PosRepository.updateMenuCategory(id, input),
    onSuccess: () => invalidateMenuQueries(qc, branchId),
  });
}

export function useActivateMenuCategory() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<MenuCategory, ApiError, string>({
    mutationFn: (id) => PosRepository.activateMenuCategory(id),
    onSuccess: () => invalidateMenuQueries(qc, branchId),
  });
}

export function useDeactivateMenuCategory() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<MenuCategory, ApiError, string>({
    mutationFn: (id) => PosRepository.deactivateMenuCategory(id),
    onSuccess: () => invalidateMenuQueries(qc, branchId),
  });
}

export function useCreateMenuItem() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<MenuItem, ApiError, CreateMenuItemInput>({
    mutationFn: (input) => PosRepository.createMenuItem(input),
    onSuccess: () => invalidateMenuQueries(qc, branchId),
  });
}

export function useUpdateMenuItem() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<MenuItem, ApiError, { id: string; input: CreateMenuItemInput }>({
    mutationFn: ({ id, input }) => PosRepository.updateMenuItem(id, input),
    onSuccess: () => invalidateMenuQueries(qc, branchId),
  });
}

export function useActivateMenuItem() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<MenuItem, ApiError, string>({
    mutationFn: (id) => PosRepository.activateMenuItem(id),
    onSuccess: () => invalidateMenuQueries(qc, branchId),
  });
}

export function useDeactivateMenuItem() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<MenuItem, ApiError, string>({
    mutationFn: (id) => PosRepository.deactivateMenuItem(id),
    onSuccess: () => invalidateMenuQueries(qc, branchId),
  });
}
