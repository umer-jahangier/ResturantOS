package io.restaurantos.finance.autopost;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.finance.FinanceServiceApplication;
import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.finance.util.PakistanFiscalYear;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.payload.PosEventContract;
import io.restaurantos.shared.time.BusinessDay;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * The discount half of the ORDER_CLOSED revenue recipe, asserted on the PERSISTED journal entry.
 *
 * <p><b>The defect.</b> The recipe debited the discount to 4920 as contra-revenue AND credited
 * revenue NET of the same discount, booking it twice on opposite sides. Debits came to
 * {@code subtotal + tax + serviceCharge} while credits came to
 * {@code subtotal - discount + tax + serviceCharge} — short by exactly {@code discountPaisa}. The
 * deferred {@code JE_UNBALANCED} trigger rejected the entry at COMMIT, so no discounted order had
 * ever posted revenue to the ledger. Not a wrong number: no entry at all.
 *
 * <p>These assertions are deliberately made against {@code journal_lines} as read back from
 * Postgres rather than against the builder's {@code CreateJeLineRequest} list. A builder-level test
 * cannot observe the failure at all — the lines it produces look perfectly reasonable, and the
 * trigger that rejects them only fires at commit. That is precisely how this survived a green suite.
 *
 * @see OrderCloseAutoPostingIT for the undiscounted path, which this does not change
 */
@SpringBootTest(classes = FinanceServiceApplication.class)
class DiscountedOrderRevenuePostingIT extends AutoPostingITBase {

    /** Seeded by {@code PakistanRestaurantCoaTemplate}; resolved in the recipe by system tag. */
    private static final String CASH = "1010";
    private static final String OUTPUT_TAX = "2200";
    private static final String REVENUE = "4100";
    private static final String SERVICE_CHARGE = "4910";
    private static final String DISCOUNT = "4920";

    @MockitoBean
    private io.restaurantos.shared.idempotency.IdempotencyKeyRepository idempotencyKeyRepository;

    @MockitoBean
    private io.restaurantos.shared.event.OutboxRepository outboxRepository;

    @Autowired private ProvisioningService provisioningService;
    @Autowired private InternalTenantContextHelper tenantHelper;
    @Autowired private JournalEntryRepository jeRepo;
    @Autowired private PlatformTransactionManager txManager;
    @Autowired private RabbitTemplate rabbitTemplate;
    @Autowired private ObjectMapper objectMapper;

    private UUID tenantId;
    private UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantHelper.activate(tenantId);
        try {
            provisioningService.provision(tenantId, PakistanFiscalYear.current());
        } finally {
            tenantHelper.clear();
        }
    }

    /**
     * A discounted order must reach the ledger, balanced, with revenue at GROSS.
     *
     * <p>Rs 800 subtotal, Rs 120 discount, Rs 40 service charge, Rs 56 tax. The contract puts the
     * tender at {@code 80000 - 12000 + 5600 + 4000 = 77600}, and both sides of the entry come to
     * {@code subtotal + tax + serviceCharge = 89600}.
     */
    // GUIDE-CLAIM: FIN-GUIDE-0003 — "A discount lowers what the customer pays, not what your
    // books call sales." Together with fullComp_creditsGrossRevenueWhileTheTenderCoversOnlyTax
    // AndServiceCharge below, this is the assertion the finance guide's discount section rests
    // on. See frontend/lib/finance/guide/claims.json and `make verify-guide-claims`.
    @Test
    void discountedOrder_postsBalancedEntryThatReachesTheLedger() throws Exception {
        UUID orderId = UUID.randomUUID();
        publishOrderClosed(orderId, 80_000L, 12_000L, 4_000L, 5_600L);

        Map<String, long[]> lines = awaitPostedRevenueLines(orderId, "discounted");

        // Gross revenue — NOT 68000, which is what netting produced and what unbalanced the entry.
        assertThat(lines.get(REVENUE))
                .as("revenue is credited GROSS because the discount is already debited to 4920")
                .containsExactly(0L, 80_000L);
        assertThat(lines.get(DISCOUNT))
                .as("contra-revenue debit for the discount given")
                .containsExactly(12_000L, 0L);
        assertThat(lines.get(CASH))
                .as("the tender, which the contract fixes at subtotal - discount + tax + sc")
                .containsExactly(77_600L, 0L);
        assertThat(lines.get(SERVICE_CHARGE)).containsExactly(0L, 4_000L);
        assertThat(lines.get(OUTPUT_TAX)).containsExactly(0L, 5_600L);

        assertTotals(lines, 89_600L);
    }

    /**
     * The undiscounted path must be untouched, line for line.
     *
     * <p>At {@code discount == 0} the old {@code subtotal - discount} and the new gross
     * {@code subtotal} are the same number, and no 4920 line is emitted either way. This pins that:
     * the change can only affect orders that previously failed outright.
     */
    @Test
    void undiscountedOrder_isUnchanged() throws Exception {
        UUID orderId = UUID.randomUUID();
        publishOrderClosed(orderId, 80_000L, 0L, 4_000L, 5_600L);

        Map<String, long[]> lines = awaitPostedRevenueLines(orderId, "undiscounted");

        assertThat(lines).doesNotContainKey(DISCOUNT);
        assertThat(lines.keySet())
                .as("exactly the four lines an undiscounted order has always produced")
                .containsExactlyInAnyOrder(CASH, REVENUE, SERVICE_CHARGE, OUTPUT_TAX);
        assertThat(lines.get(REVENUE)).containsExactly(0L, 80_000L);
        assertThat(lines.get(CASH)).containsExactly(89_600L, 0L);
        assertThat(lines.get(SERVICE_CHARGE)).containsExactly(0L, 4_000L);
        assertThat(lines.get(OUTPUT_TAX)).containsExactly(0L, 5_600L);

        assertTotals(lines, 89_600L);
    }

    /**
     * A 100% comp: the discount equals the whole subtotal, so the guest pays only tax and service
     * charge and revenue is still recognised gross.
     *
     * <p>The worst case for the old code — net revenue came to zero, so the {@code netRevenue > 0}
     * guard dropped the revenue credit entirely and the entry was short by the FULL subtotal.
     */
    @Test
    void fullComp_creditsGrossRevenueWhileTheTenderCoversOnlyTaxAndServiceCharge() throws Exception {
        UUID orderId = UUID.randomUUID();
        publishOrderClosed(orderId, 80_000L, 80_000L, 4_000L, 5_600L);

        Map<String, long[]> lines = awaitPostedRevenueLines(orderId, "100% comp");

        assertThat(lines.get(REVENUE))
                .as("a comped meal is still revenue earned; the discount is what offsets it")
                .containsExactly(0L, 80_000L);
        assertThat(lines.get(DISCOUNT)).containsExactly(80_000L, 0L);
        assertThat(lines.get(CASH))
                .as("tax + service charge only — the food itself was free")
                .containsExactly(9_600L, 0L);

        assertTotals(lines, 89_600L);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** Asserts the entry balances, and that it balances at the expected figure. */
    private void assertTotals(Map<String, long[]> lines, long expected) {
        long debits = lines.values().stream().mapToLong(dc -> dc[0]).sum();
        long credits = lines.values().stream().mapToLong(dc -> dc[1]).sum();
        assertThat(debits).as("debits must equal credits").isEqualTo(credits);
        assertThat(debits).isEqualTo(expected);
    }

    /**
     * Waits for the revenue entry to be POSTED, then reads its lines back out of Postgres keyed by
     * account code as {@code [debit, credit]}.
     *
     * <p>The status assertion matters as much as the amounts: an entry that exists but never
     * reached POSTED is exactly what the unbalanced version produced.
     */
    private Map<String, long[]> awaitPostedRevenueLines(UUID orderId, String label) {
        await().atMost(20, SECONDS).untilAsserted(() -> {
            tenantHelper.activate(tenantId);
            try {
                assertThat(jeRepo.findByTenantIdAndSourceTypeAndSourceId(
                        tenantId, AutoPostingRecipeEngine.SOURCE_ORDER_REVENUE, orderId))
                        .as("no journal entry ever reached the ledger for this order")
                        .isPresent();
            } finally {
                tenantHelper.clear();
            }
        });

        tenantHelper.activate(tenantId);
        try {
            UUID jeId = jeRepo.findByTenantIdAndSourceTypeAndSourceId(
                    tenantId, AutoPostingRecipeEngine.SOURCE_ORDER_REVENUE, orderId).orElseThrow().getId();

            // journal_entries.lines is LAZY — read inside a transaction, not off a detached entity.
            Map<String, long[]> byAccount = new TransactionTemplate(txManager).execute(status -> {
                var entry = jeRepo.findById(jeId).orElseThrow();
                assertThat(entry.getStatus())
                        .as("an entry that never reached POSTED is what JE_UNBALANCED produces")
                        .isEqualTo(JeStatus.POSTED);
                Map<String, long[]> acc = new LinkedHashMap<>();
                entry.getLines().forEach(l -> acc.merge(
                        l.getAccountCode(),
                        new long[]{l.getDebitPaisa(), l.getCreditPaisa()},
                        (a, b) -> new long[]{a[0] + b[0], a[1] + b[1]}));
                return acc;
            });

            long debits = byAccount.values().stream().mapToLong(dc -> dc[0]).sum();
            long credits = byAccount.values().stream().mapToLong(dc -> dc[1]).sum();
            System.out.printf("[UAT] %-12s je=%s PERSISTED debits=%d credits=%d delta=%d%n",
                    label, jeId, debits, credits, debits - credits);
            byAccount.forEach((code, dc) ->
                    System.out.printf("[UAT]   %s DR=%-7d CR=%-7d%n", code, dc[0], dc[1]));
            return byAccount;
        } finally {
            tenantHelper.clear();
        }
    }

    /**
     * Built to the contract's money invariant:
     * {@code total == subtotal - discount + tax + serviceCharge} and
     * {@code sum(payments[].amountPaisa) == total}.
     */
    private void publishOrderClosed(UUID orderId, long subtotal, long discount,
                                    long serviceCharge, long tax) throws Exception {
        long total = subtotal - discount + tax + serviceCharge;

        EventEnvelope<Object> envelope = new EventEnvelope<>(
                UUID.randomUUID(), PosEventContract.ORDER_CLOSED, tenantId, branchId, Instant.now(),
                UUID.randomUUID(), 1, "pos-service",
                new PosEventContract.OrderClosedPayload(
                        orderId, "ORD-" + orderId, "DINE_IN", null,
                        subtotal, discount, serviceCharge, tax, total,
                        List.of(new PosEventContract.PaymentEntry("CASH", total, total, 0L, null)),
                        List.of(new PosEventContract.ItemEntry(
                                UUID.randomUUID(), "Nihari", 1, subtotal, subtotal)),
                        // BusinessDay lost its UTC-assuming of(Instant) overload; UTC is what this
                        // fixture used to pass, so its meaning is unchanged.
                        null, null, Instant.now(),
                        BusinessDay.of(Instant.now(), java.time.ZoneOffset.UTC)));

        rabbitTemplate.send("pos.topic", PosEventContract.ORDER_CLOSED_KEY,
                new org.springframework.amqp.core.Message(objectMapper.writeValueAsBytes(envelope)));
    }
}
