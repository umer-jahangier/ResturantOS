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

@RestController
@RequestMapping("/api/v1/auth/reset-password")
public class PasswordResetController {

    private final PasswordResetService passwordResetService;

    public PasswordResetController(PasswordResetService passwordResetService) {
        this.passwordResetService = passwordResetService;
    }

    @PostMapping("/request")
    public ResponseEntity<ApiResponse<Void>> request(@Valid @RequestBody PasswordResetRequest request) {
        passwordResetService.request(request.email(), request.tenantSlug());
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PostMapping("/confirm")
    public ResponseEntity<ApiResponse<Void>> confirm(@Valid @RequestBody PasswordResetConfirmRequest request) {
        passwordResetService.confirm(request.token(), request.newPassword());
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
