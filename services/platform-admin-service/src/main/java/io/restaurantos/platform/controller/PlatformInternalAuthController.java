package io.restaurantos.platform.controller;

import io.restaurantos.platform.exception.PlatformAuthenticationFailedException;
import io.restaurantos.platform.service.PlatformAuthService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * The platform half of the unified email-first login — {@code POST /internal/platform/auth/verify}.
 *
 * <h3>What this exists for</h3>
 * <p>16a-01 makes {@code POST /api/v1/auth/login} accept an email and a password with <b>no tenant
 * slug</b>. auth-service therefore has to answer "does this credential belong to a platform user?",
 * and it cannot answer that itself: PLATFORM-07 says only this service connects to
 * {@code platform_db}. So it asks, here, over the internal channel.
 *
 * <h3>Why this is a verification endpoint and not a token endpoint</h3>
 * <p>It returns an <i>identity</i>, not a credential. auth-service already holds the RSA private key
 * and already mints control-plane tokens ({@code PlatformTokenService}), so having this endpoint
 * mint one would send the login on a third hop back to the service that is asking. The split is the
 * same one 13-05 drew and for the same reason — this service owns the password because it owns the
 * table; auth-service owns the token because it owns the key.
 *
 * <h3>The response says nothing a refusal could be read from</h3>
 * <p>Success is {@code {matched:true, platformUserId, role}}. Every failure — unknown address, wrong
 * password, deactivated account, non-mintable role, lockout — is the single constant
 * {@code {matched:false}}, HTTP 200. <b>Not</b> a 401: a status code that differed between "no such
 * platform user" and "wrong password" would hand auth-service a distinction it would then have to
 * remember not to forward, and the only reliable way not to forward a distinction is not to receive
 * one. {@link PlatformAuthService#verifyCredential} performs exactly one bcrypt comparison on every
 * one of those paths, so the timing does not distinguish them either.
 *
 * <h3>Reachability</h3>
 * <p>{@code /internal/platform/**} is gated by {@code PlatformSecurityConfig.PlatformInternalServiceFilter}'s
 * constant-time {@code X-Internal-Service} check and is mapped by NO gateway route. It is reachable
 * on the service port only. Nothing is added to the gateway's {@code PUBLIC_PATHS} for this plan —
 * the public entry point is {@code /api/v1/auth/login}, which has been public since Phase 3.
 */
@RestController
@RequestMapping("/internal/platform/auth")
public class PlatformInternalAuthController {

    private final PlatformAuthService platformAuthService;

    public PlatformInternalAuthController(PlatformAuthService platformAuthService) {
        this.platformAuthService = platformAuthService;
    }

    /**
     * @param sourceAddress forwarded by auth-service so the audit line names the human's address
     *                      rather than the calling service's. Optional, and never used for any
     *                      authorization or lockout decision — see {@code PlatformAuthController.clientIp}.
     */
    @PostMapping("/verify")
    public ResponseEntity<ApiResponse<VerifyResponse>> verify(
            @Valid @RequestBody VerifyRequest request,
            @RequestHeader(value = "X-Source-Address", required = false) String sourceAddress) {
        try {
            var user = platformAuthService.verifyCredential(
                request.email(), request.password(), sourceAddress);
            return ResponseEntity.ok(ApiResponse.ok(
                new VerifyResponse(true, user.getId(), user.getRole().name())));
        } catch (PlatformAuthenticationFailedException e) {
            // The reason is deliberately dropped here rather than mapped. It has already been
            // logged with its detail by verifyCredential, which is where an operator looks.
            return ResponseEntity.ok(ApiResponse.ok(VerifyResponse.NO_MATCH));
        }
    }

    /**
     * {@code password} carries a live credential. The record's generated {@code toString()} would
     * print it, and Spring's request logging, a debugger and a {@code log.debug("{}", request)} all
     * reach for {@code toString()} — so it is overridden, exactly as
     * {@code AuthInternalClient.ProvisionAdminData} overrides its own.
     */
    public record VerifyRequest(@NotBlank String email, @NotBlank String password) {
        @Override
        public String toString() {
            return "VerifyRequest[email=" + email + ", password=<redacted>]";
        }
    }

    /** {@code platformUserId} and {@code role} are null on every non-match, without exception. */
    public record VerifyResponse(boolean matched, UUID platformUserId, String role) {
        static final VerifyResponse NO_MATCH = new VerifyResponse(false, null, null);
    }
}
