package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.MenuCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MenuCategoryRepository extends JpaRepository<MenuCategory, UUID> {

    @Query("SELECT c FROM MenuCategory c WHERE c.active = true ORDER BY c.sortOrder ASC")
    List<MenuCategory> findAllActiveOrderBySortOrder();

    /** Admin listing (Menu Items management page) — includes inactive categories, unlike
     * {@link #findAllActiveOrderBySortOrder} which backs the order-taking menu grid. */
    @Query("SELECT c FROM MenuCategory c ORDER BY c.sortOrder ASC")
    List<MenuCategory> findAllOrderBySortOrder();

    /**
     * One category, resolved INSIDE a named tenant (28-04).
     *
     * <p>The explicit tenant predicate is not redundant with the RLS policy. Under FORCE, an
     * unscoped query returns zero rows rather than erroring — and this finder's caller uses the
     * empty result to REFUSE a configuration, so a plumbing break would present as "that category
     * does not exist" rather than as a wiring fault. It is also the only part of the isolation CI
     * can assert, because Testcontainers runs as a superuser.
     */
    Optional<MenuCategory> findByIdAndTenantId(UUID id, UUID tenantId);
}
