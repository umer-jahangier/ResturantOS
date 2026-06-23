package io.restaurantos.auth.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

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

    @Getter
    @Setter
    public static class RolePermissionId implements Serializable {
        private String roleCode;
        private String permissionCode;
    }
}
