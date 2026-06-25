package io.restaurantos.platform.controller;

import io.restaurantos.platform.dto.PlatformDtos.*;
import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.platform.service.FeatureFlagAdminService;
import io.restaurantos.platform.service.ImpersonationService;
import io.restaurantos.platform.service.ProvisioningService;
import io.restaurantos.platform.service.TenantLifecycleService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.List;
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
    private final FeatureFlagAdminService featureFlagService;
    private final ImpersonationService impersonationService;
    private final TenantRepository tenantRepository;

    public PlatformAdminController(ProvisioningService provisioningService,
                                    TenantLifecycleService lifecycleService,
                                    FeatureFlagAdminService featureFlagService,
                                    ImpersonationService impersonationService,
                                    TenantRepository tenantRepository) {
        this.provisioningService = provisioningService;
        this.lifecycleService    = lifecycleService;
        this.featureFlagService  = featureFlagService;
        this.impersonationService = impersonationService;
        this.tenantRepository    = tenantRepository;
    }

    // --- Tenant CRUD ---

    @PostMapping("/tenants")
    public ResponseEntity<ApiResponse<ProvisionResult>> createTenant(
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody CreateTenantRequest req) {
        String key = idempotencyKey != null ? idempotencyKey : "auto:" + UUID.randomUUID();
        var result = provisioningService.provision(key, req.brandName(), req.adminEmail(), req.tier());
        var dto = new ProvisionResult(result.tenantId(), result.slug(),
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

    @GetMapping("/tenants/{tenantId}/features")
    public ResponseEntity<ApiResponse<FeaturesResponse>> getFeatures(@PathVariable UUID tenantId) {
        return ResponseEntity.ok(ApiResponse.ok(new FeaturesResponse(featureFlagService.getFeatures(tenantId))));
    }

    @PatchMapping("/tenants/{tenantId}/features/{featureCode}")
    public ResponseEntity<ApiResponse<Boolean>> setFeature(
            @PathVariable UUID tenantId,
            @PathVariable String featureCode,
            @Valid @RequestBody FeatureToggleRequest req) {
        boolean result = featureFlagService.setFeature(tenantId, featureCode, req.enabled());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    // --- Impersonation ---

    @PostMapping("/tenants/{tenantId}/impersonate")
    public ResponseEntity<ApiResponse<ImpersonateResponse>> impersonate(
            @PathVariable UUID tenantId,
            @Valid @RequestBody ImpersonateRequest req) {
        var result = impersonationService.impersonate(
            tenantId, req.targetUserId(), req.targetUserId(), req.reason());
        return ResponseEntity.ok(ApiResponse.ok(
            new ImpersonateResponse(result.token(), result.expiresIn())));
    }

    // --- Inner request records ---

    record ReasonRequest(@NotBlank String reason) {}
}
