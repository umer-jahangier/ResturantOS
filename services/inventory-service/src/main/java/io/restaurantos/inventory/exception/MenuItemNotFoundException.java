package io.restaurantos.inventory.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

import java.util.UUID;

/**
 * Thrown by {@code RecipeService.createVersion} when the request's {@code menuItemId} does not
 * exist, or exists but is inactive, in the caller's tenant-scoped {@code menu_item_catalog}
 * (INV-09 — closes 08-CONTEXT.md's confirmed "no validation/sync/FK" gap).
 */
public class MenuItemNotFoundException extends RestaurantOsException {
    public MenuItemNotFoundException(UUID menuItemId) {
        super("MENU_ITEM_NOT_FOUND", "Menu item not found or inactive in catalog: " + menuItemId);
    }
}
