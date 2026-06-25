package io.restaurantos.user.controller;

import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.user.dto.BranchDtos;
import io.restaurantos.user.entity.BranchEntity;
import io.restaurantos.user.service.BranchService;
import jakarta.persistence.EntityManager;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Internal branch endpoints — gated by UserInternalServiceFilter (X-Internal-Service header).
 * These endpoints are consumed by the provisioning saga (03-02) and downstream services.
 * NOT exposed through the public gateway.
 *
 * POST  /internal/users/branches          — FD-1 step 4: create HQ branch for a new tenant
 * GET   /internal/users/branches/{id}     — branch detail for a specific branch
 * GET   /internal/users/tenants/{id}/branches — all branches for a tenant
 */
@RestController
@RequestMapping("/internal/users")
public class BranchInternalController {

    private final BranchService branchService;
    private final TenantContext tenantContext;
    private final EntityManager entityManager;

    public BranchInternalController(BranchService branchService,
                                    TenantContext tenantContext,
                                    EntityManager entityManager) {
        this.branchService = branchService;
        this.tenantContext = tenantContext;
        this.entityManager = entityManager;
    }

    /**
     * FD-1 step 4: Create the HQ branch for a newly provisioned tenant.
     * Called by the provisioning saga with a tenantId in the request body.
     * Sets the tenant GUC so the RLS-scoped INSERT lands under the correct tenant.
     */
    @PostMapping("/branches")
    public ResponseEntity<BranchDtos.InternalCreateBranchResponse> createBranch(
            @Valid @RequestBody BranchDtos.InternalCreateBranchRequest request) {
        setTenantGuc(request.tenantId());
        BranchEntity branch = branchService.createInternal(request);
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(new BranchDtos.InternalCreateBranchResponse(branch.getId()));
    }

    /**
     * Return branch detail for a specific branch id (used by downstream services for JWT issuance).
     */
    @GetMapping("/branches/{branchId}")
    public ResponseEntity<BranchEntity> getBranch(@PathVariable UUID branchId,
                                                   @RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId) {
        if (tenantId != null) {
            setTenantGuc(tenantId);
        }
        BranchEntity branch = branchService.get(branchId);
        return ResponseEntity.ok(branch);
    }

    /**
     * Return all live branches for a tenant (provisioning and permission-computation use cases).
     */
    @GetMapping("/tenants/{tenantId}/branches")
    public ResponseEntity<List<BranchEntity>> getBranchesByTenant(@PathVariable UUID tenantId) {
        setTenantGuc(tenantId);
        List<BranchEntity> branches = branchService.listByTenantId(tenantId);
        return ResponseEntity.ok(branches);
    }

    /** Set app.current_tenant_id GUC so RLS-scoped queries operate on the correct tenant. */
    private void setTenantGuc(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
        tenantContext.set(tenantId, null, null, null);
    }
}
