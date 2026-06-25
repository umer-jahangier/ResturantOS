package io.restaurantos.user.controller;

import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.user.dto.BranchDtos;
import io.restaurantos.user.entity.BranchEntity;
import io.restaurantos.user.service.BranchService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Tenant Admin branch CRUD — tenant-scoped via RLS, no explicit tenant_id filter needed.
 * All mutations are authz-gated (branch.manage) via SecurityConfig / method security.
 */
@RestController
@RequestMapping("/api/v1/branches")
public class BranchController {

    private final BranchService branchService;

    public BranchController(BranchService branchService) {
        this.branchService = branchService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<BranchResponse>> create(
            @Valid @RequestBody BranchDtos.CreateBranchRequest request) {
        BranchEntity branch = branchService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(toResponse(branch)));
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<BranchResponse>>> list() {
        List<BranchResponse> branches = branchService.list().stream()
            .map(this::toResponse)
            .toList();
        return ResponseEntity.ok(ApiResponse.ok(branches));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<BranchResponse>> get(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(toResponse(branchService.get(id))));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<BranchResponse>> update(
            @PathVariable UUID id,
            @Valid @RequestBody BranchDtos.UpdateBranchRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(toResponse(branchService.update(id, request))));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        branchService.softDelete(id);
        return ResponseEntity.noContent().build();
    }

    private BranchResponse toResponse(BranchEntity e) {
        return new BranchResponse(
            e.getId(), e.getTenantId(), e.getName(), e.isHq(), e.isActive(),
            e.getAddress(), e.getFbrStrn(), e.getNtn(), e.getPhone(), e.getEmail(),
            e.getTimezone(), e.getCurrencyConfig(), e.getReceiptConfig(), e.getOpenedOn()
        );
    }

    record BranchResponse(
        UUID id, UUID tenantId, String name, boolean isHq, boolean isActive,
        String address, String fbrStrn, String ntn, String phone, String email,
        String timezone, String currencyConfig, String receiptConfig, java.time.LocalDate openedOn
    ) {}
}
