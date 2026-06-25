import { get } from "@/lib/api-client/request";
import { apiFeatureFlagsSchema } from "@/lib/api-client/schemas/auth.schema";
import { adaptFeatureFlags } from "@/lib/adapters/auth.adapter";
import type { FeatureFlags } from "@/lib/models/auth.model";

// Layer-2c repository for tenant feature flags (D4). MSW-backed in Phase 4; the
// live gateway endpoint shape must be confirmed against the Phase-3 contract.
export const FeatureRepository = {
  async getFlags(): Promise<FeatureFlags> {
    const raw = await get("/api/v1/feature-flags");
    return adaptFeatureFlags(apiFeatureFlagsSchema.parse(raw));
  },
};
