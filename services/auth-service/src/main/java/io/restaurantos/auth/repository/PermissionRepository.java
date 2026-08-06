package io.restaurantos.auth.repository;

import io.restaurantos.auth.entity.PermissionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * The permission catalog — the platform's authorization vocabulary.
 *
 * <p>{@code permissions} is a GLOBAL, non-RLS table: it has no {@code tenant_id} column, carries no
 * row-security policy (changeset 030 grants {@code SELECT} and stops there), and every tenant sees
 * the identical set. That is deliberate — a permission code is vocabulary, not authority; nothing
 * in this system accepts a permission code from a caller, so publishing the list to an authorised
 * administrator grants nobody anything. Roles are the opposite (see
 * {@link RoleRepository#findVisibleToTenant}), which is why only that query filters.
 */
@Repository
public interface PermissionRepository extends JpaRepository<PermissionEntity, String> {

    /**
     * Every permission, module-major and code-minor.
     *
     * <p>Sorted in the database rather than in the service so the grouping downstream is a single
     * pass over an already-ordered list, and so two calls are byte-identical and therefore diffable.
     */
    List<PermissionEntity> findAllByOrderByModuleAscCodeAsc();
}
