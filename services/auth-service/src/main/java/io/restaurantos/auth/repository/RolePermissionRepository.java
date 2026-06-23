package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.RolePermissionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface RolePermissionRepository extends JpaRepository<RolePermissionEntity, RolePermissionEntity.RolePermissionId> {

    @Query("SELECT rp.permissionCode FROM RolePermissionEntity rp WHERE rp.roleCode IN :roleCodes")
    List<String> findPermissionCodesByRoleCodes(@Param("roleCodes") List<String> roleCodes);
}
