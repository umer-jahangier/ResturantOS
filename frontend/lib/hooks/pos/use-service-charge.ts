"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ServiceChargeRepository } from "@/lib/repositories/service-charge.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { ServiceChargePolicy } from "@/lib/models/service-charge.model";
import type { UpdateServiceChargeInput } from "@/lib/api-client/schemas/service-charge.schema";
// Type-only import — permitted from lib/hooks/** (the ESLint layer rule blocks components/**).
import type { ApiError } from "@/lib/api-client/errors";

/**
 * A branch's service-charge policy (F20).
 *
 * <p>Read is gated on `pos.menu.view`, which anyone who can see the menu holds, so a MANAGER can
 * mount the settings screen and read the rate they are asked about at the table. The mutation
 * needs `pos.service_charge.manage` (OWNER / TENANT_ADMIN); the screen renders its controls
 * disabled from `policy.canManage` rather than hiding them, because a control that vanishes
 * teaches nothing and a 403 toast after a save teaches it too late.
 */
export function useServiceChargePolicy(branchId: string | null | undefined) {
  const { isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.pos.serviceCharge(branchId ?? ""),
    queryFn: () => ServiceChargeRepository.get(branchId as string),
    enabled: isAuthenticated && Boolean(branchId),
  });
}

/**
 * Saving a rate invalidates the OPEN ORDERS too, not just the policy.
 *
 * <p>Not cosmetic. The charge is computed server-side on the next recompute of each order, and
 * the till and the charge page both render cached order totals. Leaving them stale is how a
 * manager sets 5%, looks at the check on screen, sees the old total and sets it again.
 */
export function useUpdateServiceCharge(branchId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<ServiceChargePolicy, ApiError, UpdateServiceChargeInput>({
    mutationFn: (input) => ServiceChargeRepository.update(branchId as string, input),
    onSuccess: (policy) => {
      qc.setQueryData(queryKeys.pos.serviceCharge(branchId ?? ""), policy);
      qc.invalidateQueries({ queryKey: queryKeys.pos.serviceCharge(branchId ?? "") });
      qc.invalidateQueries({ queryKey: ["pos", branchId ?? "", "orders"] });
    },
  });
}
