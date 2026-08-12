import type { ApiServiceChargePolicy } from "@/lib/api-client/schemas/service-charge.schema";
import type { ServiceChargePolicy } from "@/lib/models/service-charge.model";

export function adaptServiceChargePolicy(raw: ApiServiceChargePolicy): ServiceChargePolicy {
  return {
    branchId: raw.branchId,
    enabled: raw.enabled,
    ratePct: raw.ratePct,
    label: raw.label,
    dineIn: raw.dineIn,
    takeaway: raw.takeaway,
    pickup: raw.pickup,
    canManage: raw.canManage,
  };
}
