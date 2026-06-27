import { z } from "zod";

/** GET /api/v1/branches/mine — branches assigned to the current user. */
export const apiAssignedBranchSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    isHq: z.boolean().optional(),
    hq: z.boolean().optional(),
    roleCode: z.string(),
  })
  .transform((row) => ({
    id: row.id,
    name: row.name,
    isHq: row.isHq ?? row.hq ?? false,
    roleCode: row.roleCode,
  }));

export const apiAssignedBranchesSchema = z.array(apiAssignedBranchSchema);

export type ApiAssignedBranch = z.infer<typeof apiAssignedBranchSchema>;
