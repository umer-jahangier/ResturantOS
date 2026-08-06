package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.RoleEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface RoleRepository extends JpaRepository<RoleEntity, UUID> {

    /**
     * Roles carrying this code that are visible to the current tenant context.
     *
     * <p>Returns a List, not an Optional, and that is deliberate. The unique constraint is on
     * {@code (tenant_id, code)}, so a code can legitimately exist twice — once as a system role with
     * a null tenant and once as a tenant's own override — and both are visible under the RLS policy
     * at the same time. An {@code Optional} finder would then throw
     * {@code IncorrectResultSizeDataAccessException} instead of validating, which is exactly the
     * failure 13-02 had to remove from the login path for the same reason.
     */
    List<RoleEntity> findByCode(String code);

    /**
     * Every role the given tenant may see: the system roles, plus that tenant's own.
     *
     * <p><b>The {@code tenant_id} predicate here is not belt-and-braces, and must not be removed as
     * redundant.</b> {@code roles} carries the RLS policy
     * {@code tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid},
     * which says the same thing — but a policy only enforces against a role that is not
     * {@code BYPASSRLS}, and every integration test in this repository runs as Testcontainers'
     * SUPERUSER, for which it is inert. A catalog that leant on the policy alone would be untested
     * by construction, and cross-tenant leakage would be invisible until production. Two
     * independent controls, one of which is assertable in CI.
     *
     * <p>A null {@code tenantId} yields the system roles only — fails closed rather than open.
     */
    @Query("""
        SELECT r FROM RoleEntity r
         WHERE r.tenantId IS NULL OR r.tenantId = :tenantId
         ORDER BY r.code ASC
        """)
    List<RoleEntity> findVisibleToTenant(@Param("tenantId") UUID tenantId);
}
