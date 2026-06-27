/** Branch the signed-in user is assigned to (GET /api/v1/branches/mine). */
export interface AssignedBranch {
  id: string;
  name: string;
  isHq: boolean;
  roleCode: string;
}
