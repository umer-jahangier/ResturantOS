package io.restaurantos.user.controller;

import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.user.dto.BranchDtos;
import io.restaurantos.user.entity.BranchEntity;
import io.restaurantos.user.service.BranchService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Tenant Admin branch CRUD — tenant-scoped via RLS, no explicit tenant_id filter needed.
 *
 * <p>Mutations require {@code branch.manage} or {@code rbac.manage}. This class previously
 * documented a {@code branch.manage} gate "via SecurityConfig / method security" that existed in
 * neither place: the permission was not in the catalog and no annotation was ever written, so the
 * security config's {@code anyRequest().authenticated()} was the only check and any signed-in user
 * could create or soft-delete a branch. That was repaired by pointing the gates at
 * {@code rbac.manage} — the only tenant-administration code that then existed, and one held by
 * OWNER alone.
 *
 * <p>Phase 13 makes {@code branch.manage} real. It is now in the catalog and granted to OWNER and
 * TENANT_ADMIN, which is what lets a tenant admin administer branches at all. {@code rbac.manage}
 * is kept as an accepted alternative so OWNER's authority is unchanged, and TENANT_ADMIN is
 * deliberately still not granted {@code rbac.manage}: that code is the TOTP step-up trigger in
 * {@code AuthServiceImpl.requiresTotpStepUp}, and granting it would force TOTP enrolment on every
 * tenant admin as a side effect of an authorisation change.
 *
 * <p>Reads stay open to any authenticated user — the branch switcher and every branch-scoped screen
 * need the list, and RLS already confines it to the caller's tenant.
 */
@RestController
@RequestMapping("/api/v1/branches")
public class BranchController {

    private final BranchService branchService;

    public BranchController(BranchService branchService) {
        this.branchService = branchService;
    }

    @PreAuthorize("hasAnyAuthority('rbac.manage', 'branch.manage')")
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

    /** Branches assigned to the signed-in user (branch switcher). */
    @GetMapping("/mine")
    public ResponseEntity<ApiResponse<List<BranchDtos.MineBranchResponse>>> listMine() {
        return ResponseEntity.ok(ApiResponse.ok(branchService.listMine()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<BranchResponse>> get(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(toResponse(branchService.get(id))));
    }

    @PreAuthorize("hasAnyAuthority('rbac.manage', 'branch.manage')")
    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<BranchResponse>> update(
            @PathVariable UUID id,
            @Valid @RequestBody BranchDtos.UpdateBranchRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(toResponse(branchService.update(id, request))));
    }

    @PreAuthorize("hasAnyAuthority('rbac.manage', 'branch.manage')")
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
