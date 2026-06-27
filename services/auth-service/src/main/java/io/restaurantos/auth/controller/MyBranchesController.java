package io.restaurantos.auth.controller;

import io.restaurantos.auth.dto.response.BranchRoleAssignmentResponse;
import io.restaurantos.auth.exception.BranchSwitchDeniedException;
import io.restaurantos.auth.service.BranchAssignmentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/auth")
public class MyBranchesController {

    private final BranchAssignmentService branchAssignmentService;

    public MyBranchesController(BranchAssignmentService branchAssignmentService) {
        this.branchAssignmentService = branchAssignmentService;
    }

    @GetMapping("/my-branches")
    public ResponseEntity<ApiResponse<List<BranchRoleAssignmentResponse>>> myBranches() {
        JwtClaims claims = currentClaims();
        List<BranchRoleAssignmentResponse> assignments =
            branchAssignmentService.listActive(claims.tenantId(), claims.subject());
        return ResponseEntity.ok(ApiResponse.ok(assignments));
    }

    private JwtClaims currentClaims() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof JwtClaims claims)) {
            throw new BranchSwitchDeniedException("Not authenticated");
        }
        return claims;
    }
}
