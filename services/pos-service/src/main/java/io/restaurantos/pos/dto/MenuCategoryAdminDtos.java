package io.restaurantos.pos.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Request DTOs for the pos-service menu-category write path (create/update). Mirrors
 * {@link MenuItemAdminDtos}'s private-constructor-holder-class style.
 *
 * <p>Activate/deactivate stay their own endpoints (mirroring {@code setActive} for items) rather
 * than folding state into this general-purpose update — {@code active} is not a field here.
 */
public class MenuCategoryAdminDtos {

    public record CreateMenuCategoryRequest(
            @NotBlank String name,
            String description,
            Integer sortOrder
    ) {}

    public record UpdateMenuCategoryRequest(
            @NotBlank String name,
            String description,
            Integer sortOrder
    ) {}

    private MenuCategoryAdminDtos() {}
}
