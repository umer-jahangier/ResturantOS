package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.RolePermissionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

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

    // ─────────────────────────── tenant-scoped variants (S3, changeset 092) ───────────────────
    //
    // `role_permissions` gained a nullable tenant_id and the same FORCE RLS policy `roles` carries,
    // so a tenant can compose a role of its own without its grants merging with another tenant's
    // role of the same code. The two finders above still exist and still work — every seeded grant
    // is tenant_id NULL — but they lean on the RLS policy alone for isolation, and the policy is
    // INERT under the SUPERUSER every Testcontainers integration test connects as. A query that can
    // only be proven correct in production is not proven. These carry the predicate themselves.
    //
    // Note the shape of the predicate: `tenant_id IS NULL OR tenant_id = :tenantId`. A NULL
    // tenantId argument therefore still returns every platform-defined grant rather than nothing,
    // which is what keeps the login path — the highest-risk caller of this repository — resolving
    // the eight system roles exactly as it did before this column existed.

    /**
     * The union of a role's platform-defined grants and this tenant's own, for a JWT's permission
     * list.
     */
    @Query("""
        SELECT rp.permissionCode FROM RolePermissionEntity rp
         WHERE rp.roleCode IN :roleCodes
           AND (rp.tenantId IS NULL OR rp.tenantId = :tenantId)
        """)
    List<String> findPermissionCodesByRoleCodesForTenant(@Param("roleCodes") List<String> roleCodes,
                                                         @Param("tenantId") UUID tenantId);

    /** As {@link #findRolePermissionPairs(Collection)}, restricted to one tenant's visible grants. */
    @Query("""
        SELECT rp.roleCode AS roleCode, rp.permissionCode AS permissionCode
          FROM RolePermissionEntity rp
         WHERE rp.roleCode IN :roleCodes
           AND (rp.tenantId IS NULL OR rp.tenantId = :tenantId)
         ORDER BY rp.roleCode ASC, rp.permissionCode ASC
        """)
    List<RolePermissionPair> findRolePermissionPairsForTenant(
        @Param("roleCodes") Collection<String> roleCodes, @Param("tenantId") UUID tenantId);

    /**
     * Grant one permission to one of THIS tenant's roles.
     *
     * <p>Native, and not {@code save()}, for the reason {@code RolePermissionEntity.tenantId}
     * records: the entity's JPA identity does not include the tenant, so a merge could find and
     * overwrite a platform-defined row. {@code tenant_id} is bound explicitly and can never be
     * null here, so this statement is incapable of writing a global grant.
     */
    @Modifying
    @Query(value = """
        INSERT INTO role_permissions (tenant_id, role_code, permission_code)
        VALUES (:tenantId, :roleCode, :permissionCode)
        """, nativeQuery = true)
    void insertTenantGrant(@Param("tenantId") UUID tenantId,
                           @Param("roleCode") String roleCode,
                           @Param("permissionCode") String permissionCode);

    /**
     * Clear one of THIS tenant's roles back to granting nothing — the first half of the replace
     * semantics {@code PUT} needs.
     *
     * <p>The {@code tenant_id = :tenantId} predicate is the whole safety property: without it the
     * same statement would delete the platform-defined grants of a system role sharing the code,
     * i.e. revoke a permission from every tenant on the installation. It is written as an equality
     * against a non-null bind rather than as anything RLS-derived so that it is also correct when
     * executed by the SUPERUSER an integration test connects as.
     */
    @Modifying
    @Query(value = """
        DELETE FROM role_permissions WHERE tenant_id = :tenantId AND role_code = :roleCode
        """, nativeQuery = true)
    int deleteTenantGrants(@Param("tenantId") UUID tenantId, @Param("roleCode") String roleCode);
}
