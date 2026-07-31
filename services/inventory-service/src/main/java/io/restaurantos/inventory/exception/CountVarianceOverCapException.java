package io.restaurantos.inventory.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

import java.util.List;
import java.util.UUID;

/**
 * One or more count lines exceeded their category's variance cap without an override reason.
 * Maps to HTTP 422 {@code COUNT_VARIANCE_OVER_CAP} via {@code InventoryExceptionHandler}.
 *
 * <p>This is deliberately NOT a hard refusal. A physical count is physical reality — if the shelf
 * holds 41 units, the system has to be able to say so, however large the gap. What a cap buys is
 * that a gap that big becomes a DELIBERATE, ATTRIBUTED act rather than a silent write-off: resubmit
 * the same line with a reason and it posts, with the reason stored against it forever.
 *
 * <p>Before this existed, {@code item_categories.variance_cap_pct} was settable but read by
 * nothing, so a mis-keyed count of 4100 → 41 wrote off the difference with no prompt and left a
 * ledger entry indistinguishable from a correct one.
 */
public class CountVarianceOverCapException extends RestaurantOsException {

    private final List<OverCapLine> lines;

    public CountVarianceOverCapException(List<OverCapLine> lines) {
        super("COUNT_VARIANCE_OVER_CAP", buildMessage(lines));
        this.lines = List.copyOf(lines);
    }

    public List<OverCapLine> getLines() {
        return lines;
    }

    /** Everything the count sheet needs to mark the offending row and explain the number. */
    public record OverCapLine(UUID ingredientId, String ingredientName, String variancePct, String capPct) {

        /**
         * Percentages read back at their natural precision, so a 5% cap stored as
         * {@code NUMERIC(6,2)} says "5%" and not "5.00%". Trailing-zero noise in an error message
         * makes a threshold look more precise than anyone actually set it.
         */
        public static OverCapLine of(UUID ingredientId, String ingredientName,
                                      java.math.BigDecimal variancePct, java.math.BigDecimal capPct) {
            return new OverCapLine(ingredientId, ingredientName, plain(variancePct), plain(capPct));
        }

        private static String plain(java.math.BigDecimal value) {
            return value.stripTrailingZeros().toPlainString();
        }
    }

    private static String buildMessage(List<OverCapLine> lines) {
        if (lines.size() == 1) {
            OverCapLine line = lines.get(0);
            return "\"" + line.ingredientName() + "\" is off by " + line.variancePct()
                    + "%, over its " + line.capPct() + "% variance cap. Add a reason to post it anyway.";
        }
        return lines.size() + " items are over their variance cap. Add a reason to each to post them anyway.";
    }
}
