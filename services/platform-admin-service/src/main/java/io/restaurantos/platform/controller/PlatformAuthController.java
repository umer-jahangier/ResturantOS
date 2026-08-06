package io.restaurantos.platform.controller;

import io.restaurantos.platform.dto.PlatformDtos.PlatformLoginRequest;
import io.restaurantos.platform.dto.PlatformDtos.PlatformLoginResponse;
import io.restaurantos.platform.service.PlatformAuthService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The platform (SuperAdmin) login endpoint — {@code POST /api/v1/platform/auth/login}.
 *
 * <h3>Why this is a separate class from {@link PlatformAdminController}</h3>
 * <p>That class carries a class-level {@code @PreAuthorize("hasAuthority('SUPER_ADMIN')")}. A login
 * method on it could only ever be called by a caller who already holds the token the method exists
 * to issue. This class carries <b>no</b> class-level authorization annotation, and must not grow
 * one.
 *
 * <h3>The three places this path is registered, all of which have to agree</h3>
 * <ol>
 *   <li>{@code JwtGlobalFilter.PUBLIC_PATHS} at the gateway — the caller holds no token yet
 *       (added by plan 13-01);</li>
 *   <li>{@code platform-auth-route} in the gateway's {@code application.yml}, declared <b>before</b>
 *       {@code platform-admin-route} because Spring Cloud Gateway takes the first matching route and
 *       that ordering is the only thing giving this credential endpoint its own rate limit
 *       (also 13-01);</li>
 *   <li>{@code PlatformSecurityConfig}'s {@code permitAll} entry — otherwise this service's own
 *       chain 401s the request before the controller runs.</li>
 * </ol>
 * <p>Miss (3) and the endpoint is unreachable; miss (2) and it is reachable but unthrottled, which
 * is threat T-13-05-C. {@code scripts/e2e/phase13-superadmin-e2e.sh} asserts both against the live
 * gateway — including a 429 — because neither can be proven by reading source.
 *
 * <p>No cookie is set on any path, and no refresh credential is issued. See
 * {@link PlatformLoginResponse}.
 */
@RestController
@RequestMapping("/api/v1/platform/auth")
public class PlatformAuthController {

    private final PlatformAuthService platformAuthService;

    public PlatformAuthController(PlatformAuthService platformAuthService) {
        this.platformAuthService = platformAuthService;
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<PlatformLoginResponse>> login(
            @Valid @RequestBody PlatformLoginRequest request,
            HttpServletRequest http) {
        PlatformLoginResponse body =
            platformAuthService.login(request.email(), request.password(), clientIp(http));
        return ResponseEntity.ok(ApiResponse.ok(body));
    }

    /**
     * Best-effort source address for the audit line, matching {@code AuthController.clientIp}.
     * {@code X-Forwarded-For} is client-supplied and therefore forgeable, which is why nothing in
     * {@code PlatformAuthService} makes an authorization or lockout decision from it — the lockout
     * key is the account, not the address.
     */
    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
