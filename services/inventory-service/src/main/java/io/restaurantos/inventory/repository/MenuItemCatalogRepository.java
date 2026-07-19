package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.MenuItemCatalog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MenuItemCatalogRepository extends JpaRepository<MenuItemCatalog, UUID> {

    Optional<MenuItemCatalog> findByTenantIdAndMenuItemId(UUID tenantId, UUID menuItemId);

    boolean existsByTenantIdAndMenuItemIdAndActiveTrue(UUID tenantId, UUID menuItemId);

    List<MenuItemCatalog> findByTenantIdAndActiveTrueOrderByNameAsc(UUID tenantId);
}
