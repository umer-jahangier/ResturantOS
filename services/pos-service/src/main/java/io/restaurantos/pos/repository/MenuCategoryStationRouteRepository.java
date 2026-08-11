package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.MenuCategoryStationRoute;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Category-level routes. Same explicit-tenant-predicate discipline as the item-level one. */
@Repository
public interface MenuCategoryStationRouteRepository extends JpaRepository<MenuCategoryStationRoute, UUID> {

    Optional<MenuCategoryStationRoute> findByTenantIdAndBranchIdAndCategoryId(
            UUID tenantId, UUID branchId, UUID categoryId);

    List<MenuCategoryStationRoute> findByTenantIdAndBranchId(UUID tenantId, UUID branchId);

    void deleteByTenantIdAndBranchIdAndCategoryId(UUID tenantId, UUID branchId, UUID categoryId);
}
