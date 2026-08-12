package io.restaurantos.nlq.settings;

import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Settings → AI. A tenant's own AI provider and API key.
 *
 * <pre>
 * GET    /api/v1/nlq/settings/ai    nlq.settings.manage
 * PUT    /api/v1/nlq/settings/ai    nlq.settings.manage   { provider, apiKey }
 * DELETE /api/v1/nlq/settings/ai    nlq.settings.manage   -> revert to the platform key
 * </pre>
 *
 * <h3>hasAuthority, NOT hasAnyAuthority('ROLE_…')</h3>
 *
 * <p>An earlier attempt at this feature ({@code origin/Mufazzal} @ d11d4ae5) guarded all four of
 * its endpoints with {@code hasAnyAuthority('ROLE_OWNER','ROLE_TENANT_ADMIN')}. Shared-lib's
 * {@code JwtAuthenticationFilter} builds authorities with {@code SimpleGrantedAuthority::new} over
 * the raw {@code roles} and {@code permissions} claims and <b>never adds a {@code ROLE_} prefix</b>.
 * {@code hasAnyAuthority} is an exact string match, so a real owner's token carries {@code OWNER},
 * never {@code ROLE_OWNER}, and every one of those endpoints 403s the owner it was built for — a
 * whole settings surface, structurally present and behaviourally absent. Nothing else in
 * {@code services/*} uses a {@code ROLE_} authority.
 *
 * <h3>A permission, not a role</h3>
 *
 * <p>{@code nlq.settings.manage} (auth changelog 094), granted to OWNER and TENANT_ADMIN. A
 * permission rather than a role check means changeset 092's tenant custom roles can be granted it;
 * a hard-coded role list can never be.
 *
 * <h3>Tenant comes from the validated JWT, never from the request</h3>
 *
 * <p>There is no {tenantId} path variable and no header. A client-supplied tenant on a
 * credential-management endpoint would be a cross-tenant key-write primitive.
 */
@RestController
@RequestMapping("/api/v1/nlq/settings/ai")
public class TenantAiSettingsController {

    private final TenantAiSettingsService settingsService;

    public TenantAiSettingsController(TenantAiSettingsService settingsService) {
        this.settingsService = settingsService;
    }

    /**
     * <b>This response contains no key and cannot be made to.</b> {@link AiSettingsView} has no
     * key component; there is no {@code ?includeKey}, no reveal endpoint, and no decrypt on this
     * path. "Replace" is a PUT with a new key.
     */
    @GetMapping
    @PreAuthorize("hasAuthority('nlq.settings.manage')")
    public ApiResponse<AiSettingsView> get(@AuthenticationPrincipal JwtClaims claims) {
        return ApiResponse.ok(settingsService.get(claims.tenantId(), true));
    }

    @PutMapping
    @PreAuthorize("hasAuthority('nlq.settings.manage')")
    public ApiResponse<AiSettingsView> update(@Valid @RequestBody UpdateAiSettingsRequest request,
                                               @AuthenticationPrincipal JwtClaims claims) {
        return ApiResponse.ok(settingsService.update(claims.tenantId(), claims.subject(), request));
    }

    @DeleteMapping
    @PreAuthorize("hasAuthority('nlq.settings.manage')")
    public ApiResponse<AiSettingsView> clear(@AuthenticationPrincipal JwtClaims claims) {
        return ApiResponse.ok(settingsService.clear(claims.tenantId(), claims.subject()));
    }
}
