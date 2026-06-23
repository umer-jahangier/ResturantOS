package io.restaurantos.auth.service;

import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.repository.RolePermissionRepository;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class PermissionResolver {

    /** HQ/Main branch UUID — preferred default at login when user is assigned here. */
    static final UUID HQ_BRANCH_ID = UUID.fromString("b0000001-0000-4000-8000-000000000001");

    private final UserBranchRoleRepository userBranchRoleRepository;
    private final RolePermissionRepository rolePermissionRepository;

    public PermissionResolver(UserBranchRoleRepository userBranchRoleRepository,
                              RolePermissionRepository rolePermissionRepository) {
        this.userBranchRoleRepository = userBranchRoleRepository;
        this.rolePermissionRepository = rolePermissionRepository;
    }

    public ResolvedBranchAuth resolve(UUID userId, UUID branchId) {
        UserBranchRoleEntity assignment = branchId != null
            ? userBranchRoleRepository.findByUserIdAndBranchIdAndActiveTrue(userId, branchId).orElseThrow()
            : selectDefaultBranch(userId);
        return buildForAssignment(assignment);
    }

    public ResolvedBranchAuth resolveDefault(UUID userId) {
        return buildForAssignment(selectDefaultBranch(userId));
    }

    private UserBranchRoleEntity selectDefaultBranch(UUID userId) {
        List<UserBranchRoleEntity> assignments = userBranchRoleRepository.findByUserIdAndActiveTrue(userId);
        if (assignments.isEmpty()) {
            throw new IllegalStateException("User has no active branch assignments");
        }
        return assignments.stream()
            .filter(a -> HQ_BRANCH_ID.equals(a.getBranchId()))
            .findFirst()
            .orElse(assignments.stream()
                .min((a, b) -> a.getBranchId().compareTo(b.getBranchId()))
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
