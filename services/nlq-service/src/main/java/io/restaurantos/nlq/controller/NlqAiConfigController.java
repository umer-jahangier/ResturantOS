package io.restaurantos.nlq.controller;

import io.restaurantos.nlq.aiconfig.AiConfigRequest;
import io.restaurantos.nlq.aiconfig.AiConfigResponse;
import io.restaurantos.nlq.aiconfig.AiConfigTestRequest;
import io.restaurantos.nlq.aiconfig.AiConfigTestResponse;
import io.restaurantos.nlq.aiconfig.TenantAiConfigService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * CRUD + test-connection for per-tenant AI / LLM configuration (BYOK multi-provider).
 *
 * <p>Gated to OWNER and TENANT_ADMIN roles — other roles have no business configuring the
 * tenant's API key or seeing even the masked version.
 *
 * <p>All values derived from the validated JWT ({@link JwtClaims}) — never a client-supplied
 * header or request field for the tenant ID.
 */
@RestController
@RequestMapping("/api/v1/nlq/ai-config")
public class NlqAiConfigController {

    private final TenantAiConfigService aiConfigService;

    public NlqAiConfigController(TenantAiConfigService aiConfigService) {
        this.aiConfigService = aiConfigService;
    }

    /**
     * Get the tenant's current AI config (masked API key, provider, models, enabled status).
     * Returns 200 with null data if no config exists.
     */
    @GetMapping
    @PreAuthorize("hasAnyAuthority('ROLE_OWNER','ROLE_TENANT_ADMIN')")
    public ApiResponse<AiConfigResponse> getConfig(@AuthenticationPrincipal JwtClaims claims) {
        return ApiResponse.ok(aiConfigService.getConfig(claims.tenantId()).orElse(null));
    }

    /**
     * Create or update the tenant's AI config. Idempotent.
     */
    @PutMapping
    @PreAuthorize("hasAnyAuthority('ROLE_OWNER','ROLE_TENANT_ADMIN')")
    public ApiResponse<AiConfigResponse> saveConfig(@Valid @RequestBody AiConfigRequest request,
                                                     @AuthenticationPrincipal JwtClaims claims) {
        return ApiResponse.ok(aiConfigService.saveConfig(claims.tenantId(), request));
    }

    /**
     * Delete the tenant's AI config. NLQ becomes unconfigured until re-added.
     */
    @DeleteMapping
    @PreAuthorize("hasAnyAuthority('ROLE_OWNER','ROLE_TENANT_ADMIN')")
    public ResponseEntity<Void> deleteConfig(@AuthenticationPrincipal JwtClaims claims) {
        aiConfigService.deleteConfig(claims.tenantId());
        return ResponseEntity.noContent().build();
    }

    /**
     * Test connection with provided credentials. Does NOT save anything — purely a validation call.
     */
    @PostMapping("/test")
    @PreAuthorize("hasAnyAuthority('ROLE_OWNER','ROLE_TENANT_ADMIN')")
    public ApiResponse<AiConfigTestResponse> testConnection(
            @Valid @RequestBody AiConfigTestRequest request) {
        return ApiResponse.ok(aiConfigService.testConnection(request));
    }
}
