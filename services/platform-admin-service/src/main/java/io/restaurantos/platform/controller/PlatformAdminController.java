package io.restaurantos.platform.controller;

import io.restaurantos.platform.config.TierFeatureDefaults;
import io.restaurantos.platform.dto.PlatformDtos.*;
import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.platform.service.FeatureFlagAdminService;
import io.restaurantos.platform.service.ImpersonationQueryService;
import io.restaurantos.platform.service.ImpersonationService;
import io.restaurantos.platform.service.ProvisioningService;
import io.restaurantos.platform.service.TenantLifecycleService;
import io.restaurantos.platform.service.TenantSubscriptionService;
import io.restaurantos.platform.service.UsageService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Public SuperAdmin control-plane API.
 * All endpoints require SUPER_ADMIN role enforced via @PreAuthorize (method-security).
 *
 * Endpoints documented in Docs/agent-specs/04-internal-api-contracts.md §4.2.
 */
@RestController
@RequestMapping("/api/v1/platform")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class PlatformAdminController {

    private final ProvisioningService provisioningService;
    private final TenantLifecycleService lifecycleService;
    private final TenantSubscriptionService subscriptionService;
    private final FeatureFlagAdminService featureFlagService;
    private final ImpersonationService impersonationService;
    private final ImpersonationQueryService impersonationQueryService;
    private final UsageService usageService;
    private final TierFeatureDefaults tierFeatureDefaults;
    private final TenantRepository tenantRepository;

    public PlatformAdminController(ProvisioningService provisioningService,
                                    TenantLifecycleService lifecycleService,
                                    TenantSubscriptionService subscriptionService,
                                    FeatureFlagAdminService featureFlagService,
                                    ImpersonationService impersonationService,
                                    ImpersonationQueryService impersonationQueryService,
                                    UsageService usageService,
                                    TierFeatureDefaults tierFeatureDefaults,
                                    TenantRepository tenantRepository) {
        this.provisioningService = provisioningService;
        this.lifecycleService    = lifecycleService;
        this.subscriptionService = subscriptionService;
        this.featureFlagService  = featureFlagService;
        this.impersonationService = impersonationService;
        this.impersonationQueryService = impersonationQueryService;
        this.usageService        = usageService;
        this.tierFeatureDefaults = tierFeatureDefaults;
        this.tenantRepository    = tenantRepository;
    }

    // --- Tenant CRUD ---

    @PostMapping("/tenants")
    public ResponseEntity<ApiResponse<ProvisionResult>> createTenant(
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody CreateTenantRequest req) {
        String key = idempotencyKey != null ? idempotencyKey : "auto:" + UUID.randomUUID();
        var result = provisioningService.provision(key, req.brandName(), req.adminEmail(), req.tier());
        // The temporary password is returned, not discarded. This line previously substituted the
        // login url for it, which made every provisioned tenant unreachable: the saga generated a
        // credential, the controller dropped it on the floor, and no other channel carried it
        // (notification-service has no source files, so no email was ever sent either). The
        // SuperAdmin now receives it once, over TLS, and delivers it out of band.
        var dto = new ProvisionResult(result.tenantId(), result.slug(), result.adminEmail(),
            result.tempPassword(),
            "https://app.restaurantos.io/login?tenant=" + result.slug());
        return ResponseEntity
            .created(URI.create("/api/v1/platform/tenants/" + result.tenantId()))
            .body(ApiResponse.ok(dto));
    }

    @GetMapping("/tenants")
    public ResponseEntity<ApiResponse<List<TenantResponse>>> listTenants(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        var pageable = org.springframework.data.domain.PageRequest.of(page, size);
        List<TenantResponse> list = tenantRepository.findAll(pageable).stream()
            .map(TenantResponse::from)
            .collect(Collectors.toList());
        return ResponseEntity.ok(ApiResponse.ok(list));
    }

    @GetMapping("/tenants/{tenantId}")
    public ResponseEntity<ApiResponse<TenantResponse>> getTenant(@PathVariable UUID tenantId) {
        return tenantRepository.findById(tenantId)
            .map(t -> ResponseEntity.ok(ApiResponse.ok(TenantResponse.from(t))))
            .orElse(ResponseEntity.notFound().build());
    }

    // --- Subscription & tier management (13-14 / D-35) ---

    /**
     * Edit the tenant's profile and subscription fields. PATCH because every field is optional and
     * an absent one means "leave it alone" — a PUT would imply the body is the whole resource, and
     * a client omitting the brand name would then be asking to clear it.
     */
    @PatchMapping("/tenants/{tenantId}")
    public ResponseEntity<ApiResponse<TenantResponse>> updateTenant(
            @PathVariable UUID tenantId,
            @Valid @RequestBody UpdateTenantRequest req) {
        TenantEntity t = subscriptionService.update(
            tenantId, req.brandName(), req.billingRef(), req.trialEndsAt(), req.renewsAt());
        return ResponseEntity.ok(ApiResponse.ok(TenantResponse.from(t)));
    }

    /**
     * Change the tenant's tier — the destination the {@code X-Upgrade-CTA-URL} header on every
     * FEATURE_DISABLED response has been pointing at since Phase 3 without one existing.
     *
     * <p>Refuses a downgrade below current usage with 409 TIER_LIMIT_EXCEEDED unless
     * {@code force} is set; see {@code TenantSubscriptionService} for what a downgrade does and does
     * not do to tenant data (short version: it gates, it never deletes).
     */
    @PostMapping("/tenants/{tenantId}/tier")
    public ResponseEntity<ApiResponse<TierChangeResponse>> changeTier(
            @PathVariable UUID tenantId,
            @Valid @RequestBody ChangeTierRequest req) {
        TenantEntity.TierType tier;
        try {
            tier = TenantEntity.TierType.valueOf(req.tier().trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Unknown tier '" + req.tier()
                + "' — expected one of STARTER, GROWTH, ENTERPRISE, CUSTOM");
        }
        var result = subscriptionService.changeTier(tenantId, tier, req.forced());
        return ResponseEntity.ok(ApiResponse.ok(TierChangeResponse.from(result)));
    }

    /**
     * Re-drive a PROVISIONING_FAILED tenant through the saga, on the same row.
     *
     * <p>{@code ProvisioningService.retry} existed with no controller since Phase 3 — the audit
     * flagged it — which meant a tenant whose provisioning failed was unrecoverable through the API
     * and had to be repaired by hand in four databases. Refuses any other status with 409.
     */
    @PostMapping("/tenants/{tenantId}/retry-provisioning")
    public ResponseEntity<ApiResponse<ProvisionResult>> retryProvisioning(
            @PathVariable UUID tenantId,
            @Valid @RequestBody RetryProvisioningRequest req) {
        var result = provisioningService.retry(tenantId, req.adminEmail());
        var dto = new ProvisionResult(result.tenantId(), result.slug(), result.adminEmail(),
            result.tempPassword(),
            "https://app.restaurantos.io/login?tenant=" + result.slug());
        return ResponseEntity.ok(ApiResponse.ok(dto));
    }

    // --- Lifecycle transitions ---

    @PostMapping("/tenants/{tenantId}/suspend")
    public ResponseEntity<ApiResponse<TenantResponse>> suspendTenant(
            @PathVariable UUID tenantId,
            @RequestBody ReasonRequest req) {
        TenantEntity t = lifecycleService.suspend(tenantId, req.reason());
        return ResponseEntity.ok(ApiResponse.ok(TenantResponse.from(t)));
    }

    @PostMapping("/tenants/{tenantId}/reactivate")
    public ResponseEntity<ApiResponse<TenantResponse>> reactivateTenant(@PathVariable UUID tenantId) {
        TenantEntity t = lifecycleService.reactivate(tenantId);
        return ResponseEntity.ok(ApiResponse.ok(TenantResponse.from(t)));
    }

    @PostMapping("/tenants/{tenantId}/cancel")
    public ResponseEntity<ApiResponse<TenantResponse>> cancelTenant(
            @PathVariable UUID tenantId,
            @RequestBody ReasonRequest req) {
        TenantEntity t = lifecycleService.cancel(tenantId, req.reason());
        return ResponseEntity.ok(ApiResponse.ok(TenantResponse.from(t)));
    }

    @DeleteMapping("/tenants/{tenantId}")
    public ResponseEntity<Void> purgeTenant(@PathVariable UUID tenantId) {
        lifecycleService.purge(tenantId);
        return ResponseEntity.noContent().build();
    }

    // --- Feature flags ---

    /**
     * A tenant's feature flags, and — since 19c — where each value came from.
     *
     * <p><b>What was missing.</b> This returned a bare {@code Map<String,Boolean>}, so
     * {@code "FEATURE_CRM": false} (an operator's deliberate revocation on control-bistro) and
     * {@code "FEATURE_ANALYTICS": false} (simply not in the STARTER tier) arrived byte-identical.
     * Four rows in this database carry {@code is_override = true} and no client could see one of
     * them. 13-14 added that column so tier reconciliation would neither wipe a deliberate override
     * nor refuse to disable anything; withholding it from the API meant the console could not show
     * an operator which of their settings the next tier change will respect — which is the entire
     * reason the column exists.
     *
     * <p><b>Additive, not a replacement.</b> The {@code features} map is unchanged and still first
     * in the payload, so {@code scripts/e2e/phase13-subscription-e2e.sh} (which greps this body for
     * {@code "FEATURE_X":true}) and {@code superadmin-tenant-lifecycle.spec.ts} keep passing. The
     * gateway's {@code /internal/**} twin is not touched at all: it feeds enforcement, it does not
     * need provenance, and widening an enforcement path to serve a screen is how enforcement paths
     * acquire bugs.
     *
     * <p>Defaults are computed against the tenant's CURRENT tier and that tier is returned
     * alongside, so the screen never has to assume the tenant row it fetched separately is still
     * current.
     */
    @GetMapping("/tenants/{tenantId}/features")
    public ResponseEntity<ApiResponse<TenantFeaturesResponse>> getFeatures(@PathVariable UUID tenantId) {
        TenantEntity tenant = tenantRepository.findById(tenantId)
            .orElseThrow(() -> new IllegalArgumentException("Tenant not found: " + tenantId));
        Map<String, Boolean> defaults = tierFeatureDefaults.defaultsFor(tenant.getTier().name());
        return ResponseEntity.ok(ApiResponse.ok(new TenantFeaturesResponse(
            tenant.getTier().name(),
            featureFlagService.getFeatures(tenantId),
            featureFlagService.getFeatureStates(tenantId, defaults))));
    }

    @PatchMapping("/tenants/{tenantId}/features/{featureCode}")
    public ResponseEntity<ApiResponse<Boolean>> setFeature(
            @PathVariable UUID tenantId,
            @PathVariable String featureCode,
            @Valid @RequestBody FeatureToggleRequest req) {
        boolean result = featureFlagService.setFeature(tenantId, featureCode, req.enabled());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    /**
     * Drop a SuperAdmin override and hand the code back to tier control (19c).
     *
     * <p>The counterpart to {@code PATCH .../features/{code}}, which sets the override marker on
     * every call by design. Without this there is no way back: once touched, a row is excluded from
     * tier reconciliation permanently, and an operator who toggled a flag by mistake has silently
     * pinned it against every future upgrade and downgrade.
     *
     * <p>The value is reset to the current tier's default in the same transaction — a row claiming
     * to be "inherited" while holding the override's value would be contradicted by the very next
     * read.
     */
    @DeleteMapping("/tenants/{tenantId}/features/{featureCode}/override")
    public ResponseEntity<ApiResponse<Boolean>> clearFeatureOverride(
            @PathVariable UUID tenantId,
            @PathVariable String featureCode) {
        TenantEntity tenant = tenantRepository.findById(tenantId)
            .orElseThrow(() -> new IllegalArgumentException("Tenant not found: " + tenantId));
        boolean tierDefault = Boolean.TRUE.equals(
            tierFeatureDefaults.defaultsFor(tenant.getTier().name()).get(featureCode));
        return ResponseEntity.ok(ApiResponse.ok(
            featureFlagService.clearOverride(tenantId, featureCode, tierDefault)));
    }

    // --- Usage against entitlement ---

    /**
     * What this tenant is entitled to, and what they have used where that is knowable (19c).
     *
     * <p>Closes the read half of GA-011 — {@code /usage}, {@code /usage-summary},
     * {@code /entitlements} and {@code /limits} were all <b>404</b> with a valid SUPER_ADMIN token —
     * and GA-083, the four entitlement ceilings that the tenant list has always returned and no UI
     * has ever read.
     *
     * <p><b>It reports honestly that almost nothing is metered.</b> {@code usage_records} holds 0
     * rows with 0 producers and the NLQ counter has 0 keys; exactly one dimension (branches) has a
     * real live count. The response marks each meter as counted / not-metered / unreadable rather
     * than defaulting a missing count to {@code 0}, because a console showing four confident zeros
     * for a tenant with seven branches and forty staff is worse than no console — an operator would
     * act on it. See {@code UsageService.meters}.
     */
    @GetMapping("/tenants/{tenantId}/usage")
    public ResponseEntity<ApiResponse<TenantUsageResponse>> getUsage(@PathVariable UUID tenantId) {
        return ResponseEntity.ok(ApiResponse.ok(usageService.meters(tenantId)));
    }

    // --- Impersonation ---

    /**
     * Assume a tenant user's identity, recording WHO did it.
     *
     * <p><b>D-34.</b> This method used to pass {@code req.targetUserId()} in BOTH the target and the
     * acting-administrator positions. {@code ImpersonationService}'s parameters were correctly
     * named; only this caller was wrong — so {@code impersonation_log.admin_user_id} recorded the
     * impersonated user as their own impersonator, and the {@code impersonated_by} claim on the
     * issued token said the same. The audit's phrasing is that the trail could not answer who
     * impersonated whom, and it is exactly right: every row said "this user impersonated themselves".
     *
     * <p>The acting id now comes from the verified platform principal — the {@code sub} of the
     * RS256-signed control-plane token, which {@code JwtAuthenticationFilter} put in the security
     * context after checking the signature against JWKS. It is not read from the body and not read
     * from a header, because the whole value of a repudiation control is that the subject of the
     * record cannot choose it.
     *
     * <p>With no resolvable platform principal the operation is REFUSED rather than defaulted. There
     * is no safe substitute: any placeholder produces an audit row that names somebody who did not
     * do it, which is worse than no row at all. In practice this cannot be reached through the real
     * gateway (the class-level SUPER_ADMIN gate requires an authenticated token first) — it is
     * belt-and-braces against a future filter change that authenticates without a subject.
     */
    @PostMapping("/tenants/{tenantId}/impersonate")
    public ResponseEntity<ApiResponse<ImpersonateResponse>> impersonate(
            @PathVariable UUID tenantId,
            @Valid @RequestBody ImpersonateRequest req) {
        UUID actingPlatformUserId = requirePlatformPrincipal();
        var result = impersonationService.impersonate(
            tenantId, req.targetUserId(), actingPlatformUserId, req.reason());
        return ResponseEntity.ok(ApiResponse.ok(
            new ImpersonateResponse(result.token(), result.expiresIn())));
    }

    /**
     * {@code GET /api/v1/platform/tenants/{tenantId}/impersonations?from=&to=&page=&size=}
     *
     * <p><b>The half of impersonation accountability that had no reader.</b> The write side has
     * worked since PLATFORM-05: every impersonation writes an immutable {@code impersonation_log}
     * row and publishes {@code IMPERSONATION_STARTED} into the tenant's own audit trail, and the
     * tenant-facing reader for that ({@code GET /api/v1/audit/events}) is built, routed and
     * correctly isolated between tenants. The platform SuperAdmin — the principal whose behaviour
     * the record exists to constrain — had <b>no way to read it at all</b>: this path was 404, and
     * a platform token is refused by the tenant audit endpoint (401, correctly: it carries no
     * tenant claim). The repository finder that would have served it had zero callers.
     *
     * <p>An unknown {@code tenantId} is <b>404</b>, not an empty list. On this screen those two
     * answers mean opposite things and must not look the same.
     *
     * <p>Newest first. Never returns the token — {@code impersonation_log} has no column for it.
     */
    @GetMapping("/tenants/{tenantId}/impersonations")
    public ResponseEntity<ApiResponse<List<ImpersonationRecord>>> tenantImpersonations(
            @PathVariable UUID tenantId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return ResponseEntity.ok(paginate(
            impersonationQueryService.forTenant(tenantId, from, to, page, size)));
    }

    /**
     * {@code GET /api/v1/platform/impersonations?adminUserId=&from=&to=&page=&size=}
     *
     * <p><i>"Where has admin X been?"</i> — the question {@code audit_db} is structurally incapable
     * of answering. {@code audit_events} is per-tenant with FORCED row-level security, so the same
     * question there is one query per tenant with one token per tenant, and it misses any tenant
     * whose outbox delivery failed. Here it is a single read of the row written in the same
     * transaction that minted the token.
     *
     * <p>{@code adminUserId} omitted means every administrator. An {@code adminUserId} that names
     * no surviving account returns an empty page rather than 404 — see
     * {@code ImpersonationQueryService.search} for why that asymmetry with the tenant endpoint is
     * deliberate.
     */
    @GetMapping("/impersonations")
    public ResponseEntity<ApiResponse<List<ImpersonationRecord>>> impersonations(
            @RequestParam(required = false) UUID adminUserId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return ResponseEntity.ok(paginate(
            impersonationQueryService.search(adminUserId, from, to, page, size)));
    }

    /**
     * {@code ApiResponse.paginated} + {@code PageMeta}, matching {@code AuditQueryController}.
     *
     * <p>The cursor fields carry the page NUMBER — {@code PageMeta} is shaped for cursor pagination
     * and this is offset pagination, and one envelope for every list in the platform is worth more
     * than a second one that fits better. A null {@code nextCursor} is the "last page" signal a
     * pager needs; without it a client can only discover the end by asking for a page and receiving
     * nothing, which is indistinguishable from a failed filter.
     */
    private static ApiResponse<List<ImpersonationRecord>> paginate(
            ImpersonationQueryService.PagedImpersonations paged) {
        boolean hasNext = (long) (paged.page() + 1) * paged.size() < paged.totalCount();
        PageMeta meta = new PageMeta(
            new PageMeta.Page(
                String.valueOf(paged.page()),
                hasNext ? String.valueOf(paged.page() + 1) : null,
                paged.size()),
            paged.totalCount());
        return ApiResponse.paginated(paged.records(), meta);
    }

    /**
     * The authenticated platform user's id, or a refusal.
     *
     * <p>Reads {@link JwtClaims#subject()} out of the {@code SecurityContext}. For a platform token
     * that subject is {@code platform_users.id} — {@code JwtSigningService.signPlatformToken} sets
     * it, and the token carries no {@code tenant_id} at all, which is what makes a platform
     * principal distinguishable from a tenant one at this point.
     */
    private UUID requirePlatformPrincipal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        Object principal = authentication != null ? authentication.getPrincipal() : null;
        if (principal instanceof JwtClaims claims && claims.subject() != null) {
            return claims.subject();
        }
        throw new PermissionDeniedException(
            "Impersonation requires an authenticated platform administrator; the acting id is taken "
                + "from the verified token and is never substituted");
    }

    // --- Inner request records ---

    record ReasonRequest(@NotBlank String reason) {}
}
