package io.restaurantos.inventory.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * Thrown by {@code IngredientService} when a create/update request references a unit of measure
 * that does not exist for the tenant, or pairs units that cannot go together. Maps to HTTP 422 via
 * {@code InventoryExceptionHandler} — same reasoning as {@link IngredientCategoryInvalidException}:
 * the payload is well-formed, it just describes a state the domain cannot accept.
 *
 * <p>Before this existed, {@code createIngredient} assigned {@code baseUomCode} straight through
 * with no lookup at all, while the {@code categoryId} sitting beside it in the same request was
 * fully validated. An unknown or dimensionally wrong unit code therefore saved silently and only
 * surfaced much later as an un-costed recipe line or a depletion that never resolved.
 */
public class UomInvalidException extends RestaurantOsException {

    private UomInvalidException(String code, String message) {
        super(code, message);
    }

    /** No unit with this code exists for the tenant, in any casing. */
    public static UomInvalidException notFound(String field, String code) {
        return new UomInvalidException("UOM_NOT_FOUND",
                "Unknown unit of measure \"" + code + "\" for " + field + ".");
    }

    /**
     * The unit exists but belongs to a different physical dimension than the one it is being used
     * with — e.g. a {@code COUNT} ingredient whose stock unit is grams, which the ingredient form
     * allowed for as long as its two unit selects were unfiltered.
     */
    public static UomInvalidException dimensionMismatch(String message) {
        return new UomInvalidException("UOM_DIMENSION_MISMATCH", message);
    }

    /**
     * A conversion is self-referential, or a unit's own base/factor pair is internally inconsistent.
     */
    public static UomInvalidException conversionInvalid(String message) {
        return new UomInvalidException("UOM_CONVERSION_INVALID", message);
    }

    /**
     * A new unit reuses a code the tenant already has. Checked in the service rather than left to
     * V7's {@code uq_uom_tenant_code_ci} index, which would surface as a constraint-violation 500.
     * Matching is case-insensitive because the index is: {@code Case} and {@code CASE} are one unit.
     */
    public static UomInvalidException duplicateCode(String code, String name) {
        return new UomInvalidException("UOM_DUPLICATE_CODE",
                "The unit code \"" + code + "\" is already used by \"" + name + "\".");
    }
}
