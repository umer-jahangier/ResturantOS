package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.RolePermissionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;

@Repository
public interface RolePermissionRepository extends JpaRepository<RolePermissionEntity, RolePermissionEntity.RolePermissionId> {

    @Query("SELECT rp.permissionCode FROM RolePermissionEntity rp WHERE rp.roleCode IN :roleCodes")
    List<String> findPermissionCodesByRoleCodes(@Param("roleCodes") List<String> roleCodes);

    /**
     * Every {@code (role_code, permission_code)} pair for the given roles, in ONE query.
     *
     * <p>The existing finder above flattens the role dimension away, which is exactly right for
     * computing a JWT's permission union and useless for building a catalog: the catalog has to say
     * which codes belong to which role. Fetching that per role would make {@code GET /api/v1/roles}
     * an N-plus-one over the role list — on a page every administrator loads, whose row count grows
     * with a tenant's custom roles (threat T-13-07-D). One query, grouped in memory.
     *
     * <p>Ordered so the response is stable between calls without the caller having to sort, and so
     * two runs of the catalog are diffable.
     */
    @Query("""
        SELECT rp.roleCode AS roleCode, rp.permissionCode AS permissionCode
          FROM RolePermissionEntity rp
         WHERE rp.roleCode IN :roleCodes
         ORDER BY rp.roleCode ASC, rp.permissionCode ASC
        """)
    List<RolePermissionPair> findRolePermissionPairs(@Param("roleCodes") Collection<String> roleCodes);

    /** Projection for {@link #findRolePermissionPairs(Collection)}. */
    interface RolePermissionPair {
        String getRoleCode();

        String getPermissionCode();
    }
}
