import { get, put } from "@/lib/api-client/request";
import { apiBranchSchema, apiUpdateBranchSchema } from "@/lib/api-client/schemas/settings.schema";
import { adaptBranchSettings } from "@/lib/adapters/settings.adapter";
import type { BranchSettings, BranchSettingsPatch } from "@/lib/models/tenant-settings.model";
import { z } from "zod";

/**
 * The tenant configuration surface, built on the ONE configuration endpoint that persists.
 *
 * <p>See `settings.schema.ts` for the measured 404s that rule out a tenant-settings API. The
 * consequence for this file is a rule rather than a caveat: <b>this repository contains no method
 * that pretends to save something the platform cannot store.</b> A setting with no endpoint is not
 * given a fake repository method and a hopeful `localStorage.setItem`; it is labelled in the UI as
 * not saved, which is the only honest option available today.
 */
export const SettingsRepository = {
  /** `GET /api/v1/branches/{id}` — open to any authenticated user; RLS confines it to the tenant. */
  async getBranch(branchId: string): Promise<BranchSettings> {
    const raw = await get<unknown>(`/api/v1/branches/${branchId}`);
    return adaptBranchSettings(apiBranchSchema.parse(raw));
  },

  /** `GET /api/v1/branches` — every branch in the tenant, for the create-user branch picker. */
  async listBranches(): Promise<BranchSettings[]> {
    const raw = await get<unknown>("/api/v1/branches");
    return z.array(apiBranchSchema).parse(raw).map(adaptBranchSettings);
  },

  /**
   * `PUT /api/v1/branches/{id}` — gated on `rbac.manage | branch.manage`.
   *
   * <p>Despite the verb this is a PATCH: `BranchService.update` applies each field only when it is
   * non-null, so the body carries only what changed. The schema `.parse()` is what stops a stray
   * key (a `tenantId`, an `isHq`) reaching the wire — `UpdateBranchRequest` has no field for either
   * and would drop them, but a request that sends them is a request that believes it can set them.
   */
  async updateBranch(branchId: string, patch: BranchSettingsPatch): Promise<BranchSettings> {
    const body = apiUpdateBranchSchema.parse(patch);
    const raw = await put<unknown, unknown>(`/api/v1/branches/${branchId}`, body);
    return adaptBranchSettings(apiBranchSchema.parse(raw));
  },
};
