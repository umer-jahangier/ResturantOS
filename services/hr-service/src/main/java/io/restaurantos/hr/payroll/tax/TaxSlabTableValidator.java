package io.restaurantos.hr.payroll.tax;

import io.restaurantos.hr.dto.TaxConfigDtos.SlabRequest;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.FieldValidationException.Violation;
import io.restaurantos.shared.print.ReceiptMoneyFormatter;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * The four rules a slab table must satisfy that no constraint annotation can express.
 *
 * <h2>Why these four, and why they are not fussiness</h2>
 *
 * <p>Each one produces a payslip that is correct for most salaries and wrong for a band — the
 * hardest kind of defect to notice and the most expensive to find late, because the people whose
 * pay is wrong are a minority and the obvious check ("does payroll run?") passes.
 *
 * <ul>
 *   <li><b>A gap.</b> {@link SlabTaxCalculator} finds no bracket for an income that lands in it and
 *       throws, which fails the whole payroll run — for one employee's salary, in the middle of a
 *       month-end, with no indication that the cause is a configuration typed weeks earlier.</li>
 *   <li><b>An overlap.</b> The first matching bracket wins, so the tax an employee pays depends on
 *       the order rows happen to sit in. Nothing fails; the number is just wrong.</li>
 *   <li><b>A first band that does not start at zero.</b> Every salary below that point has no
 *       bracket — usually the lowest-paid staff, who are also the least likely to audit a payslip.</li>
 *   <li><b>No open top, or more than one.</b> The highest earners have no bracket at all, or two
 *       and an order-dependent answer.</li>
 * </ul>
 *
 * <h2>Every violation at once, each naming its own row</h2>
 *
 * <p>A six-row slab editor that reports its second bad row only after the first is fixed is the
 * experience this phase exists to remove. Paths are dot-indexed ({@code slabs.2.minPaisa}) because
 * that is what the web client's binder walks — see {@code GlobalExceptionHandler.toClientPath}.
 *
 * <h2>Row order is not a violation</h2>
 *
 * <p>Contiguity is checked against the table SORTED by lower bound, and violations are reported
 * against the row's original index. A table typed out of order but otherwise sound is accepted and
 * stored in order — because once there are no gaps and no overlaps, exactly one bracket matches any
 * income and the calculator's {@code findFirst} cannot pick a different one. Refusing an
 * out-of-order table would be refusing a correct configuration for being untidy.
 */
public final class TaxSlabTableValidator {

    /** The code the client switches on to highlight rows of the slab editor. */
    public static final String CODE = "TAX_SLABS_INVALID";

    private TaxSlabTableValidator() {
    }

    /**
     * @param slabs the table as sent, in the caller's order
     * @throws FieldValidationException carrying one violation per offending row, if any
     */
    public static void validate(List<SlabRequest> slabs) {
        List<Violation> violations = new ArrayList<>();

        // Per-row sanity first. A band that ends at or below where it starts makes every
        // neighbouring comparison meaningless, so say so about that row rather than letting it
        // cascade into a confusing gap message about the row after it.
        for (int i = 0; i < slabs.size(); i++) {
            SlabRequest s = slabs.get(i);
            if (s.maxPaisa() != null && s.maxPaisa() <= s.minPaisa()) {
                violations.add(new Violation(path(i, "maxPaisa"),
                        "This band ends at " + money(s.maxPaisa()) + ", which is not above the "
                                + money(s.minPaisa()) + " it starts at. Enter a higher upper limit,"
                                + " or leave it empty if this is the highest band."));
            }
        }

        List<Integer> byLowerBound = new ArrayList<>();
        for (int i = 0; i < slabs.size(); i++) {
            byLowerBound.add(i);
        }
        byLowerBound.sort(Comparator.comparingLong(i -> slabs.get(i).minPaisa()));

        validateOpenTop(slabs, byLowerBound, violations);
        validateStartsAtZero(slabs, byLowerBound, violations);
        validateContiguous(slabs, byLowerBound, violations);

        if (!violations.isEmpty()) {
            throw new FieldValidationException(CODE,
                    "The income bands do not form a complete table. "
                            + violations.size() + " band"
                            + (violations.size() == 1 ? "" : "s") + " need attention.",
                    violations);
        }
    }

    /** Sort the accepted table so the stored JSONB reads in the order a human would write it. */
    public static List<SlabRequest> inAscendingOrder(List<SlabRequest> slabs) {
        return slabs.stream()
                .sorted(Comparator.comparingLong(SlabRequest::minPaisa))
                .toList();
    }

    private static void validateOpenTop(List<SlabRequest> slabs, List<Integer> byLowerBound,
                                        List<Violation> violations) {
        List<Integer> openEnded = byLowerBound.stream()
                .filter(i -> slabs.get(i).maxPaisa() == null)
                .toList();

        if (openEnded.isEmpty()) {
            // Blame the highest band, because that is the one that should have been left open.
            int highest = byLowerBound.get(byLowerBound.size() - 1);
            violations.add(new Violation(path(highest, "maxPaisa"),
                    "The highest band must have no upper limit, or any salary above "
                            + money(slabs.get(highest).maxPaisa()) + " falls in no band at all."
                            + " Clear the upper limit on this band."));
            return;
        }
        if (openEnded.size() == 1) {
            return;
        }
        // More than one. The one with the highest lower bound is the plausible top; every other
        // open band is the mistake, so name those and leave the top alone.
        for (int k = 0; k < openEnded.size() - 1; k++) {
            int i = openEnded.get(k);
            violations.add(new Violation(path(i, "maxPaisa"),
                    "Only the highest band may be left open. Enter the income this band ends at."));
        }
    }

    private static void validateStartsAtZero(List<SlabRequest> slabs, List<Integer> byLowerBound,
                                             List<Violation> violations) {
        int first = byLowerBound.get(0);
        long firstMin = slabs.get(first).minPaisa();
        if (firstMin != 0L) {
            violations.add(new Violation(path(first, "minPaisa"),
                    "The lowest band must start at 0. As entered, any salary below "
                            + money(firstMin) + " falls in no band and payroll cannot be"
                            + " calculated for the staff who earn it."));
        }
    }

    private static void validateContiguous(List<SlabRequest> slabs, List<Integer> byLowerBound,
                                           List<Violation> violations) {
        for (int k = 1; k < byLowerBound.size(); k++) {
            int prevIdx = byLowerBound.get(k - 1);
            int curIdx = byLowerBound.get(k);
            SlabRequest prev = slabs.get(prevIdx);
            SlabRequest cur = slabs.get(curIdx);

            if (prev.maxPaisa() == null) {
                // Already reported by validateOpenTop as a non-top open band. Reporting a gap here
                // too would put two messages on one mistake and make the table look worse than it is.
                continue;
            }
            if (cur.minPaisa() > prev.maxPaisa()) {
                violations.add(new Violation(path(curIdx, "minPaisa"),
                        "There is a gap: no band covers income between " + money(prev.maxPaisa())
                                + " and " + money(cur.minPaisa()) + ". Start this band at "
                                + money(prev.maxPaisa()) + "."));
            } else if (cur.minPaisa() < prev.maxPaisa()) {
                violations.add(new Violation(path(curIdx, "minPaisa"),
                        "This band overlaps the one ending at " + money(prev.maxPaisa())
                                + ". Two bands covering the same income make the tax depend on"
                                + " row order. Start this band at " + money(prev.maxPaisa()) + "."));
            }
        }
    }

    private static String path(int index, String field) {
        return "slabs." + index + "." + field;
    }

    /** The product's one paisa-to-string rule, so an error message cannot invent a second. */
    private static String money(long paisa) {
        return ReceiptMoneyFormatter.format(paisa);
    }
}
