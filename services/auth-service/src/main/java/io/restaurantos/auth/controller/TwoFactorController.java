package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.request.TotpVerifyRequest;
import io.restaurantos.auth.dto.response.TotpSetupResponse;
import io.restaurantos.auth.service.TwoFactorService;
import io.restaurantos.shared.api.ApiResponse;
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

    public TwoFactorController(TwoFactorService twoFactorService) {
        this.twoFactorService = twoFactorService;
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
