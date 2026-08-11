import type { ApiBranch } from "@/lib/api-client/schemas/settings.schema";
import type { BranchSettings } from "@/lib/models/tenant-settings.model";

export function adaptBranchSettings(api: ApiBranch): BranchSettings {
  return {
    id: api.id,
    name: api.name,
    isHq: api.isHq,
    isActive: api.isActive,
    address: api.address ?? null,
    phone: api.phone ?? null,
    email: api.email ?? null,
    timezone: api.timezone ?? null,
    openedOn: api.openedOn ?? null,
    fbrStrn: api.fbrStrn ?? null,
    ntn: api.ntn ?? null,
  };
}
