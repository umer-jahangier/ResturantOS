package io.restaurantos.auth.controller;

import io.restaurantos.auth.service.PlatformTokenService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Internal minting endpoint for control-plane (tenant-less) access tokens — PLATFORM-01.
 *
 * <pre>POST /internal/auth/platform-token</pre>
 *
 * <p>Lives under {@code /internal/auth/**}, which SecurityConfig marks {@code permitAll} precisely
 * so the request reaches {@code InternalServiceFilter}'s constant-time secret check rather than
 * being bounced by JWT auth first. No SecurityConfig change accompanies this class;
 * {@code PlatformTokenInternalIT} asserts that rather than assuming it.
 *
 * <p>Deliberately a separate class from {@link AuthProvisioningInternalController} even though the
 * prefix is shared: 13-06 edits that file in the next wave, and sharing a file would serialise two
 * plans that have nothing to do with each other.
 *
 * <p>This endpoint is reachable ONLY on the service port. The gateway maps no route to
 * {@code /internal/auth/**}, and it must stay that way — the internal secret is the whole of the
 * authorization here (threat T-13-01-B).
 */
@RestController
@RequestMapping("/internal/auth")
public class PlatformTokenInternalController {

    private final PlatformTokenService platformTokenService;

    public PlatformTokenInternalController(PlatformTokenService platformTokenService) {
        this.platformTokenService = platformTokenService;
    }

    @PostMapping("/platform-token")
    public ResponseEntity<ApiResponse<Map<String, Object>>> mintPlatformToken(
            @Valid @RequestBody PlatformTokenRequest request) {
        var result = platformTokenService.mint(request.platformUserId(), request.platformRole());
        // LinkedHashMap, not Map.of: the response order is stable, which keeps the shell harness's
        // grep-free JSON reads and any recorded fixtures from depending on hash order.
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("token", result.token());
        body.put("expiresIn", result.expiresIn());
        body.put("tokenType", result.tokenType());
        return ResponseEntity.ok(ApiResponse.ok(body));
    }

    /**
     * @param platformUserId {@code platform_users.id}, asserted by platform-admin-service — which
     *                       is the only service that may read platform_db (PLATFORM-07)
     * @param platformRole   SUPER_ADMIN / SUPPORT / BILLING; anything else is a 400
     */
    record PlatformTokenRequest(@NotNull UUID platformUserId, @NotBlank String platformRole) {}
}
