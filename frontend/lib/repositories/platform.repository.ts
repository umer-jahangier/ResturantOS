import { del, get, getPaginated, patch, post } from "@/lib/api-client/request";
import {
  apiImpersonationRecordsSchema,
  apiOperatorAuditRecordsSchema,
  apiPlatformTenantSchema,
  apiPlatformTenantsSchema,
  apiProvisionResultSchema,
  apiSubscriptionHistoryRecordsSchema,
  apiSubscriptionLimitReportSchema,
  apiSubscriptionPlanSchema,
  apiSubscriptionPlansSchema,
  apiSubscriptionRegisterSchema,
  apiTenantFeaturesSchema,
  apiTenantSubscriptionSchema,
  apiTenantUsageSchema,
  apiTenantUserPageSchema,
  apiTierChangeSchema,
} from "@/lib/api-client/schemas/platform.schema";
import {
  adaptImpersonationPage,
  adaptOperatorAuditPage,
  adaptPlatformTenant,
  adaptProvisionResult,
  adaptSubscriptionHistoryPage,
  adaptSubscriptionLimits,
  adaptSubscriptionPlan,
  adaptSubscriptionRegister,
  adaptTenantFeatures,
  adaptTenantSubscription,
  adaptTenantUsage,
  adaptTenantUserPage,
  adaptTierChange,
} from "@/lib/adapters/platform.adapter";
import type {
  AssignPlanBody,
  CancelSubscriptionBody,
  ChangeTierBody,
  CreateTenantBody,
  ImpersonationPage,
  OperatorAuditPage,
  PlatformTenant,
  ProvisionResult,
  RenewSubscriptionBody,
  RetryProvisioningBody,
  SubscriptionHistoryPage,
  SubscriptionLimitReport,
  SubscriptionPlan,
  SubscriptionRegister,
  TenantFeatures,
  TenantSubscription,
  TenantUsage,
  TenantUserPage,
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

  /**
   * Take a cancelled tenant out of service permanently.
   *
   * <b>Nothing is deleted.</b> This was `DELETE /tenants/{id}` answering `204 No Content` — the two
   * loudest "it is gone" signals HTTP has — for an operation that only sets a status column, and a
   * caller integrating against that contract would reasonably have reported an erasure to a
   * customer. It is a POST that returns the tenant in its new status, so the response itself shows
   * the resource still existing. The screen must say the same thing in words.
   */
  async closeTenant(tenantId: string): Promise<PlatformTenant> {
    const raw = await post(`/api/v1/platform/tenants/${tenantId}/close`);
    return adaptPlatformTenant(apiPlatformTenantSchema.parse(raw));
  },

  /**
   * Re-drive a PROVISIONING_FAILED tenant through the saga, on the same row.
   *
   * The admin email is mandatory and is not a formality: the pre-13-10 retry passed the literal
   * string `"(retry)"`, so the recovered tenant got an administrator nobody could log in as. Any
   * status other than PROVISIONING_FAILED is refused with 409, and that refusal is surfaced rather
   * than swallowed.
   *
   * The response carries a one-time temporary password with no other delivery channel — there is
   * no email path in this product — so the caller has to show it once and say so.
   */
  async retryProvisioning(tenantId: string, body: RetryProvisioningBody): Promise<ProvisionResult> {
    const raw = await post<RetryProvisioningBody>(
      `/api/v1/platform/tenants/${tenantId}/retry-provisioning`,
      body,
    );
    return adaptProvisionResult(apiProvisionResultSchema.parse(raw));
  },

  /**
   * One tenant's users — the CHEAP path, and the one this console always uses.
   *
   * `GET /api/v1/platform/users` fans out one HTTP call per tenant, because there is no
   * cross-tenant user query anywhere in this product: `auth_db.users` is FORCE row-level security,
   * platform_db holds no grant in auth_db, and the only door takes a single `X-Tenant-Id`. With the
   * tenant known this is one call, and its `scan` block still travels with the rows so the screen
   * can say whether the answer is complete.
   *
   * An unknown tenant is a 404 from the API and is left to surface as one. "This restaurant has no
   * users" and "there is no such restaurant" are opposite answers.
   */
  async listTenantUsers(
    tenantId: string,
    params: {
      status?: string;
      roleCode?: string;
      search?: string;
      page?: number;
      size?: number;
    } = {},
  ): Promise<TenantUserPage> {
    const raw = await get(`/api/v1/platform/tenants/${tenantId}/users`, {
      ...(params.status ? { status: params.status } : {}),
      ...(params.roleCode ? { roleCode: params.roleCode } : {}),
      ...(params.search ? { search: params.search } : {}),
      page: params.page ?? 0,
      size: params.size ?? 50,
    });
    return adaptTenantUserPage(apiTenantUserPageSchema.parse(raw));
  },

  /**
   * A tenant's subscription, or the stated absence of one.
   *
   * A known tenant with no subscription is **200 with `subscription: null`** and a note; an unknown
   * tenant is 404. Those two answers mean opposite things and the repository keeps them apart — it
   * does not turn the 404 into an empty subscription.
   */
  async getSubscription(tenantId: string): Promise<TenantSubscription> {
    const raw = await get(`/api/v1/platform/tenants/${tenantId}/subscription`);
    return adaptTenantSubscription(apiTenantSubscriptionSchema.parse(raw));
  },

  /**
   * Every ceiling the tenant's plan declares, checked where checking is possible.
   *
   * Three of the six dimensions are not measurable by the platform plane at all today — terminals
   * live behind RLS in pos_db, monthly orders in ClickHouse, storage has no producer — and the
   * response says so per row. `exceeded: 0` is not a pass mark unless `anyMeasurable` is true.
   */
  async getSubscriptionLimits(tenantId: string): Promise<SubscriptionLimitReport> {
    const raw = await get(`/api/v1/platform/tenants/${tenantId}/subscription/limits`);
    return adaptSubscriptionLimits(apiSubscriptionLimitReportSchema.parse(raw));
  },

  /**
   * The append-only trail of plan moves, tier changes, trials, renewals and cancellations.
   *
   * This is the half that did not exist: `tenants.tier` was a column an operator overwrote with no
   * record of the previous value anywhere in the product.
   */
  async listSubscriptionHistory(
    tenantId: string,
    page = 0,
    size = 25,
  ): Promise<SubscriptionHistoryPage> {
    const { data, meta } = await getPaginated(
      `/api/v1/platform/tenants/${tenantId}/subscription/history`,
      { page, size },
    );
    return adaptSubscriptionHistoryPage(apiSubscriptionHistoryRecordsSchema.parse(data), meta);
  },

  /**
   * What platform operators have done, filtered to one tenant when a tenant is named.
   *
   * This is the trail every lifecycle action on this console writes to, and it is the reason those
   * actions demand a reason. It is read-only and it names the acting operator from the value stored
   * at write time, so a rotated SuperAdmin credential cannot rewrite its own history.
   */
  async listOperatorAudit(
    params: {
      platformUserId?: string;
      tenantId?: string;
      targetUserId?: string;
      from?: string;
      to?: string;
      page?: number;
      size?: number;
    } = {},
  ): Promise<OperatorAuditPage> {
    const { data, meta } = await getPaginated("/api/v1/platform/operator-audit", {
      ...(params.platformUserId ? { platformUserId: params.platformUserId } : {}),
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.targetUserId ? { targetUserId: params.targetUserId } : {}),
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
      page: params.page ?? 0,
      size: params.size ?? 25,
    });
    return adaptOperatorAuditPage(apiOperatorAuditRecordsSchema.parse(data), meta);
  },

  // ── Plans ──────────────────────────────────────────────────────────────────────────────────

  /**
   * The plan catalogue.
   *
   * Archived plans are hidden by default and that default is kept here: they exist so historical
   * prices stay readable, not so they can be selected by accident — the assign endpoint refuses one
   * with a named 409. A screen that wants to show them asks for them.
   */
  async listPlans(includeInactive = false): Promise<SubscriptionPlan[]> {
    const raw = await get("/api/v1/platform/plans", { includeInactive });
    return apiSubscriptionPlansSchema.parse(raw).map(adaptSubscriptionPlan);
  },

  async getPlan(code: string): Promise<SubscriptionPlan> {
    const raw = await get(`/api/v1/platform/plans/${encodeURIComponent(code)}`);
    return adaptSubscriptionPlan(apiSubscriptionPlanSchema.parse(raw));
  },

  // ── The cross-tenant register ──────────────────────────────────────────────────────────────

  /**
   * Every tenant's subscription, filtered.
   *
   * `trialEndingBefore` and `renewingBefore` are ISO instants the API compares against
   * `trial_end_at` and `current_period_end_at`. They are how "trials expiring" and "renewal date
   * has passed" are asked for — both are derived from the clock, and neither is a payment fact.
   *
   * The response is **not** a paginated envelope: it is a plain body carrying the rows, the server
   * total and the coverage figure, so the caller pages by index rather than by cursor. That is the
   * contract as written; wrapping it in the pager convention here would mean inventing a cursor the
   * API never sent.
   */
  async listSubscriptions(
    params: {
      status?: string;
      planCode?: string;
      trialEndingBefore?: string;
      renewingBefore?: string;
      page?: number;
      size?: number;
    } = {},
  ): Promise<SubscriptionRegister> {
    const raw = await get("/api/v1/platform/subscriptions", {
      ...(params.status ? { status: params.status } : {}),
      ...(params.planCode ? { planCode: params.planCode } : {}),
      ...(params.trialEndingBefore ? { trialEndingBefore: params.trialEndingBefore } : {}),
      ...(params.renewingBefore ? { renewingBefore: params.renewingBefore } : {}),
      page: params.page ?? 0,
      size: params.size ?? 50,
    });
    return adaptSubscriptionRegister(apiSubscriptionRegisterSchema.parse(raw));
  },

  // ── One tenant's subscription lifecycle ────────────────────────────────────────────────────

  /**
   * Assign a plan, or move to a different one — now, or on a future date.
   *
   * Refused with **409 SUBSCRIPTION_LIMIT_EXCEEDED** when the tenant measurably exceeds the target
   * plan's ceilings, naming each violated limit with its usage, unless `force` is set. That refusal
   * is surfaced, never swallowed — and it is not a pass mark in reverse: only measurable dimensions
   * can produce one, so an empty violation list is not a statement that the tenant fits.
   */
  async assignPlan(tenantId: string, body: AssignPlanBody): Promise<TenantSubscription> {
    const raw = await post<AssignPlanBody>(
      `/api/v1/platform/tenants/${tenantId}/subscription`,
      body,
    );
    return adaptTenantSubscription(apiTenantSubscriptionSchema.parse(raw));
  },

  /**
   * Cancel the SUBSCRIPTION. The tenant is untouched — see `CancelSubscriptionBody`.
   */
  async cancelSubscription(
    tenantId: string,
    body: CancelSubscriptionBody,
  ): Promise<TenantSubscription> {
    const raw = await post<CancelSubscriptionBody>(
      `/api/v1/platform/tenants/${tenantId}/subscription/cancel`,
      body,
    );
    return adaptTenantSubscription(apiTenantSubscriptionSchema.parse(raw));
  },

  /**
   * Withdraw a scheduled plan change and/or a scheduled cancellation.
   *
   * 409 NOTHING_SCHEDULED when there is nothing to withdraw, rather than a 200 no-op — an operator
   * who believes they have just called off a downgrade, and has not, will not check again. The
   * refusal is left to surface.
   */
  async cancelScheduledChange(tenantId: string): Promise<TenantSubscription> {
    const raw = await del(`/api/v1/platform/tenants/${tenantId}/subscription/scheduled-change`);
    return adaptTenantSubscription(apiTenantSubscriptionSchema.parse(raw));
  },

  /**
   * Record a renewal an operator knows happened.
   *
   * This exists because the scheduler must NOT roll the period forward on its own: advancing a
   * renewal date asserts that the tenant paid, and nothing in this product observes a payment. A
   * renewal is therefore an assertion, attributed to the operator who made it.
   */
  async renewSubscription(
    tenantId: string,
    body: RenewSubscriptionBody,
  ): Promise<TenantSubscription> {
    const raw = await post<RenewSubscriptionBody>(
      `/api/v1/platform/tenants/${tenantId}/subscription/renew`,
      body,
    );
    return adaptTenantSubscription(apiTenantSubscriptionSchema.parse(raw));
  },
};
