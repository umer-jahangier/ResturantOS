package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.request.TotpBootstrapRequest;
import io.restaurantos.auth.dto.request.TotpVerifyRequest;
import io.restaurantos.auth.dto.response.TotpSetupResponse;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.service.AuthService;
import io.restaurantos.auth.service.TwoFactorService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
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

    @PostMapping("/bootstrap/verify")
    public ResponseEntity<ApiResponse<Void>> bootstrapVerify(
            @Valid @RequestBody TotpBootstrapRequest request, HttpServletRequest http) {
        UserEntity user = authService.authenticateForTotpBootstrap(
                request.tenantSlug(), request.email(), request.password(), http.getRemoteAddr());
        twoFactorService.bootstrapVerify(user, request.code());
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PostMapping("/setup")
    public ResponseEntity<ApiResponse<TotpSetupResponse>> setup() {
        return ResponseEntity.ok(ApiResponse.ok(twoFactorService.setup()));
    }

    @PostMapping("/verify")
    public ResponseEntity<ApiResponse<Void>> verify(@Valid @RequestBody TotpVerifyRequest request) {
        twoFactorService.verify(request.code());
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PostMapping("/disable")
    public ResponseEntity<ApiResponse<Void>> disable(@Valid @RequestBody TotpVerifyRequest request) {
        twoFactorService.disable(request.code());
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
