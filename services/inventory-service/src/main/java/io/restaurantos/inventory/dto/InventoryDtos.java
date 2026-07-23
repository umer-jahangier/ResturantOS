package io.restaurantos.inventory.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Request/response records for inventory master data + opening-balance recording. */
public final class InventoryDtos {

    private InventoryDtos() {}

    /**
     * {@code categoryId} is required (D-02: exactly one deterministic primary category) —
     * enforced both by {@code @NotNull} here and, at the DB level, by the NOT NULL FK V5 already
     * added to {@code ingredients.category_id}.
     */
    public record CreateIngredientRequest(
            @NotBlank String name,
            @NotBlank String sku,
            @NotBlank String baseUomCode,
            @NotNull UUID categoryId,
            String shortName,
            String description,
            String itemType,
            UUID producedByRecipeId,
            String measureType,
            String recipeUomCode,
            BigDecimal defaultYieldPct,
            String storageLocation,
            Integer shelfLifeDays,
            Boolean perishable,
            @NotNull @PositiveOrZero BigDecimal reorderPoint,
            BigDecimal parLevel,
            List<IngredientConversionDto> conversions,
            List<String> allergenCodes) {}

    public record UpdateIngredientRequest(
            @NotBlank String name,
            @NotBlank String baseUomCode,
            @NotNull UUID categoryId,
            String shortName,
            String description,
            String itemType,
            UUID producedByRecipeId,
            String measureType,
            String recipeUomCode,
            BigDecimal defaultYieldPct,
            String storageLocation,
            Integer shelfLifeDays,
            Boolean perishable,
            @NotNull @PositiveOrZero BigDecimal reorderPoint,
            BigDecimal parLevel,
            List<IngredientConversionDto> conversions,
            List<String> allergenCodes,
            @NotNull Boolean active) {}

    public record IngredientDto(
            UUID id,
            String name,
            String sku,
            String baseUomCode,
            UUID categoryId,
            String categoryName,
            String categoryPath,
            String shortName,
            String description,
            String itemType,
            UUID producedByRecipeId,
            String measureType,
            boolean measureTypeLocked,
            String recipeUomCode,
            BigDecimal defaultYieldPct,
            String storageLocation,
            Integer shelfLifeDays,
            boolean perishable,
            BigDecimal reorderPoint,
            BigDecimal parLevel,
            List<IngredientConversionDto> conversions,
            List<String> allergenCodes,
            Instant archivedAt,
            boolean active) {}

    public record IngredientConversionDto(
            @NotBlank String fromUomCode,
            @NotBlank String toUomCode,
            @NotNull @Positive BigDecimal factor,
            String note) {}

    /**
     * Response shape for {@code GET /internal/inventory/ingredient-categories} (08.2-09) — the
     * seam purchasing-service's real category resolver (plan 08.2-11) calls, replacing the
     * static classpath map. One entry per requested {@code ingredientId}, in the same order the
     * ids were requested; an id that does not resolve gets the literal {@code "Uncategorized"}
     * as {@code categoryName} rather than being omitted, so the caller never invents a fallback.
     */
    public record IngredientCategoryLookupDto(
            UUID ingredientId,
            UUID categoryId,
            String categoryName,
            String categoryPath) {}

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
