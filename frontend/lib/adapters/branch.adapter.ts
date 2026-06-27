import type { ApiAssignedBranch } from "@/lib/api-client/schemas/branch.schema";
import type { AssignedBranch } from "@/lib/models/branch.model";

export function adaptAssignedBranch(api: ApiAssignedBranch): AssignedBranch {
  return {
    id: api.id,
    name: api.name,
    isHq: api.isHq,
    roleCode: api.roleCode,
  };
}
