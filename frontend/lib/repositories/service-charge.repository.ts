import { get, put } from "@/lib/api-client/request";
import {
  apiServiceChargePolicySchema,
  updateServiceChargeInputSchema,
  type UpdateServiceChargeInput,
} from "@/lib/api-client/schemas/service-charge.schema";
import { adaptServiceChargePolicy } from "@/lib/adapters/service-charge.adapter";
import type { ServiceChargePolicy } from "@/lib/models/service-charge.model";

/**
 * Layer-2 repository for a branch's service-charge policy (F20).
 *
 * <h3>The read and the write carry different permissions on purpose</h3>
 *
 * `pos.menu.view` reads; `pos.service_charge.manage` writes. The charge is on every bill a
 * manager hands a guest, so they can look it up; deciding that every check in the building grows
 * by 5% belongs with whoever owns the pricing. See auth changeset 093.
 *
 * <h3>Every write sends every field</h3>
 *
 * PUT is a REPLACE, for the same reason `TaxClassRepository.update` is: wipe-by-omission has
 * already happened once in this codebase, on this exact subject matter.
 */
export const ServiceChargeRepository = {
  async get(branchId: string): Promise<ServiceChargePolicy> {
    const raw = await get<unknown>(
      `/api/v1/pos/branches/${encodeURIComponent(branchId)}/service-charge`,
    );
    return adaptServiceChargePolicy(apiServiceChargePolicySchema.parse(raw));
  },

  async update(branchId: string, input: UpdateServiceChargeInput): Promise<ServiceChargePolicy> {
    const body = updateServiceChargeInputSchema.parse(input);
    const raw = await put<typeof body, unknown>(
      `/api/v1/pos/branches/${encodeURIComponent(branchId)}/service-charge`,
      body,
    );
    return adaptServiceChargePolicy(apiServiceChargePolicySchema.parse(raw));
  },
};
