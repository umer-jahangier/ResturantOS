package io.restaurantos.pos.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.UUID;

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
            Integer sortOrder,
            /** The tax class new items in this category inherit; null = no rule (F16). */
            UUID taxClassId
    ) {}

    /**
     * <h2>{@code taxClassId} is REPLACE-on-null, and that is the whole point</h2>
     *
     * <p>Null clears the category's tax rule. It does not mean "leave it alone". That is the same
     * contract {@link MenuItemAdminDtos.UpdateMenuItemRequest} spells out for {@code taxRateCode},
     * and it is spelled out here too because this codebase has already paid, once, for a PUT that
     * silently destroyed tax data on a field the client forgot to send: correcting a typo in an
     * item's description erased its {@code taxRateCode}.
     *
     * <p>So: <strong>PUT is a REPLACE — send every field on every update.</strong> The frontend
     * enforces it in its type system (a required-but-nullable field), not by convention, so
     * wipe-by-omission fails to compile rather than failing silently in the database.
     */
    public record UpdateMenuCategoryRequest(
            @NotBlank String name,
            String description,
            Integer sortOrder,
            UUID taxClassId
    ) {}

    private MenuCategoryAdminDtos() {}
}
