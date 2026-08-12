package io.restaurantos.finance;

import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.CreateJeRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.JournalEntryDto;
import io.restaurantos.finance.feign.PosInternalClient;
import io.restaurantos.finance.feign.PurchasingInternalClient;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Pins how a journal entry acquires its branch — the rule that made six accounting-integrity ITs
 * fail during setup with "Branch context required" before they could assert anything.
 *
 * <p>A journal entry is not inherently branch-scoped. Month-end accruals and corporate
 * adjustments belong to the tenant, and the design says so in three places:
 * {@code journal_entries.branch_id} is nullable directly beneath a {@code tenant_id NOT NULL},
 * {@code JournalEntry.branchId} has no {@code nullable = false}, and {@code CreateJeRequest
 * .branchId} carries no {@code @NotNull} while {@code entryDate} and {@code lines} do. Only the
 * service disagreed, demanding a session branch and making that nullable column unreachable.
 *
 * <p>Relaxing that must not cost the isolation guarantee, so the mismatch case is pinned here
 * too — otherwise a later "simplification" could quietly turn a branch-scoped session into one
 * that can post into a sibling branch.
 */
class JournalEntryBranchScopeIT extends FinanceTestBase {

    @MockitoBean private PosInternalClient posClient;
    @MockitoBean private PurchasingInternalClient purchasingClient;

    @Autowired private JournalEntryService jeService;
    @Autowired private ProvisioningService provisioningService;
    @Autowired private TenantContext tenantContext;
    @Autowired private JournalEntryRepository jeRepo;

    private UUID tenantId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        provisioningService.provision(tenantId, 2026);
    }

    private static List<CreateJeLineRequest> balancedLines() {
        return List.of(
                new CreateJeLineRequest("1010", "Cash in", 5000L, 0L),
                new CreateJeLineRequest("4100", "Revenue", 0L, 5000L));
    }

    // ── tenant-level entry: no branch anywhere ───────────────────────────────────────────────

    @Test
    void createWithNoBranchAnywhere_postsATenantLevelEntry() {
        tenantContext.set(tenantId, null, null, null);

        JournalEntryDto dto = jeService.create(new CreateJeRequest(
                LocalDate.of(2026, 6, 15), "Month-end accrual", null, "ADJUSTMENT", null,
                balancedLines()));

        assertThat(jeRepo.findById(dto.id()).orElseThrow().getBranchId())
                .as("a tenant-level posting must persist with no branch, not be rejected")
                .isNull();
    }

    // ── branch-scoped session: the session's branch is recorded ──────────────────────────────

    @Test
    void createWithinABranchSession_recordsThatBranch() {
        UUID branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        JournalEntryDto dto = jeService.create(new CreateJeRequest(
                LocalDate.of(2026, 6, 15), "Branch sale", null, "POS", null,
                balancedLines()));

        assertThat(jeRepo.findById(dto.id()).orElseThrow().getBranchId()).isEqualTo(branchId);
    }

    // ── isolation: still fail-closed in both directions ──────────────────────────────────────

    @Test
    void createNamingADifferentBranchThanTheSession_isRejected() {
        UUID sessionBranch = UUID.randomUUID();
        UUID foreignBranch = UUID.randomUUID();
        tenantContext.set(tenantId, sessionBranch, null, null);

        assertThatThrownBy(() -> jeService.create(new CreateJeRequest(
                LocalDate.of(2026, 6, 15), "Posting into a sibling branch", foreignBranch,
                "POS", null, balancedLines())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Branch mismatch");
    }

    @Test
    void createNamingABranchWithNoBranchSession_isRejected() {
        // Allowing a tenant-level session to name any branch would be a widening of scope, not a
        // tenant-level posting. Fail closed — the interactive path may only record the branch the
        // session already holds.
        tenantContext.set(tenantId, null, null, null);

        assertThatThrownBy(() -> jeService.create(new CreateJeRequest(
                LocalDate.of(2026, 6, 15), "Naming a branch from a tenant session",
                UUID.randomUUID(), "POS", null, balancedLines())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Branch mismatch");
    }

    // ── listings: a branch sees its own entries AND tenant-level ones ────────────────────────

    @Test
    void branchListings_includeTenantLevelEntriesAndExcludeOtherBranches() {
        UUID myBranch = UUID.randomUUID();
        UUID otherBranch = UUID.randomUUID();
        LocalDate date = LocalDate.of(2026, 6, 15);

        // A tenant-level accrual...
        tenantContext.set(tenantId, null, null, null);
        UUID tenantLevelJe = jeService.create(new CreateJeRequest(
                date, "Month-end accrual", null, "ADJUSTMENT", null, balancedLines())).id();

        // ...a sibling branch's entry, which must NOT leak...
        tenantContext.set(tenantId, otherBranch, null, null);
        UUID otherBranchJe = jeService.create(new CreateJeRequest(
                date, "Other branch sale", null, "POS", null, balancedLines())).id();

        // ...and my own.
        tenantContext.set(tenantId, myBranch, null, null);
        UUID myJe = jeService.create(new CreateJeRequest(
                date, "My branch sale", null, "POS", null, balancedLines())).id();

        UUID periodId = jeRepo.findById(myJe).orElseThrow().getPeriod().getId();

        var byPeriod = jeService.listByPeriod(periodId, PageRequest.of(0, 50))
                .map(JournalEntryDto::id).getContent();
        assertThat(byPeriod)
                .as("a branch ledger must include tenant-level postings — omitting allocated "
                    + "adjustments misstates the branch")
                .contains(myJe, tenantLevelJe)
                .doesNotContain(otherBranchJe);

        var byDate = jeService.listByDateRange(date, date, PageRequest.of(0, 50))
                .map(JournalEntryDto::id).getContent();
        assertThat(byDate).contains(myJe, tenantLevelJe).doesNotContain(otherBranchJe);
    }

    @Test
    void listingWithoutABranchSession_remainsRejected() {
        // No interactive user is branch-less (PermissionResolver always resolves a branch), so a
        // null branch here means a service-to-service context. Fail closed rather than silently
        // promoting it to a tenant-wide view of the ledger.
        tenantContext.set(tenantId, null, null, null);

        assertThatThrownBy(() -> jeService.listByPeriod(UUID.randomUUID(), PageRequest.of(0, 50)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Branch context required");
    }

    // ── internal service-to-service path: the caller names the branch ────────────────────────

    @Test
    void internalAutoPost_trustsTheBranchSuppliedByTheCallingService() {
        // InternalFinanceController activates a TENANT-ONLY context from the X-Tenant-Id header,
        // so there is deliberately no session branch to match against. POS is the authority on
        // which branch its sale belongs to, so its branch must be recorded, not rejected.
        UUID branchId = UUID.randomUUID();
        tenantContext.set(tenantId, null, null, null);

        var response = jeService.autoPostInternal(new InternalAutoPostJeRequest(
                branchId, LocalDate.of(2026, 6, 15), "POS sale", "ORDER", UUID.randomUUID(),
                balancedLines()));

        assertThat(jeRepo.findById(response.jeId()).orElseThrow().getBranchId())
                .as("the internal path must record the calling service's branch")
                .isEqualTo(branchId);
    }
}
