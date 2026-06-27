import { get } from "@/lib/api-client/request";
import { apiAssignedBranchesSchema } from "@/lib/api-client/schemas/branch.schema";
import { adaptAssignedBranch } from "@/lib/adapters/branch.adapter";
import type { AssignedBranch } from "@/lib/models/branch.model";

export const BranchRepository = {
  async listMine(): Promise<AssignedBranch[]> {
    const raw = await get("/api/v1/branches/mine");
    return apiAssignedBranchesSchema.parse(raw).map(adaptAssignedBranch);
  },
};
