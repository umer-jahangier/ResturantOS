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
            UUID imageFileId,
            /**
             * Tax-class OVERRIDE for this one dish (F16). Null = inherit the category's class,
             * which is what a new item should almost always do.
             */
            UUID taxClassId
    ) {}

    /**
     * <h2>Three different null meanings live in this record. Read this before writing a client.</h2>
     *
     * <p><strong>LEAVE UNCHANGED:</strong> {@code categoryId} and {@code taxRatePct}. Omitting
     * either keeps the item's current value (unlike create, where {@code categoryId} is
     * required). Both are null-guarded in {@code MenuServiceImpl.updateItem}.
     *
     * <p><strong>REMOVE:</strong> {@code taxRateCode} and {@code imageFileId}. Null clears the
     * field — it does not mean "leave it alone" — and because Jackson maps an ABSENT key and an
     * explicit null to the same thing in a record, omitting either of these erases it too.
     *
     * <p>That asymmetry cost a real bug (register S0 #4): the Menu Items edit dialog sent
     * {@code {categoryId,name,description,basePricePaisa,imageFileId}}, so correcting a typo in
     * an item's description silently destroyed its fiscal classification —
     * {@code taxRateCode 'SR-STD-17' -> null} — while {@code taxRatePct} survived at 17.00
     * purely because it happens to sit in the other group. Nothing on screen said so.
     *
     * <p>The rule for every client, therefore: <strong>PUT is a REPLACE — send every field on
     * every update, including the ones you are not changing.</strong> The frontend enforces this
     * in its type system rather than by convention: {@code updateMenuItemInputSchema} makes
     * {@code taxRatePct}, {@code taxRateCode} and {@code imageFileId} REQUIRED (nullable, so a
     * deliberate removal is still expressible), which is what makes wipe-by-omission fail to
     * compile instead of failing silently in the database. {@code MenuUpdateReplacesFieldsIT}
     * pins both halves — round-trip preserves, explicit null removes.
     */
    public record UpdateMenuItemRequest(
            UUID categoryId,
            @NotBlank String name,
            String description,
            @NotNull @PositiveOrZero Long basePricePaisa,
            BigDecimal taxRatePct,
            String taxRateCode,
            UUID imageFileId,
            /**
             * Tax-class OVERRIDE (F16). REMOVE-on-null, like the two fields above it: null puts
             * the item back on its category's rule. It does NOT mean zero-rated, and the item
             * dialog says so in those words rather than leaving a blank select to be guessed at.
             */
            UUID taxClassId
    ) {}

    private MenuItemAdminDtos() {}
}
