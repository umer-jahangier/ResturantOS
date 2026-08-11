package io.restaurantos.inventory.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

import java.util.UUID;

/**
 * A goods-receipt line's unit cannot be converted into the ingredient's stock unit, so the receipt
 * is refused rather than taken at face value.
 *
 * <h2>Why this is a throw and not a log</h2>
 *
 * {@code GrnUomResolver} used to log at ERROR and fall back to a factor of one — receiving the
 * quantity as if it were already in the ingredient's stock unit. That was a deliberate choice with
 * a stated reason: throwing would dead-letter the GRN batch <em>after finance had already posted
 * its GR/IR entry</em>, turning a valuation error into a reconciliation gap.
 *
 * <p><b>That reason no longer holds.</b> Since phase 14, finance posts the receipt entry from the
 * real stock lot, not from the GRN message — so a refused receipt strands no journal entry, because
 * no journal entry has been made yet. Nothing is left half-posted by refusing.
 *
 * <p>What the fallback cost, measured on this stack: a purchase-order line with the unit
 * {@code FURLONG} was received, and <b>seven furlongs became seven kilograms</b> of Basmati Rice.
 * Nothing failed. The receipt succeeded, the entry balanced, the invoice three-way-matched. Only
 * the numbers were wrong, which is the failure mode this codebase keeps producing.
 *
 * <p>Plan 36-04 now refuses the same line at the API, where a person is present and can fix it.
 * This is the second line of defence, for a message that reaches inventory some other way — and it
 * dead-letters, which is loud, rather than creating stock nobody ordered at a cost nobody paid.
 */
public class GrnUomUnresolvableException extends RestaurantOsException {

    public GrnUomUnresolvableException(UUID grnId, UUID ingredientId, String packUom,
                                       String baseUom, String reason) {
        super("GRN_UOM_UNRESOLVABLE",
                "GRN " + grnId + ": cannot convert '" + packUom + "' into ingredient " + ingredientId
                        + "'s stock unit '" + baseUom + "' — " + reason
                        + ". The receipt is refused rather than recorded at face value, which would "
                        + "add the wrong quantity at the wrong unit cost and be invisible afterwards.");
    }
}
