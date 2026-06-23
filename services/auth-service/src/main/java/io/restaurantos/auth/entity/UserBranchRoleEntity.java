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
}
