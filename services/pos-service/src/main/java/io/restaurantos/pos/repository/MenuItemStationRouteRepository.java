package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.MenuItemStationRoute;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Item-level routes. Every finder carries an explicit tenant predicate on top of the forced policy.
 *
 * <p>Under FORCE, an unscoped query returns ZERO ROWS rather than erroring — and here a zero-row
 * result means "this item has no route", which the resolver handles by falling through to the
 * default station. That is the quietest possible failure: a wiring break would present as tickets
 * silently arriving at DEFAULT, with no error anywhere and nothing to distinguish it from a tenant
 * who simply has not configured routing.
 */
@Repository
public interface MenuItemStationRouteRepository extends JpaRepository<MenuItemStationRoute, UUID> {

    Optional<MenuItemStationRoute> findByTenantIdAndBranchIdAndMenuItemId(
            UUID tenantId, UUID branchId, UUID menuItemId);

    List<MenuItemStationRoute> findByTenantIdAndBranchId(UUID tenantId, UUID branchId);

    void deleteByTenantIdAndBranchIdAndMenuItemId(UUID tenantId, UUID branchId, UUID menuItemId);
}
