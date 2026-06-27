package io.restaurantos.platform.controller;

import io.restaurantos.platform.service.FeatureFlagAdminService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Public, tenant-scoped feature-flags endpoint consumed by the web frontend.
 *
 * <p>Returns the list of ENABLED {@code FEATURE_*} codes for the caller's tenant.
 * The tenant is resolved from the validated JWT (the gateway forwards the
 * {@code Authorization} header; {@code JwtAuthenticationFilter} populates the
 * {@link TenantContext}). Unlike {@link PlatformAdminController}, this endpoint
 * is available to ANY authenticated tenant user — not just SUPER_ADMIN — because
 * every signed-in user needs to know which UI modules to render.
 *
 * <p>Route: the gateway forwards {@code GET /api/v1/feature-flags} here. The
 * frontend's {@code FeatureRepository.getFlags()} expects the
 * {@code {data:{features:[...]}}} envelope this returns.
 */
@RestController
@RequestMapping("/api/v1/feature-flags")
public class FeatureFlagPublicController {

    private final FeatureFlagAdminService featureFlagService;
    private final TenantContext tenantContext;

    public FeatureFlagPublicController(FeatureFlagAdminService featureFlagService,
                                       TenantContext tenantContext) {
        this.featureFlagService = featureFlagService;
        this.tenantContext = tenantContext;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<FeatureFlagsResponse>> getMyFeatures() {
        UUID tenantId = tenantContext.requireTenantId();
        List<String> enabled = featureFlagService.getFeatures(tenantId).entrySet().stream()
            .filter(Map.Entry::getValue)
            .map(Map.Entry::getKey)
            .sorted()
            .toList();
        return ResponseEntity.ok(ApiResponse.ok(new FeatureFlagsResponse(enabled)));
    }

    /** Frontend-facing shape: a flat list of enabled feature codes. */
    public record FeatureFlagsResponse(List<String> features) {}
}
