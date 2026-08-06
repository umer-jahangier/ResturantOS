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
        // Prefer the explicit X-Tenant-Id header (back-compat with provisioning-saga callers that
        // send it), else fall back to the tenant claim already populated on this request thread by
        // JwtAuthenticationFilter from the forwarded caller JWT. This removes the RLS GUC's
        // dependence on a header a caller (e.g. reporting-service's internal Feign client) may omit.
        UUID effectiveTenant = (tenantId != null)
                ? tenantId
                : tenantContext.getTenantId().orElse(null);
        if (effectiveTenant != null) {
            setTenantGuc(effectiveTenant);
        }
        BranchEntity branch = branchService.get(branchId);
        return ResponseEntity.ok(branch);
    }

    /**
     * Compensating action for a failed provisioning saga (13-10): soft-deactivate a branch the saga
     * created before it failed. Without this, platform-admin-service's "compensation" for a branch
     * was a {@code log.warn} saying manual cleanup was needed, which named nothing and cleaned up
     * nothing.
     *
     * <p><b>Always 204, whether or not the branch was still live.</b> A compensating action is
     * retried; a second call must not report a failure for work already done. The response
     * therefore carries no "was it there" signal on purpose — a caller that branched on it would be
     * building a race into its error handling.
     *
     * <p>{@code X-Tenant-Id} is required and is not decoration: {@code branches} is FORCE ROW LEVEL
     * SECURITY on {@code app.current_tenant_id} and there is no JWT on {@code /internal/**}, so
     * without it the update matches zero rows and reports success — the exact green-but-broken
     * shape this phase has already found on five separate paths.
     */
    @DeleteMapping("/branches/{branchId}")
    public ResponseEntity<Void> deactivateBranch(@PathVariable UUID branchId,
                                                 @RequestHeader("X-Tenant-Id") UUID tenantId) {
        setTenantGuc(tenantId);
        branchService.deactivateInternal(branchId);
        return ResponseEntity.noContent().build();
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
