package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.repository.RolePermissionRepository;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class PermissionResolver {

    private static final Logger log = LoggerFactory.getLogger(PermissionResolver.class);

    private final UserBranchRoleRepository userBranchRoleRepository;
    private final RolePermissionRepository rolePermissionRepository;

    public PermissionResolver(UserBranchRoleRepository userBranchRoleRepository,
                              RolePermissionRepository rolePermissionRepository) {
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.rolePermissionRepository = rolePermissionRepository;
    }

    public ResolvedBranchAuth resolve(UUID userId, UUID branchId) {
        UserBranchRoleEntity assignment = branchId != null
            ? resolveAtBranch(userId, branchId)
            : selectDefaultBranch(userId);
        return buildForAssignment(assignment);
    }

    public ResolvedBranchAuth resolveDefault(UUID userId) {
        return buildForAssignment(selectDefaultBranch(userId));
    }

    /**
     * The user's active role at one branch.
     *
     * <p>A partial unique index makes a second active row impossible, so the surplus branch below
     * should be unreachable. It is written anyway, and deliberately: this is the login path. A row
     * that predates the index, arrives through a repair script, or survives a future migration that
     * drops it used to produce {@code IncorrectResultSizeDataAccessException} — a 500 on a
     * credential endpoint, for every attempt, until someone found and deleted the row. Degrading to
     * a deterministic pick with a warning turns that outage into a log line.
     */
    private UserBranchRoleEntity resolveAtBranch(UUID userId, UUID branchId) {
        List<UserBranchRoleEntity> assignments =
            userBranchRoleRepository.findByUserIdAndBranchIdAndActiveTrue(userId, branchId);
        if (assignments.isEmpty()) {
            throw new IllegalStateException(
                "User " + userId + " has no active assignment at branch " + branchId);
        }
        if (assignments.size() > 1) {
            log.warn("User {} has {} active roles at branch {} ({}) — the one-active-role-per-branch "
                    + "index should make this impossible. Resolving the lowest assignment id; the "
                    + "surplus rows need deactivating.",
                userId, assignments.size(), branchId,
                assignments.stream().map(UserBranchRoleEntity::getRoleCode).sorted().toList());
        }
        return assignments.stream()
            .min(Comparator.comparing(UserBranchRoleEntity::getId))
            .orElseThrow();
    }

    /**
     * The branch a user lands on when they log in without asking for one.
     *
     * <p>This used to prefer a hardcoded {@code HQ_BRANCH_ID} constant — one dev tenant's branch
     * UUID, right on one database and silently arbitrary on every other, and matching nothing at
     * all on a freshly provisioned tenant because the provisioning saga never marks the first
     * branch as HQ. It is now the row the data itself marks primary, with the lowest branch id as
     * the fallback for a user whose rows predate the backfill.
     */
    private UserBranchRoleEntity selectDefaultBranch(UUID userId) {
        List<UserBranchRoleEntity> assignments = userBranchRoleRepository.findByUserIdAndActiveTrue(userId);
        if (assignments.isEmpty()) {
            // Naming the user matters: this message is what an operator sees when someone cannot
            // log in, and without the id there is no way to tell who is locked out or why.
            throw new IllegalStateException("User " + userId + " has no active branch assignments");
        }
        return assignments.stream()
            .filter(UserBranchRoleEntity::isPrimary)
            .min(Comparator.comparing(UserBranchRoleEntity::getId))
            .orElseGet(() -> assignments.stream()
                .min(Comparator.comparing(UserBranchRoleEntity::getBranchId))
                .orElseThrow());
    }

    private ResolvedBranchAuth buildForAssignment(UserBranchRoleEntity assignment) {
        List<String> roles = List.of(assignment.getRoleCode());
        List<String> permissions = rolePermissionRepository.findPermissionCodesByRoleCodes(roles).stream()
            .distinct()
            .sorted()
            .toList();
        Map<String, Object> attributes = new HashMap<>();
        if (assignment.getApprovalLimitPaisa() != null) {
            attributes.put("approval_limit_paisa", assignment.getApprovalLimitPaisa());
        }
        return new ResolvedBranchAuth(assignment.getBranchId(), roles, permissions, attributes);
    }
}
