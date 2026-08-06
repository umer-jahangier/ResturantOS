package io.restaurantos.auth.entity;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "user_branch_roles")
@Getter
@Setter
public class UserBranchRoleEntity extends TenantAuditableEntity {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "role_code", nullable = false)
    private String roleCode;

    @Column(name = "approval_limit_paisa")
    private Long approvalLimitPaisa;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    /**
     * The branch this user lands on at login when no branch is requested.
     *
     * <p>Replaces {@code PermissionResolver.HQ_BRANCH_ID}, a hardcoded dev-branch UUID that decided
     * the default branch for every user in every tenant. Constrained by a partial unique index to
     * at most one active primary per user, so "prefer the primary" is a single deterministic row
     * rather than whichever primary a query happened to return first.
     */
    @Column(name = "is_primary", nullable = false)
    private boolean primary = false;
}
