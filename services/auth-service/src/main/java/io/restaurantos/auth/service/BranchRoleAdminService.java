package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.request.BranchRoleAssignRequest;
import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class BranchRoleAdminService {

    private final UserBranchRoleRepository userBranchRoleRepository;
    private final TenantContext tenantContext;

    public BranchRoleAdminService(UserBranchRoleRepository userBranchRoleRepository,
                                  TenantContext tenantContext) {
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.tenantContext = tenantContext;
    }

    /**
     * Upsert a user_branch_roles row for the given user + branch + role.
     * auth-service is the system of record for user_branch_roles — this is the ONLY
     * write path. Called by AuthInternalController; never called from user-service directly.
     */
    @Transactional
    public UserBranchRoleEntity assign(UUID tenantId, UUID userId, BranchRoleAssignRequest req) {
        UserBranchRoleEntity entity = userBranchRoleRepository
            .findByUserIdAndBranchIdAndRoleCode(userId, req.branchId(), req.roleCode())
            .orElseGet(() -> {
                UserBranchRoleEntity e = new UserBranchRoleEntity();
                e.setId(UUID.randomUUID());
                e.setTenantId(tenantId);
                e.setUserId(userId);
                e.setBranchId(req.branchId());
                e.setRoleCode(req.roleCode());
                return e;
            });
        entity.setActive(true);
        entity.setApprovalLimitPaisa(req.approvalLimitPaisa());
        return userBranchRoleRepository.save(entity);
    }

    /**
     * Soft-deactivate the branch-role assignment (active=false).
     * A hard-delete is avoided so audit history is preserved.
     */
    @Transactional
    public void revoke(UUID tenantId, UUID userId, UUID branchId, String roleCode) {
        userBranchRoleRepository
            .findByUserIdAndBranchIdAndRoleCode(userId, branchId, roleCode)
            .ifPresent(e -> {
                e.setActive(false);
                userBranchRoleRepository.save(e);
            });
    }
}
