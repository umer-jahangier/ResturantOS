package io.restaurantos.pos.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.util.UUID;

/** Wire contracts for the tenant's sales-tax catalogue (F16). */
public class TaxClassDtos {

    /**
     * @param categoryCount how many menu categories inherit this class — the number that turns
     *                      "delete" from a button into an informed decision, and the number the
     *                      settings screen prints under each row
     * @param itemCount     how many items override to it
     */
    public record TaxClassDto(
            UUID id,
            String code,
            String name,
            BigDecimal ratePct,
            boolean active,
            long categoryCount,
            long itemCount
    ) {}

    /**
     * {@code ratePct} is REQUIRED, including when it is zero.
     *
     * <p>A zero-rated class is a real and common thing (exempt food, exports) and it is not the
     * same as a class whose rate nobody filled in. Making the field optional would let the second
     * masquerade as the first, which is the exact confusion — absent vs zero — that produced the
     * defect this feature closes.
     */
    public record CreateTaxClassRequest(
            @NotBlank @Size(max = 40) String code,
            @NotBlank @Size(max = 120) String name,
            @NotNull @DecimalMin("0.00") @DecimalMax("100.00") BigDecimal ratePct
    ) {}

    /**
     * PUT is a REPLACE — every field on every update, including the ones you are not changing.
     * The same rule {@code UpdateMenuItemRequest} states, for the same reason: this codebase has
     * already paid for one wipe-by-omission on tax data.
     */
    public record UpdateTaxClassRequest(
            @NotBlank @Size(max = 40) String code,
            @NotBlank @Size(max = 120) String name,
            @NotNull @DecimalMin("0.00") @DecimalMax("100.00") BigDecimal ratePct,
            @NotNull Boolean active
    ) {}

    /**
     * Assign a class to a category or to an item; {@code null} clears.
     *
     * <p>On a CATEGORY, null means "this category has no rule" and its items fall through to their
     * own columns. On an ITEM, null means "follow the category again" — it does NOT mean
     * zero-rated, and the screen says so in those words.
     */
    public record AssignTaxClassRequest(UUID taxClassId) {}

    private TaxClassDtos() {}
}
