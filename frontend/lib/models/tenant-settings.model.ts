/** The branch record behind Settings → Branch details. */
export interface BranchSettings {
  id: string;
  name: string;
  isHq: boolean;
  isActive: boolean;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string | null;
  /** ISO date (`YYYY-MM-DD`). */
  openedOn: string | null;
  /**
   * Tax registration numbers. READ-ONLY here: `BranchDtos.UpdateBranchRequest` declares no field
   * for either, so the endpoint cannot store an edit to them. The form shows them and says so
   * rather than offering an input that would be accepted by the browser and discarded by the API.
   */
  fbrStrn: string | null;
  ntn: string | null;
}

/**
 * Only the fields the user actually changed.
 *
 * <p>`PUT /api/v1/branches/{id}` applies each key only when non-null, so an omitted key is "leave
 * it alone" and a present-but-empty string is a real edit to empty. Sending a full snapshot every
 * time would make a field the user never touched a write, which is how a concurrent edit gets
 * silently reverted.
 */
export type BranchSettingsPatch = Partial<
  Pick<
    BranchSettings,
    "name" | "isActive" | "address" | "phone" | "email" | "timezone" | "openedOn"
  >
>;

/**
 * A branch being created. `name` is the only thing the server insists on.
 *
 * <p>No `isActive` and no `isHq`: a new branch is active, and HQ is settled when the tenant is
 * provisioned. Neither is a decision this screen is entitled to make, so neither is offered.
 */
export interface BranchDraft {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  timezone?: string;
  /** ISO date (`YYYY-MM-DD`). */
  openedOn?: string;
}
