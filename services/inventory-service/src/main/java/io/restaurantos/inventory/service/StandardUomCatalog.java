package io.restaurantos.inventory.service;

import java.math.BigDecimal;
import java.util.List;

/**
 * The standard unit-of-measure set every tenant is provisioned with (see
 * {@link UomProvisioningService}).
 *
 * <p>{@code units_of_measure} is tenant-scoped under FORCE RLS, so no Flyway migration can seed it
 * — there is no tenant to attribute rows to at migration time, and none of V1-V7 ever inserted a
 * row. The practical effect was that a brand-new tenant reached the ingredient form with an empty,
 * required "Stock unit" select and no way to populate it: the UI only ever calls
 * {@code GET /api/v1/inventory/uom}, never the {@code POST} that would create one. This class is
 * the data half of the fix; {@link UomProvisioningService} is the mechanism.
 *
 * <p><strong>Codes are uppercase</strong> to match the convention already in the codebase and its
 * fixtures ({@code KG}, {@code G}, {@code EACH}). Tenants provisioned before V7 may hold other
 * casings — {@code UomProvisioningService} matches case-insensitively and never inserts a second
 * row for a code the tenant already has in any casing.
 *
 * <p>{@code toBaseFactor} converts INTO the family's base unit, matching
 * {@link UomConverter#effectiveBaseQty} ({@code qty * toBaseFactor}): 2 {@code KG} is 2000
 * {@code G}. Every factor is expressed to at most 8 decimal places, the scale of the
 * {@code NUMERIC(18,8)} column, so nothing is silently rounded on insert.
 */
final class StandardUomCatalog {

    private StandardUomCatalog() {}

    static final String WEIGHT = "WEIGHT";
    static final String VOLUME = "VOLUME";
    static final String COUNT = "COUNT";

    /**
     * One standard unit. {@code baseUnitCode} is null exactly for the three family base units,
     * mirroring how {@code units_of_measure.base_unit_code} is already used — and which
     * {@code RecipeCostPreviewService.dimensionMatches} depends on to decide whether a recipe
     * line's unit can be converted into an ingredient's stock unit at all.
     */
    record StandardUom(String code, String name, String measureType, String baseUnitCode, BigDecimal toBaseFactor) {}

    private static StandardUom base(String code, String name, String measureType) {
        return new StandardUom(code, name, measureType, null, BigDecimal.ONE);
    }

    private static StandardUom derived(String code, String name, String measureType,
                                        String baseUnitCode, String toBaseFactor) {
        return new StandardUom(code, name, measureType, baseUnitCode, new BigDecimal(toBaseFactor));
    }

    /**
     * Ordered base-unit-first per family, so a single pass can insert a derived unit knowing its
     * base is either already present or earlier in this same list.
     */
    static final List<StandardUom> ALL = List.of(
            // ── WEIGHT (base: gram) ──
            base("G", "Gram", WEIGHT),
            derived("KG", "Kilogram", WEIGHT, "G", "1000"),
            derived("MG", "Milligram", WEIGHT, "G", "0.001"),
            derived("LB", "Pound", WEIGHT, "G", "453.59237"),
            derived("OZ", "Ounce", WEIGHT, "G", "28.34952313"),

            // ── VOLUME (base: millilitre) ──
            base("ML", "Millilitre", VOLUME),
            derived("L", "Litre", VOLUME, "ML", "1000"),
            derived("FLOZ", "Fluid ounce", VOLUME, "ML", "29.57352956"),
            derived("CUP", "Cup", VOLUME, "ML", "240"),
            derived("TBSP", "Tablespoon", VOLUME, "ML", "15"),
            derived("TSP", "Teaspoon", VOLUME, "ML", "5"),

            // ── COUNT (base: each) ──
            base("EACH", "Each", COUNT),
            derived("DOZEN", "Dozen", COUNT, "EACH", "12"),
            derived("PAIR", "Pair", COUNT, "EACH", "2"));
}
