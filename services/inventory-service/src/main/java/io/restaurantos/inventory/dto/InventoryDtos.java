package io.restaurantos.inventory.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/** Request/response records for inventory master data + opening-balance recording. */
public final class InventoryDtos {

    private InventoryDtos() {}

    public record CreateIngredientRequest(
            @NotBlank String name,
            @NotBlank String sku,
            @NotBlank String baseUomCode,
            String category,
            @NotNull @PositiveOrZero BigDecimal reorderPoint) {}

    public record UpdateIngredientRequest(
            @NotBlank String name,
            @NotBlank String baseUomCode,
            String category,
            @NotNull @PositiveOrZero BigDecimal reorderPoint) {}

    public record IngredientDto(
            UUID id,
            String name,
            String sku,
            String baseUomCode,
            String category,
            BigDecimal reorderPoint,
            boolean active) {}

    public record CreateUomRequest(
            @NotBlank String code,
            @NotBlank String name,
            String baseUnitCode,
            @NotNull @Positive BigDecimal toBaseFactor) {}

    public record UomDto(
            UUID id,
            String code,
            String name,
            String baseUnitCode,
            BigDecimal toBaseFactor) {}

    /**
     * Records the opening on-hand quantity + unit cost for an ingredient at a branch (INV-07).
     * {@code tenantId} is intentionally absent — resolved from TenantContext/JWT only, never the
     * request body (must_haves.prohibitions #2).
     */
    public record RecordOpeningBalanceRequest(
            @NotNull UUID ingredientId,
            @NotNull UUID branchId,
            @NotNull @Positive BigDecimal qty,
            @NotNull @PositiveOrZero Long unitCostPaisa,
            LocalDate expiryDate) {}
}
