"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TaxClassRepository } from "@/lib/repositories/tax-class.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { TaxClass } from "@/lib/models/tax-class.model";
import type {
  CreateTaxClassInput,
  UpdateTaxClassInput,
} from "@/lib/api-client/schemas/tax-class.schema";
// Type-only import — permitted from lib/hooks/** (the ESLint layer rule blocks components/**).
import type { ApiError } from "@/lib/api-client/errors";

/**
 * The tenant's sales-tax catalogue (F16).
 *
 * <p>Read is gated on `pos.menu.view`, which anyone who can see the menu holds, so this hook is
 * safe to mount on the Menu Items screen and the item dialog. The mutations need
 * `pos.tax.manage` (OWNER / TENANT_ADMIN) and will surface a 403 as an `ApiError` the settings
 * screen renders — it does not hide the controls, because a manager who cannot change a rate
 * should still see what the rates are.
 */
export function useTaxClasses() {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.taxClasses(),
    queryFn: () => TaxClassRepository.list(),
    enabled: isAuthenticated,
  });
}

/**
 * A rate change reaches the whole menu, so it invalidates the menu queries too.
 *
 * <p>Not cosmetic: every item's effective rate is resolved SERVER-side, so a cached menu list
 * still carries the old percentage until it is refetched — and the Menu Items screen prints that
 * percentage next to each dish. Leaving it stale is how a manager changes a rate, looks at the
 * menu, sees the old number and changes it again.
 */
function invalidateTaxAndMenu(qc: ReturnType<typeof useQueryClient>, branchId: string) {
  qc.invalidateQueries({ queryKey: queryKeys.pos.taxClasses() });
  qc.invalidateQueries({ queryKey: ["pos", branchId, "menu-categories"] });
  qc.invalidateQueries({ queryKey: ["pos", branchId, "menu-items"] });
}

export function useCreateTaxClass() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<TaxClass, ApiError, CreateTaxClassInput>({
    mutationFn: (input) => TaxClassRepository.create(input),
    onSuccess: () => invalidateTaxAndMenu(qc, branchId),
  });
}

export function useUpdateTaxClass() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<TaxClass, ApiError, { id: string; input: UpdateTaxClassInput }>({
    mutationFn: ({ id, input }) => TaxClassRepository.update(id, input),
    onSuccess: () => invalidateTaxAndMenu(qc, branchId),
  });
}

export function useDeleteTaxClass() {
  const qc = useQueryClient();
  const { branchId } = useCurrentUser();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => TaxClassRepository.remove(id),
    onSuccess: () => invalidateTaxAndMenu(qc, branchId),
  });
}
