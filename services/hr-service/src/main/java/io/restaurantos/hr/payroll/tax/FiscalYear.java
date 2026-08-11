package io.restaurantos.hr.payroll.tax;

import java.time.Clock;
import java.time.LocalDate;

/**
 * Which fiscal year a payroll period belongs to.
 *
 * <h2>The rule, in the domain's own terms</h2>
 *
 * <p>Pakistan's fiscal year runs from 1 July to 30 June and is <b>named for the calendar year it
 * ends in</b>. So the year that began on 1 July 2026 and ends on 30 June 2027 is "FY2027", and a
 * payroll run for August 2026 and one for February 2027 belong to the same fiscal year.
 *
 * <h2>Why this is a class and not an expression</h2>
 *
 * <p>It was {@code periodMonth >= 7 ? periodYear + 1 : periodYear}, written inline at the top of
 * {@code PayrollRunService.calculate}. That is correct, and it is also unreadable: nothing in it
 * says which of several possible fiscal-year conventions it encodes, so the next reader has to
 * reverse-engineer the convention from the arithmetic.
 *
 * <p>It became a real problem when the tax-configuration screen arrived. That screen must open on
 * the year payroll will actually ask for, which means the rule now has two callers in two languages.
 * A copy of the ternary in TypeScript would be a second implementation of a statutory convention,
 * and the failure mode when the two drift is not a crash — it is a screen that cheerfully configures
 * FY2026 while payroll refuses because FY2027 is missing, with both halves apparently working. So
 * the server exposes the answer over an endpoint and there is exactly one implementation.
 */
public final class FiscalYear {

    private FiscalYear() {
    }

    /**
     * The fiscal year containing a payroll period.
     *
     * @param month 1-12, the payroll period's calendar month
     * @param year  the payroll period's calendar year
     * @return the fiscal year, named for the calendar year it ends in
     */
    public static int forPeriod(int month, int year) {
        if (month < 1 || month > 12) {
            // Not a caller-input path: PayrollRunService's period month is already constrained to
            // 1-12 by bean validation before it reaches here. This guard exists so that a future
            // caller passing a zero-based month gets an immediate failure rather than a fiscal year
            // that is quietly one out for exactly one month of the year.
            throw new IllegalArgumentException(
                    "Month must be 1-12 to belong to a fiscal year, was " + month);
        }
        // July starts the new fiscal year, which is named for the calendar year it ENDS in — hence
        // the +1 for the second half of the calendar year and not the first.
        return month >= 7 ? year + 1 : year;
    }

    /**
     * The fiscal year the clock is currently in.
     *
     * <p>The clock is a parameter rather than a static {@code LocalDate.now()} so that the
     * June-to-July turnover can be asserted by a test instead of only by waiting until July. It
     * carries its own zone, and the year turns over when the LOCAL date does — five hours before
     * UTC midnight in Pakistan.
     */
    public static int current(Clock clock) {
        LocalDate today = LocalDate.now(clock);
        return forPeriod(today.getMonthValue(), today.getYear());
    }
}
