package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.RoleEntity;
import org.springframework.data.jpa.repository.JpaRepository;
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
}
