package io.restaurantos.auth.dto.response;

import io.restaurantos.auth.entity.UserBranchRoleEntity;

import java.util.UUID;

/**
 * The result of assigning a branch-role, including what the assignment displaced.
 *
 * <p>A user holds at most one active role per branch, so assigning a second role at a branch the
 * user already has one at is a <em>revocation</em> of the old role as much as a grant of the new
 * one. {@code displacedRoleCode} is how the caller finds that out; null means nothing was replaced.
 * Without it an administrator can remove a role by accident and get a 200 that looks identical to
 * the one they would have got for a first assignment.
 *
 * <p>This endpoint used to serialise {@link UserBranchRoleEntity} directly. The fields below are
 * that entity's meaningful ones under the same JSON names, plus the new one, so a caller reading
 * {@code roleCode} or {@code branchId} is unaffected; only the auditable timestamps, which nothing
 * read here, are gone.
 */
public record BranchRoleAssignWriteResponse(
    UUID id,
    UUID tenantId,
    UUID userId,
    UUID branchId,
    String roleCode,
    Long approvalLimitPaisa,
    boolean active,
    boolean primary,
    String displacedRoleCode
) {
    public static BranchRoleAssignWriteResponse of(UserBranchRoleEntity e, String displacedRoleCode) {
        return new BranchRoleAssignWriteResponse(
            e.getId(), e.getTenantId(), e.getUserId(), e.getBranchId(), e.getRoleCode(),
            e.getApprovalLimitPaisa(), e.isActive(), e.isPrimary(), displacedRoleCode);
    }
}
