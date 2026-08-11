package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.exception.IngredientNotInTenantException;
import io.restaurantos.purchasing.exception.PackUomInvalidException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The one place a purchase-order line is judged honourable: does it name an ingredient this
 * tenant's inventory actually has, and a unit inventory could actually convert?
 *
 * <h2>The defect this closes (D-36-04, findings F-31-02 and F-31-03)</h2>
 *
 * Both measured against the live stack, both reported as successes at every step:
 *
 * <ul>
 *   <li>A line naming a freshly generated UUID as its {@code ingredientId} was accepted, submitted,
 *       approved, sent and received. The order closed as {@code FULLY_RECEIVED}. There was no stock
 *       row, no inventory movement and no journal entry — the message dead-lettered about twenty
 *       seconds later into a queue with no consumer and no monitor.</li>
 *   <li>A line whose unit was the string {@code FURLONG} was accepted the same way, and seven
 *       furlongs became <b>seven kilograms</b> of Basmati Rice: {@code GrnUomResolver} cannot
 *       resolve an unknown code, logs at ERROR, and receives at face value.</li>
 * </ul>
 *
 * Reporting success and producing nothing is the worst available outcome. The right moment to
 * refuse is at creation, where a person is present and can correct the line; refusing later only
 * moves the silence.
 *
 * <h2>Which unit is actually checked, and why it is not the one you expect</h2>
 *
 * The unit that travels on the goods-receipt event — the one inventory will try to resolve — is
 * <b>not</b> the same field for the two line shapes (see {@code GrnReceiptSimulator#packUom}):
 *
 * <ul>
 *   <li><b>Catalog line:</b> the vendor item's {@code packUom}. Never {@code orderUom}, which is
 *       the outer unit the price is quoted in ("CASE"), and never the line's own {@code uom}, which
 *       defaults to {@code orderUom} for exactly that reason.</li>
 *   <li><b>Hand-typed line:</b> the line's own {@code uom}, which is free text.</li>
 * </ul>
 *
 * Validating the wrong one would pass a line that still receives at face value — the check would
 * exist, be green, and prevent nothing. That is the failure mode this whole phase exists to end.
 *
 * <h2>Fail-closed on a definitive no, degrade-open on an outage</h2>
 *
 * A confirmed "this ingredient does not exist in your tenant" refuses. A transport failure allows
 * and logs, once per request rather than once per line. The asymmetry is deliberate: a brief
 * inventory outage must not make purchasing unwritable, while a confirmed absence is the entire
 * point of the check. Both underlying validators already hold that contract; this class applies
 * them to the right values at the right moment and batches their lookups.
 */
@Service
public class PoLineValidityGate {

    private static final Logger log = LoggerFactory.getLogger(PoLineValidityGate.class);

    /** How many offending lines to name before the message stops being readable. */
    private static final int MAX_REPORTED = 10;

    private final IngredientReferenceValidator ingredientReferenceValidator;
    private final PackUomValidator packUomValidator;

    public PoLineValidityGate(IngredientReferenceValidator ingredientReferenceValidator,
                              PackUomValidator packUomValidator) {
        this.ingredientReferenceValidator = ingredientReferenceValidator;
        this.packUomValidator = packUomValidator;
    }

    /**
     * One line, already resolved so both shapes arrive in the same form.
     *
     * @param lineNumber   1-based, for a message a human can act on
     * @param ingredientId the ingredient the line will consume against
     * @param receiptUom   THE UNIT THAT WILL TRAVEL ON THE GOODS-RECEIPT EVENT — the vendor item's
     *                     pack unit for a catalog line, the line's own unit for a hand-typed one
     */
    public record ResolvedLine(int lineNumber, UUID ingredientId, String receiptUom) {}

    /**
     * Refuse the whole request if any line is not honourable.
     *
     * <p>Every line is judged before anything is raised, and the failure names them all: a caller
     * fixing a twenty-line order one refusal at a time will stop using the screen.
     *
     * @throws IngredientNotInTenantException if any line's ingredient definitively does not exist
     * @throws PackUomInvalidException        if any line's receipt unit is not in the tenant's registry
     */
    public void requireAllLinesValid(List<ResolvedLine> lines) {
        if (lines == null || lines.isEmpty()) {
            return;
        }

        List<String> badIngredients = new ArrayList<>();
        List<String> badUnits = new ArrayList<>();
        PackUomInvalidException firstUnitFailure = null;

        // Distinct ids and codes: a twenty-line order against five ingredients asks about five,
        // not twenty. The underlying validators are per-value, so de-duplication here is what keeps
        // the request from making forty internal calls.
        Set<UUID> distinctIngredients = new LinkedHashSet<>();
        Set<String> distinctUnits = new LinkedHashSet<>();
        for (ResolvedLine line : lines) {
            if (line.ingredientId() != null) distinctIngredients.add(line.ingredientId());
            if (line.receiptUom() != null && !line.receiptUom().isBlank()) {
                distinctUnits.add(line.receiptUom());
            }
        }

        Set<UUID> rejectedIngredients = new LinkedHashSet<>();
        for (UUID ingredientId : distinctIngredients) {
            try {
                ingredientReferenceValidator.requireIngredientInTenant(ingredientId);
            } catch (IngredientNotInTenantException e) {
                rejectedIngredients.add(ingredientId);
            }
        }

        Set<String> rejectedUnits = new LinkedHashSet<>();
        for (String uom : distinctUnits) {
            try {
                packUomValidator.requireKnownPackUom(uom);
            } catch (PackUomInvalidException e) {
                rejectedUnits.add(uom);
                if (firstUnitFailure == null) firstUnitFailure = e;
            }
        }

        for (ResolvedLine line : lines) {
            if (line.ingredientId() != null && rejectedIngredients.contains(line.ingredientId())) {
                badIngredients.add("line " + line.lineNumber() + " (" + line.ingredientId() + ")");
            }
            if (line.receiptUom() != null && rejectedUnits.contains(line.receiptUom())) {
                badUnits.add("line " + line.lineNumber() + " ('" + line.receiptUom() + "')");
            }
        }

        // Ingredient first: a line with both problems is more usefully reported as "that ingredient
        // does not exist" than as "that unit is unknown", because fixing the ingredient usually
        // fixes the unit too.
        if (!badIngredients.isEmpty()) {
            throw new IngredientNotInTenantException(
                    "These purchase-order lines name an ingredient that is not in this tenant's "
                            + "inventory, so a goods receipt against them would create no stock and "
                            + "no ledger entry: " + summarise(badIngredients)
                            + ". Choose an ingredient that exists, or create it in Inventory first.");
        }
        if (!badUnits.isEmpty()) {
            // Reuse the existing exception so the PACK_UOM_INVALID code and its "it must be one
            // of: …" suffix — which name the units that WOULD work — are preserved for anything
            // already branching on them.
            throw firstUnitFailure;
        }
    }

    /** Called once per request when the lookup could not be made at all. */
    public void logDegradation(String reason) {
        log.warn("Purchase-order line validity could not be checked ({}); allowing the create. "
                + "A line naming an ingredient inventory does not have will still dead-letter at "
                + "receipt — this only moves where it is discovered.", reason);
    }

    private static String summarise(List<String> offenders) {
        if (offenders.size() <= MAX_REPORTED) {
            return String.join(", ", offenders);
        }
        return String.join(", ", offenders.subList(0, MAX_REPORTED))
                + " and " + (offenders.size() - MAX_REPORTED) + " more";
    }
}
