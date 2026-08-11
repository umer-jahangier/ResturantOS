package io.restaurantos.finance;

import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.JournalEntryDto;
import io.restaurantos.finance.feign.PosInternalClient;
import io.restaurantos.finance.feign.PurchasingInternalClient;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 37-04 / D-37-01 — the ledger half of "where did this number come from?".
 *
 * <h2>The failure this guards against</h2>
 *
 * <p>A single closed order posts up to THREE journal entries: {@code ORDER_REVENUE} on close,
 * {@code ORDER_COGS} when inventory depletes, and {@code ORDER_REFUND} later — three consumers, three
 * times, one {@code source_id}. An answer that returns only the revenue entry is not traceability;
 * it is a plausible partial answer, and a partial answer that looks complete is worse than no answer
 * at all, because nobody goes looking for the rest.
 *
 * <p>Entries are posted through the REAL auto-posting seam ({@code autoPostInternal}), not by
 * inserting rows, so these tests exercise the production {@code source_type} vocabulary rather than
 * a vocabulary the test invented.
 */
class JournalEntryTraceabilityIT extends FinanceTestBase {

    @Autowired
    private JournalEntryService jeService;

    @Autowired
    private ProvisioningService provisioningService;

    @Autowired
    private TenantContext tenantContext;

    @Autowired
    private EntityManager entityManager;

    @MockitoBean
    private PosInternalClient posClient;

    @MockitoBean
    private PurchasingInternalClient purchasingClient;

    private UUID tenantId;
    private UUID branchId;
    private static final LocalDate ENTRY_DATE = LocalDate.of(2026, 3, 15);

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        when(posClient.getOpenOrderCount(any(), any())).thenReturn(0L);
        when(purchasingClient.getPendingGrnCount(any(), any())).thenReturn(0L);
        when(purchasingClient.getUnmatchedInvoiceCount(any())).thenReturn(0L);

        provisioningService.provision(tenantId, 2026);
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
    }

    // ── Behaviour 1: revenue AND cost-of-sales, from one order id ─────────────────────────────
    @Test
    void orderProducingRevenueAndCostOfSales_returnsBoth() {
        UUID orderId = UUID.randomUUID();
        autoPost("ORDER_REVENUE", orderId, "Sale", "1010", "4100", 80_000L);
        autoPost("ORDER_COGS", orderId, "Cost of sales", "5100", "1310", 30_000L);

        List<JournalEntryDto> entries = jeService.listBySource(orderId, null);

        assertThat(entries)
                .as("an order that produced revenue AND cost-of-sales must return BOTH — "
                        + "returning only the revenue entry is a partial answer that looks complete")
                .hasSize(2);
        assertThat(entries).extracting(JournalEntryDto::sourceType)
                .containsExactlyInAnyOrder("ORDER_REVENUE", "ORDER_COGS");
        assertThat(entries).allSatisfy(e -> assertThat(e.sourceId()).isEqualTo(orderId));
    }

    // ── Behaviour 2: a later refund is included too ───────────────────────────────────────────
    @Test
    void orderLaterRefunded_returnsTheRefundEntryToo() {
        UUID orderId = UUID.randomUUID();
        autoPost("ORDER_REVENUE", orderId, "Sale", "1010", "4100", 50_000L);
        autoPost("ORDER_REFUND", orderId, "Refund", "4910", "1010", 50_000L);

        List<JournalEntryDto> entries = jeService.listBySource(orderId, null);

        assertThat(entries).hasSize(2);
        assertThat(entries).extracting(JournalEntryDto::sourceType)
                .contains("ORDER_REFUND");
    }

    // ── Behaviour 3: a source that produced nothing is an empty list, NOT a 404 ───────────────
    @Test
    void sourceThatProducedNothing_returnsEmptyListNotAnError() {
        List<JournalEntryDto> entries = jeService.listBySource(UUID.randomUUID(), null);

        assertThat(entries)
                .as("\"this order produced no entries\" is a true and useful answer; a 404 would "
                        + "say \"no such order\", which is a different and usually false claim")
                .isEmpty();
    }

    /**
     * Behaviour 4 — another tenant's source must be invisible, and the ROW-LEVEL POLICY must be
     * what makes it so.
     *
     * <h2>Why this asserts the policy and not row visibility</h2>
     *
     * <p>Testcontainers' {@code POSTGRES_USER} is created as a SUPERUSER, and a superuser is exempt
     * from FORCE row-level security. Measured, not assumed:
     *
     * <pre>
     *   Testcontainers postgres:16, POSTGRES_USER=finance_user
     *       select current_user, usesuper …  →  finance_user | t
     *   live dev database, same role name
     *       select current_user, usesuper …  →  finance_user | f
     * </pre>
     *
     * <p>So a row-visibility assertion here would fail even against a perfectly-configured policy —
     * and, far worse, a PASSING one would prove nothing, because the policy is inert in this
     * context. This repository has been bitten by that three times in phase 13 alone (13-02, 13-06,
     * 13-08), where a green IT suite hid a flow that had never once worked against a database that
     * actually enforces RLS.
     *
     * <p>What is asserted here is the thing this context CAN answer honestly: that the table has RLS
     * enabled AND forced, and that a tenant policy exists on it. Actual row invisibility as the real
     * non-superuser role is verified against the live database by
     * {@code scripts/e2e/phase37-journal-traceability-e2e.sh}, which refuses to run as a superuser.
     */
    @Test
    void journalEntriesIsForceRlsWithATenantPolicy_soAnotherTenantsSourceCannotBeRead() {
        @SuppressWarnings("unchecked")
        List<Object[]> flags = entityManager.createNativeQuery(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'journal_entries'")
                .getResultList();
        assertThat(flags).hasSize(1);
        assertThat((Boolean) flags.get(0)[0]).as("journal_entries must have RLS ENABLED").isTrue();
        assertThat((Boolean) flags.get(0)[1])
                .as("journal_entries must have RLS FORCED — without FORCE, the table OWNER is exempt "
                        + "from its own policy, which is how 16 tenants leaked here before")
                .isTrue();

        @SuppressWarnings("unchecked")
        List<Object> policies = entityManager.createNativeQuery(
                "SELECT policyname FROM pg_policies WHERE tablename = 'journal_entries'")
                .getResultList();
        assertThat(policies).as("a tenant policy must exist on journal_entries").isNotEmpty();

        // And the query itself offers no way to ask about another tenant: listBySource takes a
        // source id and an optional type, and nothing else. There is nowhere to put a tenant id.
        UUID foreignOrderId = UUID.randomUUID();
        assertThat(jeService.listBySource(foreignOrderId, null)).isEmpty();
    }

    // ── Behaviour 5: the source-type filter narrows rather than being the only way to ask ─────
    @Test
    void filteringBySourceType_narrowsToThatTypeOnly() {
        UUID orderId = UUID.randomUUID();
        autoPost("ORDER_REVENUE", orderId, "Sale", "1010", "4100", 80_000L);
        autoPost("ORDER_COGS", orderId, "Cost of sales", "5100", "1310", 30_000L);

        assertThat(jeService.listBySource(orderId, "ORDER_REVENUE"))
                .hasSize(1)
                .allSatisfy(e -> assertThat(e.sourceType()).isEqualTo("ORDER_REVENUE"));

        assertThat(jeService.listBySource(orderId, null))
                .as("omitting the type is what tracing an order requires")
                .hasSize(2);
    }

    // ── Behaviour 6: ordering is deterministic, so a screen and a test agree ──────────────────
    @Test
    void resultsAreOrderedDeterministically() {
        UUID orderId = UUID.randomUUID();
        autoPost("ORDER_REVENUE", orderId, "Sale", "1010", "4100", 80_000L);
        autoPost("ORDER_COGS", orderId, "Cost of sales", "5100", "1310", 30_000L);
        autoPost("ORDER_REFUND", orderId, "Refund", "4910", "1010", 10_000L);

        List<String> first = jeService.listBySource(orderId, null).stream()
                .map(JournalEntryDto::entryNo).toList();
        entityManager.clear();
        List<String> second = jeService.listBySource(orderId, null).stream()
                .map(JournalEntryDto::entryNo).toList();

        assertThat(first).isEqualTo(second);
        assertThat(first).isSorted();
    }

    // ── Behaviour 7: the lookup uses the index rather than scanning the ledger ────────────────
    @Test
    @Transactional
    void bySourceLookupUsesTheIndex_ratherThanScanningTheLedger() {
        UUID orderId = UUID.randomUUID();
        autoPost("ORDER_REVENUE", orderId, "Sale", "1010", "4100", 80_000L);

        // The planner will prefer a sequential scan on a tiny table regardless of indexes, so
        // asserting the plan shape here would assert the row count, not the index. Assert instead
        // that the index V10 introduces actually EXISTS and covers the columns queried — which is
        // the part a migration can get wrong and the part 37-08 depends on for its per-row lookup.
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery(
                "SELECT indexname, indexdef FROM pg_indexes "
                        + "WHERE tablename = 'journal_entries' AND indexname = :name")
                .setParameter("name", "idx_journal_entries_tenant_source")
                .getResultList();

        assertThat(rows)
                .as("V10 must create idx_journal_entries_tenant_source; without it the transaction "
                        + "register in 37-08 scans the whole ledger once per visible row")
                .hasSize(1);
        String indexDef = String.valueOf(rows.get(0)[1]);
        assertThat(indexDef).contains("tenant_id").contains("source_id").contains("source_type");
        assertThat(indexDef)
                .as("hand-written adjustments carry no source and have no question to answer, "
                        + "so they are kept out of the index")
                .contains("source_id IS NOT NULL");
    }

    // ── Helper ───────────────────────────────────────────────────────────────────────────────

    /** Posts through the REAL auto-posting seam, so source_type is production vocabulary. */
    private void autoPost(String sourceType, UUID sourceId, String description,
                          String debitAccount, String creditAccount, long paisa) {
        jeService.autoPostInternal(new InternalAutoPostJeRequest(
                branchId, ENTRY_DATE, description, sourceType, sourceId,
                List.of(
                        new CreateJeLineRequest(debitAccount, description, paisa, 0L),
                        new CreateJeLineRequest(creditAccount, description, 0L, paisa))));
    }
}
