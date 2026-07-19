package io.restaurantos.pos.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Request DTOs for the pos-service menu-item write path (create/update). Validated records —
 * mirrors {@link PosEventPayloads}' private-constructor-holder-class style.
 */
public class MenuItemAdminDtos {

    public record CreateMenuItemRequest(
            @NotNull UUID categoryId,
            @NotBlank String name,
            String description,
            @NotNull @PositiveOrZero Long basePricePaisa,
            BigDecimal taxRatePct,
            String taxRateCode
    ) {}

    /**
     * {@code categoryId} is optional here — omitting it leaves the item's current category
     * unchanged (unlike create, where it is required).
     */
    public record UpdateMenuItemRequest(
            UUID categoryId,
            @NotBlank String name,
            String description,
            @NotNull @PositiveOrZero Long basePricePaisa,
            BigDecimal taxRatePct,
            String taxRateCode
    ) {}

    private MenuItemAdminDtos() {}
}
