package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.request.SwitchBranchRequest;
import io.restaurantos.auth.dto.response.TokenResponse;
import io.restaurantos.auth.service.BranchSwitchService;
import io.restaurantos.shared.api.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class BranchSwitchController {

    private final BranchSwitchService branchSwitchService;

    public BranchSwitchController(BranchSwitchService branchSwitchService) {
        this.branchSwitchService = branchSwitchService;
    }

    @PostMapping("/switch-branch")
    public ResponseEntity<ApiResponse<TokenResponse>> switchBranch(
            @Valid @RequestBody SwitchBranchRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(branchSwitchService.switchBranch(request.branchId())));
    }
}
