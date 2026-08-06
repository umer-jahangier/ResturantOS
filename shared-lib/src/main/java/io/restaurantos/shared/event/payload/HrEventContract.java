package io.restaurantos.shared.event.payload;

import java.util.UUID;

/**
 * THE wire contract for the {@code hr.topic} events consumed outside hr-service.
 *
 * <p><b>Why this class exists.</b> The 2026-08-02 integration repair moved every cross-service
 * payload onto shared records precisely because untyped {@code Map<String, Object>} payloads plus
 * ITs that hand-authored the consumer's own guessed key names produced "green tests over four dead
 * seams". Payroll was never converted: hr-service kept publishing a {@code HashMap} and
 * finance-service kept reading it with a {@code longVal} helper that returns {@code 0} for a
 * missing key. That is the same loaded gun, still cocked — a producer rename would have silently
 * posted a zero-value journal entry instead of failing to compile.
 *
 * <p><b>Why the approved payload carries the components and not just the gross.</b> The recipe used
 * to credit the GROSS to Wages Payable while the paid recipe cleared only the NET. Each entry
 * balanced on its own, so nothing ever errored, but the withheld difference (income tax, EOBI
 * employee share, advance recovery, late-arrival deduction) was never credited to any statutory
 * payable — account 2300 accumulated a permanently growing balance, one payroll cycle at a time.
 * Finance cannot split the gross without the components, and it must never re-derive them: the
 * deduction rules (slab tax, the fixed EOBI wage base, the branch attendance policy) belong to HR.
 *
 * <p><b>Invariant, enforced on both sides:</b>
 * {@code totalNetPaisa + totalTaxPaisa + totalEobiPaisa + totalAdvancesPaisa
 * == totalGrossPaisa - totalLateArrivalPaisa}. hr-service establishes it per payslip in
 * {@code PayrollRunService.calculate}; finance-service re-checks it before posting rather than
 * trusting the sum to balance.
 *
 * @see InventoryEventContract for why these records are shared rather than duplicated
 */
public final class HrEventContract {

    private HrEventContract() {}

    public static final String EXCHANGE = "hr.topic";

    public static final String PAYROLL_RUN_APPROVED = "PAYROLL_RUN_APPROVED";
    public static final String PAYROLL_RUN_PAID = "PAYROLL_RUN_PAID";

    public static final String PAYROLL_RUN_APPROVED_KEY = "hr.payroll.approved";
    public static final String PAYROLL_RUN_PAID_KEY = "hr.payroll.paid";

    /**
     * PAYROLL_RUN_APPROVED — the run is authorised; the obligation is recognised in the ledger.
     * Consumed by finance-service, which posts
     * {@code DR salary expense (gross - lateArrival) · CR wages payable (net), PAYE payable (tax),
     * EOBI payable (eobi), employee advances (advances)}.
     *
     * <p>All amounts are BIGINT paisa and are RUN totals — the sum across every payslip in the run,
     * never a per-employee figure.
     *
     * <p>{@code totalLateArrivalPaisa} reduces salary EXPENSE rather than crediting a payable: a
     * late-arrival deduction is a cost the employer never incurred, not money withheld on someone's
     * behalf. {@code totalAdvancesPaisa} credits the employee-advances ASSET, because recovering an
     * advance settles a receivable — it is not income and not a liability.
     */
    public record PayrollApprovedPayload(
            UUID runId,
            UUID branchId,
            int periodMonth,
            int periodYear,
            long totalGrossPaisa,
            long totalNetPaisa,
            long totalTaxPaisa,
            long totalEobiPaisa,
            long totalAdvancesPaisa,
            long totalLateArrivalPaisa
    ) {}

    /**
     * PAYROLL_RUN_PAID — the net was disbursed from the bank. Consumed by finance-service, which
     * posts {@code DR wages payable · CR bank} for {@code totalNetPaisa} — the same net the approved
     * entry credited to wages payable, so the account clears to exactly zero per run.
     */
    public record PayrollPaidPayload(
            UUID runId,
            UUID branchId,
            int periodMonth,
            int periodYear,
            long totalNetPaisa
    ) {}
}
