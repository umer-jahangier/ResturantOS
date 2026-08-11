package io.restaurantos.hr.exception;

/**
 * Nobody has configured a tax table for this fiscal year yet.
 *
 * <h2>Why this is not an {@code IllegalStateException}</h2>
 *
 * <p>It was one. {@code TaxConfigService.getActiveConfig} threw
 * {@code IllegalStateException("No active tax_config for tenant … fiscal year …")}, the shared
 * catch-all turned that into {@code 500 INTERNAL_ERROR — "An unexpected error occurred"}, and the
 * Payroll screen rendered it as a two-word toast. So the single most predictable condition in this
 * subsystem — a fiscal year that has begun and that nobody has entered rates for — reached the
 * operator as an unexplained server fault, on a screen offering no way to fix it, on the first of
 * July every year.
 *
 * <h2>Why it carries the fiscal year</h2>
 *
 * <p>Because "tax configuration missing" is not actionable and "no tax configuration exists for
 * fiscal year 2027" is. The year is also what the screen needs in order to link the operator
 * straight to the year they must fill in, rather than to a settings page where they then have to
 * work out which year payroll was asking about. Getting that wrong is easy: FY2027 begins in
 * July 2026 (see {@link io.restaurantos.hr.payroll.tax.FiscalYear}).
 *
 * <h2>Why there is no field path</h2>
 *
 * <p>35-01's rule, and it applies exactly here: a field path is an instruction to go and edit that
 * input, and nothing the caller typed caused this. The request was correct; the tenant's
 * configuration is absent. Inventing a path would send someone to change a correct value.
 */
public class TaxConfigNotConfiguredException extends RuntimeException {

    /** The code the client binds a "configure this year" action to. */
    public static final String CODE = "TAX_CONFIG_NOT_CONFIGURED";

    private final int fiscalYear;

    public TaxConfigNotConfiguredException(int fiscalYear) {
        // Written for the person who reads it. It names the year, says what is absent, and says
        // what to do. It deliberately does NOT say "try again" — retrying cannot help, and phase 19
        // found a wrong-password error rendering "Please sign in again", which sent users to do the
        // one thing that could not work. It also does not describe the condition as unexpected,
        // because it is the opposite of unexpected.
        super("No tax configuration exists for fiscal year " + fiscalYear
                + ". Payroll cannot be calculated until the income-tax slabs and EOBI rates for"
                + " that year are entered under HR settings.");
        this.fiscalYear = fiscalYear;
    }

    public int getFiscalYear() {
        return fiscalYear;
    }
}
