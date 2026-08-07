package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.MenuItem;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MenuItemRepository extends JpaRepository<MenuItem, UUID> {

    @Query("SELECT i FROM MenuItem i WHERE i.category.id = :categoryId AND i.active = true ORDER BY i.name ASC")
    List<MenuItem> findByCategoryIdAndActiveTrue(@Param("categoryId") UUID categoryId);

    @Query("SELECT i FROM MenuItem i WHERE i.active = true ORDER BY i.name ASC")
    Page<MenuItem> findByActiveTrue(Pageable pageable);

    @Query("SELECT i FROM MenuItem i WHERE i.active = true ORDER BY i.name ASC")
    List<MenuItem> findByActiveTrueOrderByName();

    /** Admin listing (Menu Items management page) — includes inactive items, unlike
     * {@link #findByActiveTrue} which backs the order-taking menu grid. */
    @Query("SELECT i FROM MenuItem i WHERE i.category.id = :categoryId ORDER BY i.name ASC")
    List<MenuItem> findByCategoryIdOrderByName(@Param("categoryId") UUID categoryId);

    @Query("SELECT i FROM MenuItem i ORDER BY i.name ASC")
    Page<MenuItem> findAllOrderByName(Pageable pageable);

    /**
     * Tenant-scoped single-item lookup for the order write path.
     *
     * <p>{@code addItem} previously resolved the caller-supplied {@code menuItemId} with the
     * inherited {@link JpaRepository#findById}, which carries no tenant predicate. With RLS
     * inert on pos_db (owner bypass, fixed in V11) that accepted another tenant's menu item
     * onto an order and priced the line at the foreign tenant's price — a cross-tenant write.
     * FORCE now blocks it at the database; this keeps the predicate in the query too.
     */
    @Query("SELECT i FROM MenuItem i WHERE i.id = :id AND i.tenantId = :tenantId")
    Optional<MenuItem> findByIdAndTenantId(@Param("id") UUID id, @Param("tenantId") UUID tenantId);
}
