package io.restaurantos.platform.controller;

import io.restaurantos.platform.dto.PlatformDtos.*;
import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.platform.service.FeatureFlagAdminService;
import io.restaurantos.platform.service.ImpersonationService;
import io.restaurantos.platform.service.UsageService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Internal API consumed by the gateway and other services (Doc 4 §4.2).
 * Gated by PlatformInternalServiceFilter (X-Internal-Service header), not JWT.
 *
 * Endpoints:
 *   GET  /internal/platform/tenants/{id}/status    → {status, tier}          (gateway fallback for 03-01)
 *   GET  /internal/platform/tenants/{id}/features  → {features: {code: bool}} (gateway fallback for 03-01)
 *   PATCH /internal/platform/tenants/{id}/features/{code} → toggle + dual-key Redis invalidation
 *   POST /internal/platform/tenants/{id}/impersonate      → short-lived JWT (Doc 4 §4.2)
 *   POST /internal/platform/tenants/{id}/usage            → record usage telemetry
 */
@RestController
@RequestMapping("/internal/platform")
public class PlatformInternalController {

    private final TenantRepository tenantRepository;
    private final FeatureFlagAdminService featureFlagService;
    private final ImpersonationService impersonationService;
    private final UsageService usageService;

    public PlatformInternalController(TenantRepository tenantRepository,
                                       FeatureFlagAdminService featureFlagService,
                                       ImpersonationService impersonationService,
                                       UsageService usageService) {
        this.tenantRepository   = tenantRepository;
        this.featureFlagService = featureFlagService;
        this.impersonationService = impersonationService;
        this.usageService       = usageService;
    }

    /**
     * Gateway fallback: returns tenant status, tier and NLQ quota (Doc 4 §4.2, Redis key
     * {@code tenant:status:{tid}}).
     *
     * <p>{@code nlqQuota} was added by 13-14 so the gateway can enforce the quota the tenant
     * actually bought instead of a compiled-in 5,000. It rides along with the status the gateway
     * already fetches and caches on a miss, so per-tenant quota costs no extra round trip and no
     * second cache-miss path.
     */
    @GetMapping("/tenants/{tenantId}/status")
    public ResponseEntity<ApiResponse<StatusResponse>> getStatus(@PathVariable UUID tenantId) {
        return tenantRepository.findById(tenantId)
            .map(t -> ResponseEntity.ok(ApiResponse.ok(
                new StatusResponse(t.getStatus().name(), t.getTier().name(), t.getNlqQuota()))))
            .orElse(ResponseEntity.notFound().build());
    }

    /** Gateway fallback: returns full feature map (Doc 4 §4.2, Redis key tenant_features:{tid}:{code}). */
    @GetMapping("/tenants/{tenantId}/features")
    public ResponseEntity<ApiResponse<FeaturesResponse>> getFeatures(@PathVariable UUID tenantId) {
        return ResponseEntity.ok(ApiResponse.ok(
            new FeaturesResponse(featureFlagService.getFeatures(tenantId))));
    }

    /** Toggle a single feature flag with immediate dual-key Redis invalidation (PLATFORM-04 / SC6). */
    @PatchMapping("/tenants/{tenantId}/features/{featureCode}")
    public ResponseEntity<ApiResponse<Boolean>> setFeature(
            @PathVariable UUID tenantId,
            @PathVariable String featureCode,
            @Valid @RequestBody FeatureToggleRequest req) {
        boolean result = featureFlagService.setFeature(tenantId, featureCode, req.enabled());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    /**
     * Internal impersonation endpoint (Doc 4 §4.2).
     *
     * <p><b>D-34, the internal half.</b> This method passed {@code req.targetUserId()} in the
     * acting-administrator position too, so every audit row it wrote named the impersonated user as
     * their own impersonator. There is no token here to take the real actor from — {@code
     * /internal/**} is authorized by the shared secret — so the caller must supply
     * {@code actingAdminUserId}, and a request without one is REFUSED. Defaulting it to anything is
     * how the defect happened; an audit row naming the wrong person is worse than no row.
     */
    @PostMapping("/tenants/{tenantId}/impersonate")
    public ResponseEntity<ApiResponse<ImpersonateResponse>> impersonate(
            @PathVariable UUID tenantId,
            @Valid @RequestBody ImpersonateRequest req) {
        if (req.actingAdminUserId() == null) {
            throw new IllegalArgumentException(
                "actingAdminUserId is required: the impersonation audit trail must name the platform "
                    + "administrator performing it, and it is never inferred from the target");
        }
        var result = impersonationService.impersonate(
            tenantId, req.targetUserId(), req.actingAdminUserId(), req.reason());
        return ResponseEntity.ok(ApiResponse.ok(
            new ImpersonateResponse(result.token(), result.expiresIn())));
    }

    /** Record usage telemetry for a tenant resource (called by domain services). */
    @PostMapping("/tenants/{tenantId}/usage")
    public ResponseEntity<ApiResponse<UsageRecordResponse>> recordUsage(
            @PathVariable UUID tenantId,
            @Valid @RequestBody UsageRecordRequest req) {
        long newCount = usageService.record(tenantId, req.resource(), req.delta());
        return ResponseEntity.ok(ApiResponse.ok(new UsageRecordResponse(newCount, Long.MAX_VALUE)));
    }
}
