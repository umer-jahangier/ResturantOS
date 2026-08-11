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

    /**
     * {@code imageFileId} is a file-service file id obtained by uploading to
     * {@code POST /api/v1/files?purpose=MENU_ITEM_IMAGE} first. It is validated against
     * file-service before it is persisted — see {@code MenuItemImageService}.
     */
    public record CreateMenuItemRequest(
            @NotNull UUID categoryId,
            @NotBlank String name,
            String description,
            @NotNull @PositiveOrZero Long basePricePaisa,
            BigDecimal taxRatePct,
            String taxRateCode,
            UUID imageFileId
    ) {}

    /**
     * {@code categoryId} is optional here — omitting it leaves the item's current category
     * unchanged (unlike create, where it is required).
     *
     * <p><strong>{@code imageFileId} does NOT follow that rule: null means REMOVE the picture,
     * not "leave it alone".</strong> A field where absent and null mean different things cannot
     * be expressed in a record (Jackson maps both to null), and of the two possible readings
     * this is the one that makes "remove the image" expressible at all. It is safe because the
     * repository layer already sends every field explicitly on update — see
     * {@code PosRepository.updateMenuItem}, which documents that same convention for
     * {@code categoryId} — so a price-only edit round-trips the existing id rather than omitting
     * it. Any other client must do likewise.
     */
    public record UpdateMenuItemRequest(
            UUID categoryId,
            @NotBlank String name,
            String description,
            @NotNull @PositiveOrZero Long basePricePaisa,
            BigDecimal taxRatePct,
            String taxRateCode,
            UUID imageFileId
    ) {}

    private MenuItemAdminDtos() {}
}
