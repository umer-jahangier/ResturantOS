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
     *
     * <p>{@code storageLocationId} REPLACED a free-text {@code storageLocation} field here in V10.
     * The text column still exists and is still returned on {@link IngredientDto}, but it is now
     * derived from the referenced location's name — so accepting it on the way in would be a field
     * a caller could set and watch be ignored.
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
            UUID storageLocationId,
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
            UUID storageLocationId,
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
            UUID storageLocationId,
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

    /**
     * {@code measureType} (WEIGHT/VOLUME/COUNT) is optional for backwards compatibility and
     * defaults to {@code COUNT}, matching the column default V7 gives {@code units_of_measure}.
     */
    public record CreateUomRequest(
            @NotBlank String code,
            @NotBlank String name,
            String measureType,
            String baseUnitCode,
            @NotNull @Positive BigDecimal toBaseFactor) {}

    /**
     * {@code measureType} is what lets the ingredient form show only units in the selected
     * dimension — before V7 it did not exist, so both unit selects listed every unit in the tenant
     * regardless of whether it could legally be paired with the item.
     */
    public record UomDto(
            UUID id,
            String code,
            String name,
            String measureType,
            String baseUnitCode,
            BigDecimal toBaseFactor,
            /** Non-null means retired: absent from the pickers, still resolvable by conversion. */
            Instant archivedAt) {}

    /**
     * A unit's changeable fields. {@code code} is deliberately ABSENT.
     *
     * <p>A unit code is a foreign key by value into {@code ingredients.base_uom_code}, into
     * {@code ingredient_uom_conversions} on both sides, and into another service's
     * {@code vendor_items.pack_uom}. There is no way to follow those references backwards, so a
     * rename would silently orphan every one of them. Correcting a typo in a CODE is therefore a
     * retire-and-recreate, and the form says so.
     */
    public record UpdateUomRequest(
            @NotBlank String name,
            String measureType,
            String baseUnitCode,
            @NotNull @Positive BigDecimal toBaseFactor) {}

    /**
     * Why a unit could not be retired: the count of records that still name it, per kind.
     *
     * <p>A bare "cannot retire" turns a correct refusal into an apparently broken button. Naming
     * the references is what lets a person go and change them.
     */
    public record UomReferenceBreakdown(
            long ingredientsStockedInIt,
            long ingredientsWithItAsRecipeUnit,
            long conversionRows,
            long vendorCatalogRows,
            /** True when the cross-database vendor count could not be read at all. */
            boolean vendorCountUnavailable) {

        public long total() {
            return ingredientsStockedInIt + ingredientsWithItAsRecipeUnit + conversionRows + vendorCatalogRows;
        }
    }

    /**
     * Records the opening on-hand quantity + unit cost for an ingredient at a branch (INV-07).
     * {@code tenantId} is intentionally absent — resolved from TenantContext/JWT only, never the
     * request body (must_haves.prohibitions #2).
     */
    public record RecordOpeningBalanceRequest(
            @NotNull UUID ingredientId,
            @NotNull UUID branchId,
            @NotNull @Positive BigDecimal qty,
            /** Cost of one stock unit, in paisa — a rate, so fractional is legitimate (V12). */
            @NotNull @PositiveOrZero BigDecimal unitCostPaisa,
            LocalDate expiryDate) {

        /** Whole-paisa convenience for callers and tests that only have an integer cost. */
        public RecordOpeningBalanceRequest(UUID ingredientId, UUID branchId, BigDecimal qty,
                                            long unitCostPaisa, LocalDate expiryDate) {
            this(ingredientId, branchId, qty, BigDecimal.valueOf(unitCostPaisa), expiryDate);
        }
    }
}
