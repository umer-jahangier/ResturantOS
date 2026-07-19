package io.restaurantos.inventory.dto;

import java.util.UUID;

/** Response records for the tenant-scoped menu-item catalog read-model (D-02, 08.1-02). */
public final class MenuItemCatalogDtos {

    private MenuItemCatalogDtos() {}

    public record MenuItemCatalogDto(
            UUID menuItemId,
            String name,
            String categoryName,
            boolean active,
            long basePricePaisa) {}
}
