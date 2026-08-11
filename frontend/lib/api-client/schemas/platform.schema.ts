import { z } from "zod";

// Layer-1 wire schemas for /api/v1/platform/**. Every repository call `.parse()`s through one of
// these — the throwing variant, always, so schema drift surfaces as a caught error the
// QueryBoundary renders rather than as `undefined` reaching a component.

export const apiTierSchema = z.enum(["STARTER", "GROWTH", "ENTERPRISE", "CUSTOM"]);

export const apiTenantStatusSchema = z.enum([
  "PROVISIONING",
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "PURGED",
  "PROVISIONING_FAILED",
]);

/**
 * Mirrors `PlatformDtos.TenantResponse`.
 *
 * The four entitlement ceilings are `.nullable()` because the columns are nullable, and a null
 * ceiling is a real state the usage screen has to be able to render honestly rather than coerce
 * to 0 — a 0 ceiling would make every meter read "over limit".
 */
export const apiPlatformTenantSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  brandName: z.string(),
  status: apiTenantStatusSchema,
  tier: apiTierSchema,
  createdAt: z.string(),
  suspendedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  maxBranches: z.number().nullable(),
  maxUsers: z.number().nullable(),
  storageGb: z.number().nullable(),
  nlqQuota: z.number().nullable(),
  billingRef: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  renewsAt: z.string().nullable(),
});

export const apiPlatformTenantsSchema = z.array(apiPlatformTenantSchema);

export const apiFeatureSourceSchema = z.enum([
  "TIER_DEFAULT",
  "OVERRIDE_MATCHES_TIER",
  "OVERRIDE_GRANT",
  "OVERRIDE_REVOKE",
  "UNSEEDED",
]);

export const apiFeatureStateSchema = z.object({
  code: z.string(),
  enabled: z.boolean(),
  tierDefault: z.boolean(),
  isOverride: z.boolean(),
  source: apiFeatureSourceSchema,
});

/**
 * Mirrors `PlatformDtos.TenantFeaturesResponse` (19c).
 *
 * `features` — the legacy `code → boolean` map — is still sent and is deliberately NOT parsed
 * here. It carries strictly less information than `featureStates`, and accepting both would let a
 * component read the poorer one by accident, which is the defect this response shape was widened
 * to remove. Zod strips unknown keys by default, so it simply does not survive the boundary.
 */
export const apiTenantFeaturesSchema = z.object({
  tier: apiTierSchema,
  featureStates: z.array(apiFeatureStateSchema),
});

/**
 * Mirrors `PlatformDtos.UsageMeter`.
 *
 * `used` is `.nullable()` and that nullability is load-bearing: null means "nobody counts this",
 * 0 means "counted, and the answer was none". Defaulting null to 0 anywhere between here and the
 * screen reintroduces exactly the fabrication this endpoint was designed to avoid.
 */
export const apiUsageMeterSchema = z.object({
  resource: z.string(),
  unit: z.string(),
  used: z.number().nullable(),
  limit: z.number(),
  metered: z.boolean(),
  unavailable: z.boolean(),
  source: z.string(),
});

export const apiTenantUsageSchema = z.object({
  tenantId: z.string().uuid(),
  tier: apiTierSchema,
  meters: z.array(apiUsageMeterSchema),
  anyMetered: z.boolean(),
});

/**
 * Mirrors `PlatformDtos.ProvisionResult`.
 *
 * `tempPassword` is nullable on one path only — an idempotent replay after the credential's
 * one-hour retention window. The tenant still exists; the credential is simply gone, and the
 * screen has to say that rather than render an empty box that looks like a bug.
 */
export const apiProvisionResultSchema = z.object({
  tenantId: z.string().uuid(),
  slug: z.string(),
  adminEmail: z.string(),
  tempPassword: z.string().nullable(),
  loginUrl: z.string(),
});

export const apiTierChangeSchema = z.object({
  tenantId: z.string().uuid(),
  previousTier: apiTierSchema,
  tier: apiTierSchema,
  changedFeatureCodes: z.array(z.string()),
  maxBranches: z.number(),
  maxUsers: z.number(),
  storageGb: z.number(),
  nlqQuota: z.number(),
  forcedOverLimits: z.boolean(),
});

export type ApiPlatformTenant = z.infer<typeof apiPlatformTenantSchema>;
export type ApiTenantFeatures = z.infer<typeof apiTenantFeaturesSchema>;
export type ApiTenantUsage = z.infer<typeof apiTenantUsageSchema>;
export type ApiProvisionResult = z.infer<typeof apiProvisionResultSchema>;
export type ApiTierChange = z.infer<typeof apiTierChangeSchema>;
