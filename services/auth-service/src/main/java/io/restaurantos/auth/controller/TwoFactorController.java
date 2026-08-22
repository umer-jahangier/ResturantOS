package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.request.TotpBootstrapRequest;
import io.restaurantos.auth.dto.request.TotpDisableRequest;
import io.restaurantos.auth.dto.request.TotpVerifyRequest;
import io.restaurantos.auth.dto.response.RecoveryCodesResponse;
import io.restaurantos.auth.dto.response.TotpSetupResponse;
import io.restaurantos.auth.dto.response.TwoFactorStatusResponse;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.service.AuthService;
import io.restaurantos.auth.service.TwoFactorService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth/2fa")
public class TwoFactorController {

    private final TwoFactorService twoFactorService;
    private final AuthService authService;

    public TwoFactorController(TwoFactorService twoFactorService, AuthService authService) {
        this.twoFactorService = twoFactorService;
        this.authService = authService;
    }

    /**
     * First-time enrolment for a user the step-up rule locks out before they can hold a token.
     * Unauthenticated by necessity and re-authenticated by password on every call; refuses once a
     * secret exists, so it can only ever break a deadlock, never re-point a live second factor.
     */
    @PostMapping("/bootstrap")
    public ResponseEntity<ApiResponse<TotpSetupResponse>> bootstrap(
            @Valid @RequestBody TotpBootstrapRequest request, HttpServletRequest http) {
        UserEntity user = authService.authenticateForTotpBootstrap(
                request.tenantSlug(), request.email(), request.password(), http.getRemoteAddr());
        return ResponseEntity.ok(ApiResponse.ok(twoFactorService.bootstrap(user)));
    }

    /** Returns the recovery codes — the only time they are ever sent. See {@link RecoveryCodesResponse}. */
    @PostMapping("/bootstrap/verify")
    public ResponseEntity<ApiResponse<RecoveryCodesResponse>> bootstrapVerify(
            @Valid @RequestBody TotpBootstrapRequest request, HttpServletRequest http) {
        UserEntity user = authService.authenticateForTotpBootstrap(
                request.tenantSlug(), request.email(), request.password(), http.getRemoteAddr());
        return ResponseEntity.ok(ApiResponse.ok(
                new RecoveryCodesResponse(twoFactorService.bootstrapVerify(user, request.code()))));
    }

    /**
     * Issues a secret. Requires a live authenticator code IF one is already enrolled — see
     * {@code TwoFactorService.setup} for the takeover this closes. First-time enrolment sends
     * {@code code: null}, which is why the body is optional rather than {@code @Valid @NotBlank}.
     */
    @PostMapping("/setup")
    public ResponseEntity<ApiResponse<TotpSetupResponse>> setup(
            @RequestBody(required = false) TotpVerifyRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(
                twoFactorService.setup(request == null ? null : request.code())));
    }

    /** Returns the recovery codes — the only time they are ever sent. */
    @PostMapping("/verify")
    public ResponseEntity<ApiResponse<RecoveryCodesResponse>> verify(
            @Valid @RequestBody TotpVerifyRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(
                new RecoveryCodesResponse(twoFactorService.verify(request.code()))));
    }

    /** Accepts an authenticator code OR a recovery code — see {@link TotpDisableRequest}. */
    @PostMapping("/disable")
    public ResponseEntity<ApiResponse<Void>> disable(@Valid @RequestBody TotpDisableRequest request) {
        twoFactorService.disable(request.code());
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    /**
     * Replaces the recovery-code set. Requires a live authenticator code, never a recovery code —
     * {@code TwoFactorService.regenerateRecoveryCodes} explains why that asymmetry matters.
     */
    @PostMapping("/recovery-codes")
    public ResponseEntity<ApiResponse<RecoveryCodesResponse>> regenerateRecoveryCodes(
            @Valid @RequestBody TotpVerifyRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(
                new RecoveryCodesResponse(twoFactorService.regenerateRecoveryCodes(request.code()))));
    }

    /** Whether 2FA is on and how many recovery codes are left. Never returns the codes themselves. */
    @GetMapping("/status")
    public ResponseEntity<ApiResponse<TwoFactorStatusResponse>> status() {
        return ResponseEntity.ok(ApiResponse.ok(twoFactorService.status()));
    }
}
