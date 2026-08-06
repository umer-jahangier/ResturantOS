package io.restaurantos.hr.payroll.tax;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Applies a statutory percentage rate to a paisa amount, yielding whole paisa.
 *
 * <p>Every rate in {@code tax_config} is {@code NUMERIC(6,3)} and every money amount in this system
 * is a {@code BIGINT} count of paisa. This is the single conversion between them, so the rounding
 * rule for payroll deductions is stated exactly once instead of being re-implemented — slightly
 * differently — at each call site.
 *
 * <p><b>HALF_UP, deliberately.</b> It matches the {@code Math.round(x / 100.0)} this replaces for
 * the non-negative amounts payroll deals in, so no existing payroll figure moves by this change.
 * It is also the conventional direction for statutory deductions. HALF_EVEN would be defensible in
 * the abstract but would silently shift historical results by a paisa on exact-half cases.
 *
 * <p>The multiplication happens before the division and entirely in {@link BigDecimal}, so a rate
 * such as {@code 0.001} is applied as written rather than as its nearest binary double.
 */
final class PercentOfPaisa {

    private PercentOfPaisa() {
    }

    /**
     * @param amountPaisa base amount in paisa
     * @param ratePct     percentage rate, e.g. {@code 1.000} meaning one percent
     * @return {@code amountPaisa * ratePct / 100}, rounded HALF_UP to whole paisa
     */
    static long apply(long amountPaisa, BigDecimal ratePct) {
        if (ratePct == null) {
            throw new IllegalArgumentException("Rate must not be null — a missing tax rate is a "
                    + "configuration fault and must never be silently treated as zero.");
        }
        return BigDecimal.valueOf(amountPaisa)
                .multiply(ratePct)
                .divide(BigDecimal.valueOf(100), 0, RoundingMode.HALF_UP)
                .longValueExact();
    }
}
