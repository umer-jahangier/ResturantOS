package io.restaurantos.finance.autopost;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.finance.FinanceServiceApplication;
import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.finance.util.PakistanFiscalYear;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.payload.InventoryEventContract;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * COGS posts to the account each ingredient's CATEGORY names, not to one global bucket.
 *
 * <p>Phase 08.2 gave {@code ItemCategory} three GL account slots — inventory, cost, waste — with a
 * validating finance proxy and a management screen. Nothing ever read them: every COGS entry went
 * to the single tenant-wide {@code COGS} tag, so a restaurant that had carefully mapped Beverages
 * to 5200 and Packaging to 5210 watched all of it land in 5100 Food Cost.
 *
 * <p>inventory-service resolves the codes — it owns the taxonomy — and stamps them on each
 * depleted line, so finance groups by account without learning anything about categories.
 */
@SpringBootTest(classes = FinanceServiceApplication.class)
class CategoryCogsPostingIT extends AutoPostingITBase {

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

    @Test
    void linesCarryingCategoryAccounts_postAgainstThoseAccounts_groupedNotPerIngredient() throws Exception {
        UUID orderId = UUID.randomUUID();

        // Two ingredients share the Beverages cost account, a third uses Packaging. The entry
        // should therefore have two DR/CR pairs, not three — grouping keeps a 40-ingredient order
        // from producing an 80-line journal entry.
        publish(orderId, List.of(
                new InventoryEventContract.DepletedLine(
                        UUID.randomUUID(), new BigDecimal("1"), 30_000L, "5200", "1300"),
                new InventoryEventContract.DepletedLine(
                        UUID.randomUUID(), new BigDecimal("2"), 20_000L, "5200", "1300"),
                new InventoryEventContract.DepletedLine(
                        UUID.randomUUID(), new BigDecimal("3"), 10_000L, "5210", "1300")),
                60_000L);

        UUID jeId = awaitJe(orderId);
        Map<String, long[]> byAccount = linesByAccount(jeId);

        assertThat(byAccount.get("5200")).as("Beverages cost, both lines summed")
                .containsExactly(50_000L, 0L);
        assertThat(byAccount.get("5210")).as("Packaging cost")
                .containsExactly(10_000L, 0L);
        assertThat(byAccount.get("1300")).as("Inventory credited once for the whole order")
                .containsExactly(0L, 60_000L);
        assertThat(byAccount).as("one pair per distinct account pair, not per ingredient")
                .hasSize(3);
    }

    /**
     * A category that names no account — or an ingredient whose category was archived — falls back
     * to the tenant-wide tags. A missing cost-centre mapping must never stop a sale from posting.
     */
    @Test
    void unmappedLines_fallBackToTheTenantWideTags() throws Exception {
        UUID orderId = UUID.randomUUID();

        publish(orderId, List.of(
                new InventoryEventContract.DepletedLine(UUID.randomUUID(), new BigDecimal("1"), 25_000L),
                new InventoryEventContract.DepletedLine(
                        UUID.randomUUID(), new BigDecimal("1"), 15_000L, "5200", "1300")),
                40_000L);

        Map<String, long[]> byAccount = linesByAccount(awaitJe(orderId));

        // 5100 is the seeded COGS tag; the mapped line still goes to 5200.
        assertThat(byAccount.get("5100")).containsExactly(25_000L, 0L);
        assertThat(byAccount.get("5200")).containsExactly(15_000L, 0L);
    }

    /** A payload with no line breakdown at all still posts, using the tenant-wide tags. */
    @Test
    void payloadWithNoLines_stillPostsTheHeaderTotal() throws Exception {
        UUID orderId = UUID.randomUUID();
        publish(orderId, List.of(), 12_345L);

        Map<String, long[]> byAccount = linesByAccount(awaitJe(orderId));
        assertThat(byAccount.get("5100")).containsExactly(12_345L, 0L);
    }

    private UUID awaitJe(UUID orderId) {
        await().atMost(20, SECONDS).untilAsserted(() -> {
            tenantHelper.activate(tenantId);
            try {
                assertThat(jeRepo.findByTenantIdAndSourceTypeAndSourceId(
                        tenantId, AutoPostingRecipeEngine.SOURCE_ORDER_COGS, orderId)).isPresent();
            } finally {
                tenantHelper.clear();
            }
        });
        return new TransactionTemplate(txManager).execute(status -> {
            tenantHelper.activate(tenantId);
            try {
                return jeRepo.findByTenantIdAndSourceTypeAndSourceId(
                        tenantId, AutoPostingRecipeEngine.SOURCE_ORDER_COGS, orderId).orElseThrow().getId();
            } finally {
                tenantHelper.clear();
            }
        });
    }

    /** account code -> {debit, credit}. */
    private Map<String, long[]> linesByAccount(UUID jeId) {
        return new TransactionTemplate(txManager).execute(status -> {
            var entry = jeRepo.findById(jeId).orElseThrow();
            return entry.getLines().stream().collect(Collectors.toMap(
                    l -> l.getAccountCode(),
                    l -> new long[]{l.getDebitPaisa(), l.getCreditPaisa()},
                    (a, b) -> new long[]{a[0] + b[0], a[1] + b[1]}));
        });
    }

    private void publish(UUID orderId, List<InventoryEventContract.DepletedLine> lines, long total)
            throws Exception {
        EventEnvelope<Object> envelope = new EventEnvelope<>(
                UUID.randomUUID(), InventoryEventContract.STOCK_DEPLETED, tenantId, branchId,
                Instant.now(), UUID.randomUUID(), 1, "inventory-service",
                new InventoryEventContract.StockDepletedPayload(orderId, lines, total));
        rabbitTemplate.send(InventoryEventContract.EXCHANGE, InventoryEventContract.STOCK_DEPLETED_KEY,
                new org.springframework.amqp.core.Message(objectMapper.writeValueAsBytes(envelope)));
    }
}
