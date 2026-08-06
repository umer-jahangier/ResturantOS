package io.restaurantos.auth.service;

import io.restaurantos.auth.dto.request.BranchRoleAssignRequest;
import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class BranchRoleAdminService {

    private static final Logger log = LoggerFactory.getLogger(BranchRoleAdminService.class);

    private final UserBranchRoleRepository userBranchRoleRepository;
    private final TenantContext tenantContext;

    public BranchRoleAdminService(UserBranchRoleRepository userBranchRoleRepository,
                                  TenantContext tenantContext) {
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.tenantContext = tenantContext;
    }

    /**
     * The saved assignment, and the role code it replaced.
     *
     * <p>{@code displacedRoleCode} is null when nothing was replaced — a first assignment, or a
     * re-assignment of the role the user already held. It is returned rather than logged because
     * assigning a role at a branch where the user already has one is a <em>revocation</em> of the
     * old role as much as a grant of the new one, and an administrator who is not told that has no
     * way to know it happened.
     */
    public record RoleAssignmentResult(UserBranchRoleEntity assignment, String displacedRoleCode) {}

    /**
     * Assign a role to a user at a branch. auth-service is the system of record for
     * user_branch_roles — this is the ONLY write path. Called by AuthInternalController; never
     * called from user-service directly.
     *
     * <p>A user holds at most one active role per branch, held by a partial unique index on
     * {@code (user_id, branch_id) WHERE is_active}. Assigning a second, different role is therefore
     * a REPLACEMENT, not an addition: any other active row for the pair is deactivated in this same
     * transaction. Permission unions across roles are deliberately not supported — the JWT's
     * {@code roles} claim is singular and every downstream consumer of it assumes so, and a tenant
     * needing a blend of two roles needs a role that carries the blend.
     */
    @Transactional
    public RoleAssignmentResult assign(UUID tenantId, UUID userId, BranchRoleAssignRequest req) {
        List<UserBranchRoleEntity> activeAtBranch =
            userBranchRoleRepository.findByUserIdAndBranchIdAndActiveTrue(userId, req.branchId());
        boolean hadNoActiveAssignmentAnywhere =
            userBranchRoleRepository.findByUserIdAndActiveTrue(userId).isEmpty();

        String displacedRoleCode = null;
        boolean displacedWasPrimary = false;
        for (UserBranchRoleEntity other : activeAtBranch) {
            if (other.getRoleCode().equals(req.roleCode())) {
                continue;
            }
            other.setActive(false);
            // A deactivated row must not keep the primary flag: it would survive into the next
            // reactivation and collide with whichever row is primary by then.
            displacedWasPrimary |= other.isPrimary();
            other.setPrimary(false);
            displacedRoleCode = other.getRoleCode();
            log.info("Displacing role {} for user {} at branch {} — replaced by {}",
                other.getRoleCode(), userId, req.branchId(), req.roleCode());
            // Flushed before the new row is written. Hibernate orders inserts ahead of updates
            // within a flush, so without this the insert would hit the partial unique index while
            // the row it replaces is still active, and a legitimate replacement would fail as a
            // constraint violation.
            userBranchRoleRepository.saveAndFlush(other);
        }

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
        // The user's first assignment becomes their default branch at login; so does a role that
        // replaces the assignment that was previously default, so a replacement never leaves a user
        // with active assignments and no primary among them.
        if (hadNoActiveAssignmentAnywhere || displacedWasPrimary) {
            entity.setPrimary(true);
        }

        return new RoleAssignmentResult(userBranchRoleRepository.save(entity), displacedRoleCode);
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
                // Same reasoning as the displacement path: the flag belongs to an active row.
                e.setPrimary(false);
                userBranchRoleRepository.save(e);
            });
    }
}
