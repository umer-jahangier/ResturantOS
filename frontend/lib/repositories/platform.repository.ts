import { del, get, getPaginated, patch, post } from "@/lib/api-client/request";
import {
  apiImpersonationRecordsSchema,
  apiPlatformTenantSchema,
  apiPlatformTenantsSchema,
  apiProvisionResultSchema,
  apiTenantFeaturesSchema,
  apiTenantUsageSchema,
  apiTierChangeSchema,
} from "@/lib/api-client/schemas/platform.schema";
import {
  adaptImpersonationPage,
  adaptPlatformTenant,
  adaptProvisionResult,
  adaptTenantFeatures,
  adaptTenantUsage,
  adaptTierChange,
} from "@/lib/adapters/platform.adapter";
import type {
  ChangeTierBody,
  CreateTenantBody,
  ImpersonationPage,
  PlatformTenant,
  ProvisionResult,
  TenantFeatures,
  TenantUsage,
  TierChangeResult,
  UpdateTenantBody,
} from "@/lib/models/platform.model";

/**
 * Layer-2c repository for the SuperAdmin control plane (19c).
 *
 * Every endpoint here was verified live against the running gateway with a SUPER_ADMIN token
 * before a caller was written — the audit found 30% of this product's endpoints have no caller and
 * some have no implementation, so "the contract says it exists" is not evidence.
 *
 * The gateway enforces SUPER_ADMIN on all of these. A tenant principal receives 403 from the API
 * regardless of what the browser renders; the route-group guard in `app/(platform)/layout.tsx`
 * exists so such a user is never shown the console in the first place, not because it is the
 * security boundary.
 *
 * ALWAYS `.parse()` — never the non-throwing variant, which would let schema drift reach a
 * component as `undefined` instead of surfacing as an error the QueryBoundary can render.
 */
export const PlatformRepository = {
  /**
   * All tenants. `size` defaults high because the platform tenant count is in the tens, not the
   * thousands, and a paginated console that hides tenant 21 behind a control nobody notices is how
   * a SuperAdmin concludes a tenant was deleted.
   */
  async listTenants(page = 0, size = 200): Promise<PlatformTenant[]> {
    const raw = await get("/api/v1/platform/tenants", { page, size });
    return apiPlatformTenantsSchema.parse(raw).map(adaptPlatformTenant);
  },

  async getTenant(tenantId: string): Promise<PlatformTenant> {
    const raw = await get(`/api/v1/platform/tenants/${tenantId}`);
    return adaptPlatformTenant(apiPlatformTenantSchema.parse(raw));
  },

  /** Provision a tenant. The response carries a one-time password with no other delivery channel. */
  async createTenant(body: CreateTenantBody): Promise<ProvisionResult> {
    const raw = await post<CreateTenantBody>("/api/v1/platform/tenants", body);
    return adaptProvisionResult(apiProvisionResultSchema.parse(raw));
  },

  async updateTenant(tenantId: string, body: UpdateTenantBody): Promise<PlatformTenant> {
    const raw = await patch<UpdateTenantBody>(`/api/v1/platform/tenants/${tenantId}`, body);
    return adaptPlatformTenant(apiPlatformTenantSchema.parse(raw));
  },

  /**
   * Change tier. A downgrade below current usage is refused with 409 TIER_LIMIT_EXCEEDED unless
   * `force` is set — the refusal is the useful behaviour and is surfaced, not swallowed.
   */
  async changeTier(tenantId: string, body: ChangeTierBody): Promise<TierChangeResult> {
    const raw = await post<ChangeTierBody>(`/api/v1/platform/tenants/${tenantId}/tier`, body);
    return adaptTierChange(apiTierChangeSchema.parse(raw));
  },

  async suspendTenant(tenantId: string, reason: string): Promise<PlatformTenant> {
    const raw = await post(`/api/v1/platform/tenants/${tenantId}/suspend`, { reason });
    return adaptPlatformTenant(apiPlatformTenantSchema.parse(raw));
  },

  async reactivateTenant(tenantId: string): Promise<PlatformTenant> {
    const raw = await post(`/api/v1/platform/tenants/${tenantId}/reactivate`);
    return adaptPlatformTenant(apiPlatformTenantSchema.parse(raw));
  },

  async cancelTenant(tenantId: string, reason: string): Promise<PlatformTenant> {
    const raw = await post(`/api/v1/platform/tenants/${tenantId}/cancel`, { reason });
    return adaptPlatformTenant(apiPlatformTenantSchema.parse(raw));
  },

  /**
   * Feature flags WITH provenance (19c).
   *
   * The response also carries the legacy `code → boolean` map; the schema drops it. Two
   * representations of the same fact in one payload is an invitation to read the poorer one.
   */
  async getFeatures(tenantId: string): Promise<TenantFeatures> {
    const raw = await get(`/api/v1/platform/tenants/${tenantId}/features`);
    return adaptTenantFeatures(apiTenantFeaturesSchema.parse(raw));
  },

  /**
   * Toggle a module. The gateway enforces the result via `RouteFeatureMap` on the next request —
   * both Redis key shapes are written synchronously server-side, so there is no TTL to wait out.
   *
   * Every call through here marks the row as an override, by design: an operator touching a flag
   * is making a decision, and that decision outranks the tier default from then on.
   */
  async setFeature(tenantId: string, code: string, enabled: boolean): Promise<boolean> {
    return patch<{ enabled: boolean }, boolean>(
      `/api/v1/platform/tenants/${tenantId}/features/${code}`,
      { enabled },
    );
  },

  /**
   * Drop an override and return the code to tier control (19c).
   *
   * Without this there is no way back: `patchFeature` sets the marker on every call, so a code
   * touched once is excluded from tier reconciliation permanently.
   */
  async clearFeatureOverride(tenantId: string, code: string): Promise<boolean> {
    return del<boolean>(`/api/v1/platform/tenants/${tenantId}/features/${code}/override`);
  },

  /**
   * Usage against entitlement (19c — this path was a 404 before it).
   *
   * Returns meters that may honestly report "not metered": `usage_records` has zero rows and zero
   * producers. Nothing here fills a missing count with a number.
   */
  async getUsage(tenantId: string): Promise<TenantUsage> {
    const raw = await get(`/api/v1/platform/tenants/${tenantId}/usage`);
    return adaptTenantUsage(apiTenantUsageSchema.parse(raw));
  },

  /**
   * One tenant's impersonation history.
   *
   * An unknown tenant is a 404 from the API and is left to surface as one. It must NOT be softened
   * into an empty list here: "nobody has ever impersonated into this restaurant" and "there is no
   * such restaurant" are opposite answers, and this is the screen where confusing them matters.
   */
  async listTenantImpersonations(
    tenantId: string,
    page = 0,
    size = 25,
  ): Promise<ImpersonationPage> {
    const { data, meta } = await getPaginated(
      `/api/v1/platform/tenants/${tenantId}/impersonations`,
      { page, size },
    );
    return adaptImpersonationPage(apiImpersonationRecordsSchema.parse(data), meta);
  },

  /**
   * Impersonations across every tenant — "where has admin X been?".
   *
   * This is the question `audit_events` cannot answer: it is per-tenant with FORCED row-level
   * security, so the same query there is one request per tenant with one token per tenant.
   *
   * `from`/`to` are sent verbatim. The API accepts either a bare date (cut at UTC midnight, which
   * it states) or an exact instant, and refuses anything else with a named 422 rather than quietly
   * dropping the filter.
   */
  async listImpersonations(
    params: {
      adminUserId?: string;
      from?: string;
      to?: string;
      page?: number;
      size?: number;
    } = {},
  ): Promise<ImpersonationPage> {
    const { data, meta } = await getPaginated("/api/v1/platform/impersonations", {
      ...(params.adminUserId ? { adminUserId: params.adminUserId } : {}),
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
      page: params.page ?? 0,
      size: params.size ?? 25,
    });
    return adaptImpersonationPage(apiImpersonationRecordsSchema.parse(data), meta);
  },
};
