package io.restaurantos.finance.autopost;

import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.InternalJePostResponse;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.payload.HrEventContract;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * THE regression test for the Wages Payable drift.
 *
 * <p>PAYROLL_RUN_APPROVED used to credit the GROSS to 2300 while PAYROLL_RUN_PAID cleared only the
 * NET. Each entry balanced on its own — which is exactly why nothing ever caught it — so asserting
 * "the JE balances" is NOT sufficient and never was. {@link #wagesPayableNetsToZeroAcrossApprovedAndPaid()}
 * is the assertion that would have failed: it tracks the running balance of the WAGES_PAYABLE
 * account across the approved+paid PAIR and requires it to be exactly zero.
 *
 * <p>Pure unit test on purpose: the algebra is arithmetic, and it should fail in milliseconds on a
 * laptop with no Docker rather than inside a Testcontainers IT.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PayrollRecipeUnitTest {

    // A realistic Aug-2025 run for a small branch, with every component non-zero:
    //   gross        Rs 250,000.00
    //   income tax   Rs   6,791.00
    //   EOBI          Rs     370.00  (1% of the 3.7M-paisa statutory wage base, per employee)
    //   advances     Rs  12,000.00
    //   late arrival Rs   1,500.00
    //   net = gross - tax - eobi - advances - lateArrival
    private static final long GROSS = 25_000_000L;
    private static final long TAX = 679_100L;
    private static final long EOBI = 37_000L;
    private static final long ADVANCES = 1_200_000L;
    private static final long LATE_ARRIVAL = 150_000L;
    private static final long NET = GROSS - TAX - EOBI - ADVANCES - LATE_ARRIVAL;

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID BRANCH = UUID.randomUUID();

    @Mock private AccountResolver accountResolver;
    @Mock private JournalEntryService jeService;
    @Mock private PostedSourceEventRepository postedSourceRepo;
    @Mock private TenantContext tenantContext;

    private AutoPostingRecipeEngine engine;

    @BeforeEach
    void setUp() {
        // The recipe resolves by system tag; the code it gets back is irrelevant to the algebra, so
        // the tag is echoed straight through and the assertions below read in tag terms.
        when(accountResolver.codeBySystemTag(anyString())).thenAnswer(inv -> inv.getArgument(0));
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        when(tenantContext.getBranchId()).thenReturn(Optional.of(BRANCH));
        when(postedSourceRepo.existsByTenantIdAndSourceTypeAndSourceId(any(), anyString(), any()))
                .thenReturn(false);
        when(jeService.autoPostInternal(any()))
                .thenReturn(new InternalJePostResponse(UUID.randomUUID(), "JE-1"));
        engine = new AutoPostingRecipeEngine(accountResolver, jeService, postedSourceRepo, tenantContext);
    }

    @Test
    void approvedEntry_debitsEqualCredits_withEveryComponentNonZero() {
        UUID runId = UUID.randomUUID();
        engine.postPayrollApproved(approved(runId));

        List<CreateJeLineRequest> lines = capturePosted().lines();
        long debits = lines.stream().mapToLong(CreateJeLineRequest::debitPaisa).sum();
        long credits = lines.stream().mapToLong(CreateJeLineRequest::creditPaisa).sum();

        assertThat(debits).isEqualTo(credits);
        assertThat(debits).isEqualTo(GROSS - LATE_ARRIVAL);
    }

    @Test
    void approvedEntry_splitsTheGrossAcrossTheStatutoryAccounts() {
        UUID runId = UUID.randomUUID();
        engine.postPayrollApproved(approved(runId));

        List<CreateJeLineRequest> lines = capturePosted().lines();

        // The late-arrival deduction reduces salary EXPENSE — it is a cost never incurred, so it is
        // not a payable to anyone. This is the line the old recipe got wrong by posting the gross.
        assertThat(debit(lines, "SALARY_EXPENSE")).isEqualTo(GROSS - LATE_ARRIVAL);

        // Only the NET is owed to the employee; the withholdings are owed elsewhere. Crediting the
        // gross here (the bug) is what left 2300 carrying the difference forever.
        assertThat(credit(lines, "WAGES_PAYABLE")).isEqualTo(NET);
        assertThat(credit(lines, "PAYE_PAYABLE")).isEqualTo(TAX);
        assertThat(credit(lines, "EOBI_PAYABLE")).isEqualTo(EOBI);
        // Advance recovery credits the employee-advances ASSET down — not income, not a liability.
        assertThat(credit(lines, "EMPLOYEE_ADVANCES")).isEqualTo(ADVANCES);

        assertThat(lines).noneMatch(l -> l.debitPaisa() == 0 && l.creditPaisa() == 0);
    }

    /**
     * The drift regression. Sums every WAGES_PAYABLE line across BOTH entries of one run and
     * requires the account to come back to exactly zero.
     *
     * <p>Under the old recipe this was {@code CR gross / DR net}, leaving
     * {@code tax + eobi + advances + lateArrival = 2,066,100} paisa stranded on 2300 per run, with
     * both entries individually balanced and no error anywhere.
     */
    @Test
    void wagesPayableNetsToZeroAcrossApprovedAndPaid() {
        UUID runId = UUID.randomUUID();

        engine.postPayrollApproved(approved(runId));
        engine.postPayrollPaid(paid(runId));

        ArgumentCaptor<InternalAutoPostJeRequest> captor =
                ArgumentCaptor.forClass(InternalAutoPostJeRequest.class);
        verify(jeService, org.mockito.Mockito.times(2)).autoPostInternal(captor.capture());

        long wagesPayableBalance = 0L;
        Map<String, Long> perAccount = new HashMap<>();
        for (InternalAutoPostJeRequest req : captor.getAllValues()) {
            // Every individual entry must still balance — the old bug passed this, which is the point.
            assertThat(req.lines().stream().mapToLong(CreateJeLineRequest::debitPaisa).sum())
                    .isEqualTo(req.lines().stream().mapToLong(CreateJeLineRequest::creditPaisa).sum());
            for (CreateJeLineRequest l : req.lines()) {
                // Liability sign convention: credits increase, debits decrease.
                perAccount.merge(l.accountCode(), l.creditPaisa() - l.debitPaisa(), Long::sum);
            }
            wagesPayableBalance += req.lines().stream()
                    .filter(l -> "WAGES_PAYABLE".equals(l.accountCode()))
                    .mapToLong(l -> l.creditPaisa() - l.debitPaisa())
                    .sum();
        }

        assertThat(wagesPayableBalance)
                .as("2300 Wages Payable must clear to exactly zero once a run is approved and paid")
                .isZero();

        // And the withheld money did not evaporate to make that happen — it is sitting on the
        // statutory accounts, waiting to be remitted.
        assertThat(perAccount.get("PAYE_PAYABLE")).isEqualTo(TAX);
        assertThat(perAccount.get("EOBI_PAYABLE")).isEqualTo(EOBI);
        assertThat(perAccount.get("EMPLOYEE_ADVANCES")).isEqualTo(ADVANCES);
        // Expense recognised = gross less the deduction for time not worked; cash out = net.
        assertThat(perAccount.get("SALARY_EXPENSE")).isEqualTo(-(GROSS - LATE_ARRIVAL));
        assertThat(perAccount.get("BANK")).isEqualTo(NET);
    }

    @Test
    void paidEntry_clearsExactlyTheNet() {
        UUID runId = UUID.randomUUID();
        engine.postPayrollPaid(paid(runId));

        List<CreateJeLineRequest> lines = capturePosted().lines();
        assertThat(debit(lines, "WAGES_PAYABLE")).isEqualTo(NET);
        assertThat(credit(lines, "BANK")).isEqualTo(NET);
    }

    @Test
    void zeroComponentLinesAreOmittedButTheEntryStillBalances() {
        UUID runId = UUID.randomUUID();
        long gross = 10_000_000L;
        engine.postPayrollApproved(envelope(new HrEventContract.PayrollApprovedPayload(
                runId, BRANCH, 8, 2025, gross, gross, 0, 0, 0, 0)));

        List<CreateJeLineRequest> lines = capturePosted().lines();
        assertThat(lines).hasSize(2);
        assertThat(debit(lines, "SALARY_EXPENSE")).isEqualTo(gross);
        assertThat(credit(lines, "WAGES_PAYABLE")).isEqualTo(gross);
    }

    /** A producer that breaks {@code net + tax + eobi + advances == gross - lateArrival} must not post. */
    @Test
    void unbalancedComponents_failLoudly() {
        UUID runId = UUID.randomUUID();
        assertThatThrownBy(() -> engine.postPayrollApproved(envelope(
                new HrEventContract.PayrollApprovedPayload(
                        runId, BRANCH, 8, 2025, GROSS, NET, TAX, EOBI, ADVANCES, LATE_ARRIVAL + 1))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("does not balance")
                .hasMessageContaining(runId.toString());
        verify(jeService, never()).autoPostInternal(any());
    }

    /**
     * A pre-V9 payload has no component fields, so they deserialize to 0 while the gross is real.
     * That must dead-letter with a diagnostic, not silently re-post the drift.
     */
    @Test
    void legacyPayloadWithoutComponents_failsRatherThanRepostingTheDrift() {
        UUID runId = UUID.randomUUID();
        assertThatThrownBy(() -> engine.postPayrollApproved(envelope(
                new HrEventContract.PayrollApprovedPayload(runId, BRANCH, 8, 2025, GROSS, 0, 0, 0, 0, 0))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("does not balance");
        verify(jeService, never()).autoPostInternal(any());
    }

    /** MED-6: a negative total is a defect upstream, not a small run. It must never no-op. */
    @Test
    void negativeTotals_throwInsteadOfSilentlySkipping() {
        UUID runId = UUID.randomUUID();

        assertThatThrownBy(() -> engine.postPayrollApproved(envelope(
                new HrEventContract.PayrollApprovedPayload(runId, BRANCH, 8, 2025, -1L, 0, 0, 0, 0, 0))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("negative totalGrossPaisa");

        assertThatThrownBy(() -> engine.postPayrollPaid(envelope(
                new HrEventContract.PayrollPaidPayload(runId, BRANCH, 8, 2025, -1L))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("negative totalNetPaisa");

        verify(jeService, never()).autoPostInternal(any());
    }

    /** A genuinely empty run posts nothing — but it is a warning, not a success. */
    @Test
    void zeroRun_postsNothing() {
        UUID runId = UUID.randomUUID();
        engine.postPayrollApproved(envelope(
                new HrEventContract.PayrollApprovedPayload(runId, BRANCH, 8, 2025, 0, 0, 0, 0, 0, 0)));
        engine.postPayrollPaid(envelope(new HrEventContract.PayrollPaidPayload(runId, BRANCH, 8, 2025, 0)));
        verify(jeService, never()).autoPostInternal(any());
    }

    @Test
    void alreadyPostedRun_isNotPostedTwice() {
        UUID runId = UUID.randomUUID();
        when(postedSourceRepo.existsByTenantIdAndSourceTypeAndSourceId(
                TENANT, AutoPostingRecipeEngine.SOURCE_PAYROLL_APPROVED, runId)).thenReturn(true);
        engine.postPayrollApproved(approved(runId));
        verify(jeService, never()).autoPostInternal(any());
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private InternalAutoPostJeRequest capturePosted() {
        ArgumentCaptor<InternalAutoPostJeRequest> captor =
                ArgumentCaptor.forClass(InternalAutoPostJeRequest.class);
        verify(jeService, org.mockito.Mockito.atLeastOnce()).autoPostInternal(captor.capture());
        return captor.getValue();
    }

    private static long debit(List<CreateJeLineRequest> lines, String accountCode) {
        return lines.stream().filter(l -> accountCode.equals(l.accountCode()))
                .mapToLong(CreateJeLineRequest::debitPaisa).sum();
    }

    private static long credit(List<CreateJeLineRequest> lines, String accountCode) {
        return lines.stream().filter(l -> accountCode.equals(l.accountCode()))
                .mapToLong(CreateJeLineRequest::creditPaisa).sum();
    }

    private static EventEnvelope<HrEventContract.PayrollApprovedPayload> approved(UUID runId) {
        return envelope(new HrEventContract.PayrollApprovedPayload(
                runId, BRANCH, 8, 2025, GROSS, NET, TAX, EOBI, ADVANCES, LATE_ARRIVAL));
    }

    private static EventEnvelope<HrEventContract.PayrollPaidPayload> paid(UUID runId) {
        return envelope(new HrEventContract.PayrollPaidPayload(runId, BRANCH, 8, 2025, NET));
    }

    private static <T> EventEnvelope<T> envelope(T payload) {
        return new EventEnvelope<>(UUID.randomUUID(), "PAYROLL", TENANT, BRANCH, Instant.now(),
                UUID.randomUUID(), 1, "hr-service", payload);
    }
}
