package io.restaurantos.auth.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;
import java.util.UUID;

@Entity
@Table(name = "role_permissions")
@IdClass(RolePermissionEntity.RolePermissionId.class)
@Getter
@Setter
public class RolePermissionEntity {

    @Id
    @Column(name = "role_code")
    private String roleCode;

    @Id
    @Column(name = "permission_code")
    private String permissionCode;

    /**
     * Which tenant this grant belongs to, or NULL for a platform-defined one (changeset 092).
     *
     * <p><b>Deliberately NOT part of the {@code @IdClass}</b>, even though the database's unique
     * index spans it. Nothing in this service loads or saves a {@code RolePermissionEntity} — every
     * read goes through a projection or a scalar query, and every write goes through the native
     * statements on {@link io.restaurantos.auth.repository.RolePermissionRepository}. Widening the
     * identifier would therefore buy nothing and cost a NULL id component on the several thousand
     * platform-defined rows, which Hibernate treats as a transient entity.
     *
     * <p>The corollary is a rule: <b>never call {@code save()} on this entity.</b> Its JPA identity
     * is (role_code, permission_code), so a merge would find a platform row for the same pair and
     * UPDATE it — stamping a tenant id onto a grant every tenant shares. The native inserts exist
     * precisely so that cannot happen by accident.
     */
    @Column(name = "tenant_id")
    private UUID tenantId;

    @Getter
    @Setter
    public static class RolePermissionId implements Serializable {
        private String roleCode;
        private String permissionCode;
    }
}
