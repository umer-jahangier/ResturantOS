package io.restaurantos.purchasing.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

import java.util.List;

/**
 * The pack unit on a vendor-catalog row is not a unit this tenant defines, so inventory could not
 * convert a goods receipt made against it.
 *
 * <p>Extends {@link RestaurantOsException} rather than carrying a bare {@code @ResponseStatus}:
 * Spring resolves an {@code @ExceptionHandler} by exception hierarchy before it considers the
 * annotation, and shared-lib's handler claims {@code Exception}, so an annotation-only exception
 * surfaces as 500. {@code PurchasingExceptionHandler} maps this to 422 — the request is
 * well-formed, it just cannot be processed against this tenant's unit registry.
 *
 * <p>The message names the units that WOULD work; a refusal that does not say what to type instead
 * just moves the guessing.
 */
public class PackUomInvalidException extends RestaurantOsException {

    /** How many valid codes to name before the message stops being readable. */
    private static final int MAX_SUGGESTED = 12;

    public PackUomInvalidException(String packUom, List<String> knownCodes) {
        super("PACK_UOM_INVALID", buildMessage(packUom, knownCodes));
    }

    private static String buildMessage(String packUom, List<String> knownCodes) {
        List<String> shown = knownCodes.size() > MAX_SUGGESTED
                ? knownCodes.subList(0, MAX_SUGGESTED) : knownCodes;
        String suffix = knownCodes.size() > MAX_SUGGESTED ? ", …" : "";
        return "'" + packUom + "' is not a unit of measure in this tenant. Goods receipts are "
                + "converted from the pack unit into the ingredient's stock unit, so it must be one "
                + "of: " + String.join(", ", shown) + suffix;
    }
}
