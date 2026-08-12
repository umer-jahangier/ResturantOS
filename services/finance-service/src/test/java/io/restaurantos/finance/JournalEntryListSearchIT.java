package io.restaurantos.finance;

import io.restaurantos.finance.dto.CreateJeLineRequest;
import io.restaurantos.finance.dto.InternalAutoPostJeRequest;
import io.restaurantos.finance.dto.InternalJePostResponse;
import io.restaurantos.finance.dto.JournalEntryDto;
import io.restaurantos.finance.feign.PosInternalClient;
import io.restaurantos.finance.feign.PurchasingInternalClient;
import io.restaurantos.finance.service.JournalEntryService;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * F10 — can an owner FIND the journal entry for one order on /app/finance/journal-entries?
 *
 * <h2>The two failures this guards against</h2>
 *
 * <p><b>1. The page showed an arbitrary 50 rows.</b> {@code JournalEntryController} lists with
 * {@code @PageableDefault(size = 50)}, which carries no {@code Sort}, and every repository read
 * behind it therefore ran without an {@code ORDER BY}. Measured on the live dev database: the
 * Floating Terrace branch had 254 entries inside the default one-month window, page 1 ended at
 * {@code JE-2027-000065}, and the newest entry was {@code JE-2027-000256}. An owner who settled a
 * check and opened the ledger could not see the entry it had just posted — and no amount of paging
 * would have found it, because {@code LIMIT}/{@code OFFSET} without {@code ORDER BY} is free to
 * repeat and skip rows between pages.
 *
 * <p><b>2. There was no way to ask for one entry.</b> The list took a period and a date range —
 * neither of which an accountant holding a printed bill has. They have an order number.
 *
 * <p>Both are asserted at the service layer, which is the layer the controller delegates to and the
 * layer where the missing sort lived. Entries are created through the REAL auto-posting seam so the
 * {@code source_type} vocabulary and the entry-number sequence are production ones.
 */
class JournalEntryListSearchIT extends FinanceTestBase {

    @Autowired private JournalEntryService jeService;
    @Autowired private ProvisioningService provisioningService;
    @Autowired private TenantContext tenantContext;

    @MockitoBean private PosInternalClient posClient;
    @MockitoBean private PurchasingInternalClient purchasingClient;

    private UUID tenantId;
    private UUID branchId;

    /** Inside the list's default one-month window, so the ordering test exercises the real path. */
    private static final LocalDate TODAY = LocalDate.now();
    private static final LocalDate LAST_WEEK = TODAY.minusDays(7);

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        when(posClient.getOpenOrderCount(any(), any())).thenReturn(0L);
        when(purchasingClient.getPendingGrnCount(any(), any())).thenReturn(0L);
        when(purchasingClient.getUnmatchedInvoiceCount(any())).thenReturn(0L);

        // Both fiscal years: the "search reaches past the list's window" test posts three months
        // back, which crosses the Jul–Jun boundary for a third of the calendar year. Provisioning
        // one year would make that test pass or fail on the date it happened to run.
        int fy = io.restaurantos.finance.util.PakistanFiscalYear.current();
        provisioningService.provision(tenantId, fy - 1);
        provisioningService.provision(tenantId, fy);
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
    }

    // ── The newest entry must be on the FIRST page ────────────────────────────────────────────
    /**
     * The exact shape of the live failure: more entries than fit on one page, and the one the user
     * just created is the one they came to see.
     *
     * <p>Without the sort this fails on the live data shape it was written from — 254 rows, 50 per
     * page — and it fails here too, because Postgres is under no obligation to hand back the newest
     * row first and, on a heap with no ORDER BY, does not.
     */
    @Test
    void theEntryJustPosted_isOnTheFirstPage_evenWhenThePageIsFull() {
        // Fill more than one page with older entries, then post today's.
        for (int i = 0; i < 55; i++) {
            autoPost(LAST_WEEK, "ORDER_REVENUE", UUID.randomUUID(), "Order revenue ORD-20260805-" + i);
        }
        UUID newestOrder = UUID.randomUUID();
        autoPost(TODAY, "ORDER_REVENUE", newestOrder, "Order revenue ORD-20260812-0164");

        Page<JournalEntryDto> firstPage = jeService.listByDateRange(
                TODAY.minusMonths(1), TODAY, PageRequest.of(0, 50));

        assertThat(firstPage.getContent()).hasSize(50);
        assertThat(firstPage.getContent().get(0).description())
                .as("the entry an owner just produced must be the first thing they see — page 1 of "
                        + "an unsorted read ended 190 entries short of it on live data")
                .isEqualTo("Order revenue ORD-20260812-0164");
    }

    /** Two identical reads must return the same page. An unsorted LIMIT/OFFSET need not. */
    @Test
    void pagingIsStable_soTheSameReadTwiceGivesTheSamePage() {
        for (int i = 0; i < 60; i++) {
            autoPost(LAST_WEEK, "ORDER_REVENUE", UUID.randomUUID(), "Order revenue ORD-X-" + i);
        }

        List<String> page2a = jeService.listByDateRange(TODAY.minusMonths(1), TODAY, PageRequest.of(1, 25))
                .getContent().stream().map(JournalEntryDto::entryNo).toList();
        List<String> page2b = jeService.listByDateRange(TODAY.minusMonths(1), TODAY, PageRequest.of(1, 25))
                .getContent().stream().map(JournalEntryDto::entryNo).toList();

        assertThat(page2a).isEqualTo(page2b);
        assertThat(page2a).hasSize(25);
    }

    // ── Search by order number ───────────────────────────────────────────────────────────────
    @Test
    void searchingForAnOrderNumber_findsExactlyThatEntry() {
        autoPost(TODAY, "ORDER_REVENUE", UUID.randomUUID(), "Order revenue ORD-20260812-0164");
        autoPost(TODAY, "ORDER_REVENUE", UUID.randomUUID(), "Order revenue ORD-20260812-0165");
        autoPost(TODAY, "STOCK_RECEIPT", UUID.randomUUID(), "Stock receipt from Karachi Foods");

        Page<JournalEntryDto> hits = jeService.search("ORD-20260812-0164", PageRequest.of(0, 50));

        assertThat(hits.getContent()).hasSize(1);
        assertThat(hits.getContent().get(0).description()).isEqualTo("Order revenue ORD-20260812-0164");
    }

    /** A partial, differently-cased term still finds it — nobody types an order number exactly. */
    @Test
    void searchIsCaseInsensitiveAndMatchesPartOfTheDescription() {
        autoPost(TODAY, "ORDER_REVENUE", UUID.randomUUID(), "Order revenue ORD-20260812-0164");

        assertThat(jeService.search("ord-20260812", PageRequest.of(0, 50)).getContent()).hasSize(1);
        assertThat(jeService.search("0164", PageRequest.of(0, 50)).getContent()).hasSize(1);
    }

    /** The entry number is the other handle a human holds. */
    @Test
    void searchAlsoMatchesTheEntryNumber() {
        JournalEntryDto posted = autoPost(TODAY, "ORDER_REVENUE", UUID.randomUUID(),
                "Order revenue ORD-20260812-0166");

        Page<JournalEntryDto> hits = jeService.search(posted.entryNo(), PageRequest.of(0, 50));

        assertThat(hits.getContent()).extracting(JournalEntryDto::entryNo).contains(posted.entryNo());
    }

    /**
     * The list read defaults to the last month. A search must NOT inherit that, or it answers
     * "no such entry" about an entry that exists — the worst answer a ledger can give.
     */
    @Test
    void searchReachesEntriesOlderThanTheListsDefaultWindow() {
        LocalDate longAgo = TODAY.minusMonths(3);
        autoPost(longAgo, "ORDER_REVENUE", UUID.randomUUID(), "Order revenue ORD-20260501-0009");

        assertThat(jeService.listByDateRange(TODAY.minusMonths(1), TODAY, PageRequest.of(0, 50))
                .getContent())
                .as("precondition: the entry is outside the list's default window")
                .noneMatch(e -> "Order revenue ORD-20260501-0009".equals(e.description()));

        assertThat(jeService.search("ORD-20260501-0009", PageRequest.of(0, 50)).getContent())
                .hasSize(1);
    }

    /** A term that matches nothing is an empty page, not an error and not the whole ledger. */
    @Test
    void aTermThatMatchesNothing_returnsAnEmptyPage() {
        autoPost(TODAY, "ORDER_REVENUE", UUID.randomUUID(), "Order revenue ORD-20260812-0164");

        assertThat(jeService.search("ORD-19990101-0001", PageRequest.of(0, 50)).getContent()).isEmpty();
    }

    /**
     * A {@code %} typed by a user is text, not a wildcard. If the term were concatenated into the
     * JPQL this would match everything.
     */
    @Test
    void wildcardCharactersInTheTermAreTreatedAsText() {
        autoPost(TODAY, "ORDER_REVENUE", UUID.randomUUID(), "Order revenue ORD-20260812-0164");

        assertThat(jeService.search("%", PageRequest.of(0, 50)).getContent()).isEmpty();
    }

    /** Another branch's entries are not this branch's search results. */
    @Test
    void searchIsScopedToTheCallersBranch() {
        UUID otherBranch = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        // Posted while genuinely scoped to the other branch — autoPostInternal refuses a branch
        // that disagrees with the session, which is itself the guard being relied on here.
        tenantContext.set(tenantId, otherBranch, userId, null);
        jeService.autoPostInternal(new InternalAutoPostJeRequest(
                otherBranch, TODAY, "Order revenue ORD-OTHERBRANCH-0001", "ORDER_REVENUE",
                UUID.randomUUID(),
                List.of(new CreateJeLineRequest("1010", "x", 1_000L, 0L),
                        new CreateJeLineRequest("4100", "x", 0L, 1_000L))));
        tenantContext.set(tenantId, branchId, userId, null);

        assertThat(jeService.search("ORD-OTHERBRANCH-0001", PageRequest.of(0, 50)).getContent())
                .isEmpty();
    }

    // ── Helper ───────────────────────────────────────────────────────────────────────────────

    /** Posts through the REAL auto-posting seam, so the entry-number sequence is the production one. */
    private JournalEntryDto autoPost(LocalDate date, String sourceType, UUID sourceId, String description) {
        InternalJePostResponse posted = jeService.autoPostInternal(new InternalAutoPostJeRequest(
                branchId, date, description, sourceType, sourceId,
                List.of(new CreateJeLineRequest("1010", description, 10_000L, 0L),
                        new CreateJeLineRequest("4100", description, 0L, 10_000L))));
        return jeService.getById(posted.jeId());
    }
}
