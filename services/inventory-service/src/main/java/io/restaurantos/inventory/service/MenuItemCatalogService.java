package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.MenuItemCatalog;
import io.restaurantos.inventory.dto.MenuItemCatalogDtos.MenuItemCatalogDto;
import io.restaurantos.inventory.event.InventoryEventPayloads.MenuItemDeletedPayload;
import io.restaurantos.inventory.event.InventoryEventPayloads.MenuItemUpsertedPayload;
import io.restaurantos.inventory.repository.MenuItemCatalogRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Maintains the {@code menu_item_catalog} read-model (D-02) from pos-service's
 * MENU_ITEM_UPSERTED/MENU_ITEM_DELETED events, and serves the active listing for the
 * recipe-builder picker (08.1-04).
 */
@Service
public class MenuItemCatalogService {

    private final MenuItemCatalogRepository menuItemCatalogRepository;
    private final TenantContext tenantContext;

    public MenuItemCatalogService(MenuItemCatalogRepository menuItemCatalogRepository,
                                   TenantContext tenantContext) {
        this.menuItemCatalogRepository = menuItemCatalogRepository;
        this.tenantContext = tenantContext;
    }

    /** Find-or-create by (tenantId, menuItemId) and overwrite every synced field. */
    @Transactional
    public void upsert(MenuItemUpsertedPayload payload) {
        UUID tenantId = tenantContext.requireTenantId();
        MenuItemCatalog row = menuItemCatalogRepository
                .findByTenantIdAndMenuItemId(tenantId, payload.menuItemId())
                .orElseGet(MenuItemCatalog::new);
        row.setTenantId(tenantId);
        row.setMenuItemId(payload.menuItemId());
        row.setName(payload.name());
        row.setCategoryId(payload.categoryId());
        row.setCategoryName(payload.categoryName());
        row.setActive(payload.active());
        row.setBasePricePaisa(payload.basePricePaisa());
        menuItemCatalogRepository.save(row);
    }

    /**
     * D-07: soft-delete only. If the row is absent (never upserted) this is a no-op — never
     * throws, since a delete for an unknown menuItemId is not an error condition.
     */
    @Transactional
    public void softDelete(MenuItemDeletedPayload payload) {
        UUID tenantId = tenantContext.requireTenantId();
        menuItemCatalogRepository.findByTenantIdAndMenuItemId(tenantId, payload.menuItemId())
                .ifPresent(row -> {
                    row.setActive(false);
                    menuItemCatalogRepository.save(row);
                });
    }

    @Transactional(readOnly = true)
    public List<MenuItemCatalogDto> listActive() {
        UUID tenantId = tenantContext.requireTenantId();
        return menuItemCatalogRepository.findByTenantIdAndActiveTrueOrderByNameAsc(tenantId).stream()
                .map(MenuItemCatalogService::toDto)
                .toList();
    }

    private static MenuItemCatalogDto toDto(MenuItemCatalog row) {
        return new MenuItemCatalogDto(
                row.getMenuItemId(), row.getName(), row.getCategoryName(),
                row.isActive(), row.getBasePricePaisa());
    }
}
