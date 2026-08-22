package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.TillStatus;
import io.restaurantos.pos.dto.EligibleCashierDto;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.feign.AuthUserDirectoryClient;
import io.restaurantos.pos.service.TillService;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * F11 — "the duty manager counts the float and hands over the drawer".
 *
 * <h2>What this test would have caught</h2>
 *
 * <p>{@code openTill} derived the cashier from the caller's own subject, so a supplied
 * {@code cashierId} was silently DROPPED — the request succeeded and opened the wrong person's
 * drawer. Silently, which is why nothing failed: {@link TillReconciliationIT} asserts
 * {@code dto.cashierId() == cashierId} only for a caller opening their OWN till, which is the one
 * case that was never broken. Measured live on 2026-08-12 through the gateway, a manager POSTing
 * {@code cashierId=<the cashier>} was answered
 * {@code 409 "Cashier already has an open till session: fefd7187-…"} — the MANAGER's own id.
 *
 * <p>Every assertion below therefore turns on the difference between the CALLER and the TARGET.
 * Run against the old code, {@link #managerOpensADrawerForANamedCashier} fails on the first
 * assertion: the session comes back owned by the manager.
 */
class TillOpenForCashierIT extends PosTestBase {

    @Autowired TillService tillService;
    @Autowired TenantContext tenantContext;
    @Autowired OutboxRepository outboxRepository;

    /**
     * The staff directory is the authority on "may this person be handed a drawer here", and this
     * suite has no auth-service. Stubbed per-test so each case states the roster it assumes.
     */
    @MockitoBean AuthUserDirectoryClient authUserDirectoryClient;

    UUID tenantId;
    UUID branchId;
    UUID managerId;
    UUID cashierId;
    UUID otherCashierId;
    UUID reviewerId;

    private static final String OPEN_OWN = "pos.till.open";
    private static final String OPEN_OTHER = "pos.till.open.other";
    private static final String REVIEW = "pos.till.review";

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        managerId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        otherCashierId = UUID.randomUUID();
        reviewerId = UUID.randomUUID();

        // The directory's default answer: everybody named here is a cashier at this branch.
        when(authUserDirectoryClient.getUserPermissions(any(), any(), any()))
                .thenReturn(new AuthUserDirectoryClient.ResolvedAuth(branchId, List.of(OPEN_OWN)));
        when(authUserDirectoryClient.getUser(any(), any()))
                .thenReturn(new AuthUserDirectoryClient.UserDetailEnvelope(
                        new AuthUserDirectoryClient.UserDetailBody(
                                new AuthUserDirectoryClient.UserSummaryBody(
                                        cashierId, "shift.cashier@terrace.local", "Shift Cashier"))));
    }

    /**
     * Leave the shared JVM's static security context clean.
     *
     * <p>{@code SecurityContextHolder} is static and this suite shares one JVM across every IT
     * class, so a class that leaks its principal makes the NEXT class's result depend on run order.
     * Adding this clear is what exposed
     * {@code TillReconciliationIT.closeTill_withOrderCreatedViaOrderService_linksTillSessionAndCashier}
     * as passing only because an earlier class had left one behind — it now sets its own, so both
     * classes stand alone.
     */
    @AfterEach
    void clearAuth() {
        SecurityContextHolder.clearContext();
        tenantContext.clear();
    }

    // ── (1) THE FINDING ───────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a manager opens a Rs 5,000 float FOR a named cashier, and it is the cashier's drawer")
    void managerOpensADrawerForANamedCashier() {
        asManager();

        TillSessionDto opened = tillService.openTill(
                new OpenTillRequest(branchId, 500_000L, cashierId));

        // The whole finding, in one assertion: the drawer belongs to the person it was opened FOR,
        // not to whoever pressed the button. Fails on the old code — it comes back as managerId.
        assertThat(opened.cashierId()).isEqualTo(cashierId);
        assertThat(opened.cashierId()).isNotEqualTo(managerId);
        assertThat(opened.openingFloatPaisa()).isEqualTo(500_000L);
        assertThat(opened.status()).isEqualTo(TillStatus.OPEN);

        // …and the cashier's own terminal finds it. `useActiveTill()` asks exactly this question,
        // so this is the "No active till" strip in walkthrough §0, asserted at the seam.
        asCashier();
        List<TillSessionDto> theirs = tillService.listTills(cashierId, "OPEN");
        assertThat(theirs).hasSize(1);
        assertThat(theirs.get(0).id()).isEqualTo(opened.id());
        assertThat(theirs.get(0).openingFloatPaisa()).isEqualTo(500_000L);

        // The manager did NOT thereby open a drawer for themselves.
        assertThat(tillsOf(managerId)).isEmpty();
    }

    @Test
    @DisplayName("the TILL_OPENED event records whose drawer it is AND who counted the float")
    void tillOpenedEventCarriesBothPeople() {
        asManager();
        tillService.openTill(new OpenTillRequest(branchId, 500_000L, cashierId));

        String payload = outboxRepository.findAll().stream()
                .filter(e -> "TILL_OPENED".equals(e.getEventType()))
                .map(e -> e.getEnvelopeJson())
                .findFirst()
                .orElseThrow(() -> new AssertionError("no TILL_OPENED event was written"));

        assertThat(payload).contains(cashierId.toString());
        assertThat(payload).contains(managerId.toString());
    }

    // ── (2) A CASHIER MAY NOT OPEN SOMEBODY ELSE'S DRAWER ─────────────────────────────────

    @Test
    @DisplayName("a cashier naming a colleague is refused, by that colleague's name")
    void cashierCannotOpenADrawerForSomeoneElse() {
        asCashier();

        assertThatThrownBy(() -> tillService.openTill(
                new OpenTillRequest(branchId, 500_000L, otherCashierId)))
                .isInstanceOf(PosExceptions.TillOpenForOtherDeniedException.class)
                // Named, not a bare "forbidden" — the cashier has to learn WHOSE drawer they tried
                // to open and that it is a manager's job.
                .hasMessageContaining("Shift Cashier")
                .hasMessageContaining("pos.till.open.other");

        // …and nothing was created for either of them.
        assertThat(tillsOf(otherCashierId)).isEmpty();
        assertThat(tillsOf(cashierId)).isEmpty();
    }

    @Test
    @DisplayName("a cashier naming THEMSELVES is normal work and still succeeds")
    void cashierNamingThemselvesIsUnaffected() {
        asCashier();

        TillSessionDto own = tillService.openTill(new OpenTillRequest(branchId, 100_000L, cashierId));

        assertThat(own.cashierId()).isEqualTo(cashierId);
        assertThat(own.openingFloatPaisa()).isEqualTo(100_000L);
    }

    // ── (3) THE TARGET MUST ACTUALLY BE ABLE TO RUN A DRAWER ──────────────────────────────

    @Test
    @DisplayName("a manager cannot open a drawer for someone whose role here cannot run one")
    void targetMustHoldTillOpenAtThisBranch() {
        // A kitchen user: rostered here, but their role grants no till permission.
        when(authUserDirectoryClient.getUserPermissions(eq(otherCashierId), any(), any()))
                .thenReturn(new AuthUserDirectoryClient.ResolvedAuth(branchId, List.of("pos.kds.view")));
        asManager();

        assertThatThrownBy(() -> tillService.openTill(
                new OpenTillRequest(branchId, 500_000L, otherCashierId)))
                .isInstanceOf(PosExceptions.CashierNotEligibleForTillException.class)
                .hasMessageContaining("cannot be given a till at this branch");

        assertThat(tillsOf(otherCashierId)).isEmpty();
    }

    @Test
    @DisplayName("an unreachable staff directory refuses the open; it never assumes entitlement")
    void directoryOutageFailsClosed() {
        when(authUserDirectoryClient.getUserPermissions(any(), any(), any()))
                .thenThrow(new IllegalStateException("connection refused"));
        asManager();

        assertThatThrownBy(() -> tillService.openTill(
                new OpenTillRequest(branchId, 500_000L, cashierId)))
                .isInstanceOf(PosExceptions.CashierNotEligibleForTillException.class);

        assertThat(tillsOf(cashierId)).isEmpty();
    }

    // ── (4) ONE OPEN TILL PER CASHIER, KEYED ON THE TARGET ────────────────────────────────

    @Test
    @DisplayName("a second drawer for the same cashier is refused, and the refusal names THEM")
    void oneOpenTillPerCashierStillHolds() {
        asManager();
        tillService.openTill(new OpenTillRequest(branchId, 500_000L, cashierId));

        assertThatThrownBy(() -> tillService.openTill(
                new OpenTillRequest(branchId, 500_000L, cashierId)))
                .isInstanceOf(PosExceptions.TillAlreadyOpenException.class)
                // Before F11 the id in this message was the CALLER's. It must be the target's.
                .hasMessageContaining("Shift Cashier")
                .hasMessageNotContaining(managerId.toString());
    }

    @Test
    @DisplayName("the manager can still open their OWN drawer after opening the cashier's")
    void managersOwnDrawerIsIndependentOfTheOneTheyHandedOver() {
        asManager();
        tillService.openTill(new OpenTillRequest(branchId, 500_000L, cashierId));

        TillSessionDto mine = tillService.openTill(new OpenTillRequest(branchId, 200_000L));

        assertThat(mine.cashierId()).isEqualTo(managerId);
        assertThat(tillsOf(cashierId)).hasSize(1);
        assertThat(tillsOf(managerId)).hasSize(1);
    }

    // ── (5) THE PICKER ────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("the picker lists branch cashiers and says who is already holding a drawer")
    void eligibleCashierListMarksWhoAlreadyHasADrawer() {
        when(authUserDirectoryClient.listBranchStaff(eq(branchId), eq(OPEN_OWN), eq(tenantId)))
                .thenReturn(List.of(
                        new AuthUserDirectoryClient.BranchStaff(
                                cashierId, "shift.cashier@terrace.local", "Shift Cashier", "CASHIER"),
                        new AuthUserDirectoryClient.BranchStaff(
                                otherCashierId, "late.cashier@terrace.local", null, "CASHIER")));
        asManager();
        tillService.openTill(new OpenTillRequest(branchId, 500_000L, cashierId));

        List<EligibleCashierDto> people = tillService.listEligibleCashiers(branchId);

        assertThat(people).hasSize(2);
        EligibleCashierDto withDrawer = people.stream()
                .filter(p -> p.userId().equals(cashierId)).findFirst().orElseThrow();
        EligibleCashierDto without = people.stream()
                .filter(p -> p.userId().equals(otherCashierId)).findFirst().orElseThrow();

        assertThat(withDrawer.name()).isEqualTo("Shift Cashier");
        assertThat(withDrawer.hasOpenTill()).isTrue();
        // No full name on the account — the label falls back to the login address, never a blank,
        // which would render as an unselectable empty row.
        assertThat(without.name()).isEqualTo("late.cashier@terrace.local");
        assertThat(without.hasOpenTill()).isFalse();
    }

    @Test
    @DisplayName("an unreachable directory is an ERROR, never an empty picker")
    void pickerOutageIsNotAnEmptyList() {
        when(authUserDirectoryClient.listBranchStaff(any(), any(), any()))
                .thenThrow(new IllegalStateException("connection refused"));
        asManager();

        assertThatThrownBy(() -> tillService.listEligibleCashiers(branchId))
                .isInstanceOf(PosExceptions.CashierNotEligibleForTillException.class)
                .hasMessageContaining("not answering");
    }

    // ── helpers ───────────────────────────────────────────────────────────────────────────

    /** MANAGER: holds pos.till.open.other on top of the cashier's own-drawer permission. */
    private void asManager() {
        signIn(managerId, List.of("MANAGER"), List.of(OPEN_OWN, "pos.till.close", OPEN_OTHER));
    }

    /**
     * The OPEN tills belonging to {@code userId}, read by somebody entitled to read them.
     *
     * <p>Every assertion that goes through here is about WHOSE drawer exists, never about who may
     * look. Those are different questions and they now have different owners: {@code
     * TillServiceImpl.listTills} refuses a foreign {@code cashierId} outright unless the caller
     * holds {@code pos.till.review} (commit b8658971, landed AFTER this suite was written), and
     * {@code TillOwnershipGuardIT} is the file that proves that boundary — with a positive control,
     * a branch-scoped case and the {@code ?branchId=} bypass.
     *
     * <p>Before this helper, five tests here asked those questions while still signed in as
     * whoever had last acted — a cashier asking about the manager's drawer, a manager asking about
     * the cashier's — and every one of them died on the ownership guard instead of reaching its
     * own assertion. Reading through a reviewer restores the question each test was written to
     * ask, and weakens nothing: the guard is not this file's subject, and no assertion in this
     * file depends on the reader being refused.
     *
     * <p>A dedicated reviewer rather than handing {@code pos.till.review} to {@link #asManager()},
     * so that what the duty manager holds — and therefore what every {@code openTill} assertion
     * here is measured against — is left exactly as it was.
     */
    private List<TillSessionDto> tillsOf(UUID userId) {
        signIn(reviewerId, List.of("MANAGER"), List.of(OPEN_OWN, REVIEW));
        return tillService.listTills(userId, "OPEN");
    }

    /** CASHIER: holds pos.till.open and deliberately NOT pos.till.open.other. */
    private void asCashier() {
        signIn(cashierId, List.of("CASHIER"), List.of(OPEN_OWN, "pos.till.close"));
    }

    /**
     * Both halves of "who is asking", because production sets both: the gateway populates
     * {@link TenantContext} from the same validated JWT that becomes the security principal, and
     * {@code PosAuthorizationService.hasPermission} reads the principal while
     * {@code TillServiceImpl} reads the context. Setting only one would make the permission gate
     * and the caller identity disagree — which is the bug, not the test.
     */
    private void signIn(UUID userId, List<String> roles, List<String> permissions) {
        JwtClaims claims = new JwtClaims(userId, tenantId, branchId, roles, permissions,
                Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        tenantContext.set(tenantId, branchId, userId, null);
    }
}
