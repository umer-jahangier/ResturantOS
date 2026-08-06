package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.request.PasswordResetConfirmRequest;
import io.restaurantos.auth.dto.request.PasswordResetRequest;
import io.restaurantos.auth.service.PasswordResetService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/auth/reset-password")
public class PasswordResetController {

    private final PasswordResetService passwordResetService;

    public PasswordResetController(PasswordResetService passwordResetService) {
        this.passwordResetService = passwordResetService;
    }

    /**
     * The machine-readable code a client renders when this deployment cannot deliver a reset.
     *
     * <p>Carried as an {@code ApiResponse} warning rather than an error, because the request was
     * accepted and processed — there is simply nothing this deployment can do with it. A 4xx would
     * make a client retry or report a fault; a warning tells it to render a different instruction.
     */
    static final String DELIVERY_DISABLED_CODE = "RESET_DELIVERY_DISABLED";

    static final String DELIVERY_DISABLED_MESSAGE =
        "Self-service password reset is unavailable. Ask an administrator to reset your password, "
        + "or change it from your account settings if you can still sign in.";

    /**
     * Requests a password reset.
     *
     * <p><b>There are exactly two possible responses and only one of them is account-dependent —
     * which is to say, neither is.</b> An unknown address, an unknown tenant, an account inside its
     * cooldown and a successful issuance all produce the identical 200 with an empty warning list.
     * The disabled-mode response differs, and is safe to differ, precisely because it is a property
     * of the DEPLOYMENT rather than of the address: it is the same for every caller and every
     * input, so it answers no question about who exists.
     *
     * <p>The integration tests assert this by comparing response BODIES for byte-equality, not
     * statuses. Two branches that both return 200 while one of them carries an extra field are
     * still an oracle, and a status comparison would not see it.
     */
    @PostMapping("/request")
    public ResponseEntity<ApiResponse<Void>> request(@Valid @RequestBody PasswordResetRequest request) {
        PasswordResetService.RequestOutcome outcome =
            passwordResetService.request(request.email(), request.tenantSlug());

        if (outcome == PasswordResetService.RequestOutcome.DELIVERY_DISABLED) {
            return ResponseEntity.ok(new ApiResponse<>(null, null,
                List.of(new ApiResponse.ApiWarning(DELIVERY_DISABLED_CODE, DELIVERY_DISABLED_MESSAGE))));
        }
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PostMapping("/confirm")
    public ResponseEntity<ApiResponse<Void>> confirm(@Valid @RequestBody PasswordResetConfirmRequest request) {
        passwordResetService.confirm(request.token(), request.newPassword());
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
