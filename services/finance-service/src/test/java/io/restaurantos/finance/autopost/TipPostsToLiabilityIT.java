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
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * A tip reaches the ledger as a LIABILITY, and never as sales (F20).
 *
 * <h2>What this exists to prevent</h2>
 *
 * <p>pos-service can now take a tip on a tender. The money is physically in the drawer or on the
 * card slip, so it has to be debited to the tender's account; but it is the STAFF's money that the
 * restaurant is holding, so crediting it to 4100 alongside the sale would overstate income and
 * levy income tax on money the business never earned. Two failure modes are equally bad and both
 * are asserted against here:
 *
 * <ul>
 *   <li>debit the tender WITHOUT the matching credit — the entry is short by exactly the tip, the
 *       deferred {@code JE_UNBALANCED} trigger rejects it at COMMIT, and the message requeues
 *       forever. That is the shape {@code DiscountedOrderRevenuePostingIT} documents for
 *       discounts;</li>
 *   <li>fold the tip into {@code amountPaisa} upstream — the entry balances and the ledger is
 *       silently wrong, which is worse.</li>
 * </ul>
 *
 * <h2>Falsification — how each test was watched to fail</h2>
 *
 * <ul>
 *   <li>{@link #aTippedOrderCreditsTipsPayableAndNotRevenue} — remove the
 *       {@code lines.add(line(tag("TIPS_PAYABLE"), ...))} from {@code postOrderRevenue} and the
 *       entry never reaches POSTED at all: the awaitility block times out because
 *       {@code JE_UNBALANCED} rejected it, which is the production symptom. Remove instead the
 *       {@code + payment.tipPaisa()} in {@code addPaymentDebits} and it fails the same way from
 *       the other side.</li>
 *   <li>{@link #anUntippedOrderPostsExactlyWhatItPostedBeforeF20} fails against any change that
 *       emits a zero-valued 2330 line on ordinary orders.</li>
 * </ul>
 *
 * <p>Asserted on {@code journal_lines} read back from Postgres, never on the builder's request
 * list — a builder-level test cannot observe {@code JE_UNBALANCED}, which only fires at commit.
 * That is exactly how the discount defect survived a green suite.
 */
@SpringBootTest(classes = FinanceServiceApplication.class)
class TipPostsToLiabilityIT extends AutoPostingITBase {

    /** Seeded by {@code PakistanRestaurantCoaTemplate}; resolved in the recipe by system tag. */
    private static final String CASH = "1010";
    private static final String BANK = "1110";
    private static final String TIPS_PAYABLE = "2330";
    private static final String OUTPUT_TAX = "2200";
    private static final String REVENUE = "4100";
    private static final String SERVICE_CHARGE = "4910";

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
     * A Rs 1,000.00 dine-in check with a 5% service charge, settled on a card with a Rs 100.00 tip.
     *
     * <pre>
     *   subtotal        100000
     *   serviceCharge     5000  (5% of the net)
     *   total           105000
     *   tip              10000  ← outside the total, on both sides of the entry
     *
     *   DR 1110 Bank        115000   (what actually left the guest's card)
     *   CR 4100 Revenue     100000
     *   CR 4910 Service      5000
     *   CR 2330 Tips        10000   ← a LIABILITY, not income
     *   ─────────────────────────
     *                      115000 = 115000
     * </pre>
     */
    @Test
    void aTippedOrderCreditsTipsPayableAndNotRevenue() throws Exception {
        UUID orderId = UUID.randomUUID();
        publishOrderClosed(orderId, "CARD", 100_000L, 5_000L, 0L, 10_000L);

        Map<String, long[]> lines = awaitPostedRevenueLines(orderId, "tipped-card");

        assertThat(lines.get(BANK))
                .as("the tender debit is what the guest actually parted with: bill + tip")
                .containsExactly(115_000L, 0L);
        assertThat(lines.get(TIPS_PAYABLE))
                .as("the tip is money held for staff — a liability, never sales")
                .containsExactly(0L, 10_000L);
        assertThat(lines.get(REVENUE))
                .as("revenue is the sale alone; a tip inside it would overstate income")
                .containsExactly(0L, 100_000L);
        assertThat(lines.get(SERVICE_CHARGE)).containsExactly(0L, 5_000L);
        assertThat(lines).doesNotContainKey(OUTPUT_TAX);

        assertTotals(lines, 115_000L);
    }

    /** The same, in cash: the drawer is debited, and the tip is still a liability. */
    @Test
    void aCashTipDebitsTheDrawerAndCreditsTheLiability() throws Exception {
        UUID orderId = UUID.randomUUID();
        publishOrderClosed(orderId, "CASH", 80_000L, 0L, 0L, 5_000L);

        Map<String, long[]> lines = awaitPostedRevenueLines(orderId, "tipped-cash");

        assertThat(lines.get(CASH)).containsExactly(85_000L, 0L);
        assertThat(lines.get(TIPS_PAYABLE)).containsExactly(0L, 5_000L);
        assertThat(lines.get(REVENUE)).containsExactly(0L, 80_000L);
        assertTotals(lines, 85_000L);
    }

    /**
     * The untipped path must be untouched, line for line — including the absence of a 2330 line.
     *
     * <p>Every ORDER_CLOSED published before F20 deserialises through {@code PaymentEntry}'s legacy
     * constructor with {@code tipPaisa == 0}, so a replayed old event has to post exactly what it
     * posted before. A zero-valued liability line on every ordinary check would also make the
     * account impossible to read.
     */
    @Test
    void anUntippedOrderPostsExactlyWhatItPostedBeforeF20() throws Exception {
        UUID orderId = UUID.randomUUID();
        publishOrderClosed(orderId, "CASH", 80_000L, 0L, 5_600L, 0L);

        Map<String, long[]> lines = awaitPostedRevenueLines(orderId, "untipped");

        assertThat(lines).doesNotContainKey(TIPS_PAYABLE);
        assertThat(lines.get(CASH)).containsExactly(85_600L, 0L);
        assertThat(lines.get(REVENUE)).containsExactly(0L, 80_000L);
        assertThat(lines.get(OUTPUT_TAX)).containsExactly(0L, 5_600L);
        assertTotals(lines, 85_600L);
    }

    // ── helpers (mirrors DiscountedOrderRevenuePostingIT, deliberately) ────────────────────

    private void assertTotals(Map<String, long[]> lines, long expected) {
        long debits = lines.values().stream().mapToLong(dc -> dc[0]).sum();
        long credits = lines.values().stream().mapToLong(dc -> dc[1]).sum();
        assertThat(debits).isEqualTo(expected);
        assertThat(credits).isEqualTo(expected);
    }

    private Map<String, long[]> awaitPostedRevenueLines(UUID orderId, String label) {
        await().atMost(20, SECONDS).untilAsserted(() -> {
            tenantHelper.activate(tenantId);
            try {
                assertThat(jeRepo.findByTenantIdAndSourceTypeAndSourceId(
                        tenantId, AutoPostingRecipeEngine.SOURCE_ORDER_REVENUE, orderId))
                        .as("no journal entry ever reached the ledger for this order — which is "
                                + "what an unbalanced entry looks like from the outside")
                        .isPresent();
            } finally {
                tenantHelper.clear();
            }
        });

        tenantHelper.activate(tenantId);
        try {
            UUID jeId = jeRepo.findByTenantIdAndSourceTypeAndSourceId(
                    tenantId, AutoPostingRecipeEngine.SOURCE_ORDER_REVENUE, orderId).orElseThrow().getId();

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
     * Built to the contract's money invariant — {@code total == subtotal - discount + tax +
     * serviceCharge} and {@code sum(payments[].amountPaisa) == total} — with the tip DELIBERATELY
     * outside both, because that is exactly what it is.
     */
    private void publishOrderClosed(UUID orderId, String method, long subtotal,
                                    long serviceCharge, long tax, long tip) throws Exception {
        long total = subtotal + tax + serviceCharge;

        EventEnvelope<Object> envelope = new EventEnvelope<>(
                UUID.randomUUID(), PosEventContract.ORDER_CLOSED, tenantId, branchId, Instant.now(),
                UUID.randomUUID(), 1, "pos-service",
                new PosEventContract.OrderClosedPayload(
                        orderId, "ORD-" + orderId, "DINE_IN", null,
                        subtotal, 0L, serviceCharge, tax, total,
                        List.of(new PosEventContract.PaymentEntry(
                                method, total, tip, total + tip, 0L, null)),
                        List.of(new PosEventContract.ItemEntry(
                                UUID.randomUUID(), "Nihari", 1, subtotal, subtotal)),
                        null, null, Instant.now(),
                        BusinessDay.of(Instant.now(), ZoneOffset.UTC)));

        rabbitTemplate.send("pos.topic", PosEventContract.ORDER_CLOSED_KEY,
                new org.springframework.amqp.core.Message(objectMapper.writeValueAsBytes(envelope)));
    }
}
