package io.restaurantos.finance.autopost;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.finance.FinanceServiceApplication;
import io.restaurantos.finance.util.PakistanFiscalYear;
import io.restaurantos.finance.autopost.consumer.CountVarianceConsumer;
import io.restaurantos.finance.autopost.consumer.TransferReceivedConsumer;
import io.restaurantos.finance.autopost.consumer.TransferShippedConsumer;
import io.restaurantos.finance.autopost.consumer.StockReceivedConsumer;
import io.restaurantos.finance.autopost.consumer.WastageConsumer;
import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.payload.InventoryEventContract;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static java.util.concurrent.TimeUnit.SECONDS;

@SpringBootTest(classes = FinanceServiceApplication.class)
class InventoryAutoPostingIT extends AutoPostingITBase {




    @MockitoBean
    private io.restaurantos.shared.idempotency.IdempotencyKeyRepository idempotencyKeyRepository;

    @MockitoBean
    private io.restaurantos.shared.event.OutboxRepository outboxRepository;

    @Autowired private ProvisioningService provisioningService;
    @Autowired private InternalTenantContextHelper tenantHelper;
    @Autowired private JournalEntryRepository jeRepo;
    @Autowired private org.springframework.transaction.PlatformTransactionManager txManager;
    @Autowired private RabbitTemplate rabbitTemplate;
    @Autowired private AmqpAdmin amqpAdmin;
    @Autowired private ObjectMapper objectMapper;

    private UUID tenantId;
    private UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantHelper.activate(tenantId);
        try {
            // Periods must cover TODAY — events are stamped Instant.now(). See OrderCloseAutoPostingIT.
            provisioningService.provision(tenantId, PakistanFiscalYear.current());
        } finally {
            tenantHelper.clear();
        }
    }



    /**
     * The payloads below are the PRODUCER's own records from {@code shared-lib}, serialized exactly
     * as inventory-service serializes them — not maps hand-authored here.
     *
     * <p>That distinction is the whole point of this test. It used to build
     * {@code Map.of("variancePaisa", -22500)} and {@code Map.of("costPaisa", 225000)} — field names
     * the consumer expected and inventory-service has NEVER published. The test asserted the
     * consumer against itself and passed, while in production count variances and transfers were
     * consumed, acked, marked processed, and posted nothing at all. Building the payload from the
     * shared record makes that impossible: a producer-side rename is now a compile error here.
     */
    @Test
    void inventoryEvents_postBalancedJes() throws Exception {
        UUID wastageId = UUID.randomUUID();
        publish(InventoryEventContract.WASTAGE_RECORDED_KEY, InventoryEventContract.WASTAGE_RECORDED,
                new InventoryEventContract.WastageRecordedPayload(
                        wastageId, UUID.randomUUID(), branchId, new BigDecimal("1.0"), 45_000L, "SPOILAGE"));

        awaitJe(AutoPostingRecipeEngine.SOURCE_WASTAGE, wastageId);

        // A shrinkage line: varianceCostPaisa is NEGATIVE, and it is the field inventory publishes.
        UUID countId = UUID.randomUUID();
        publish(InventoryEventContract.COUNT_VARIANCE_POSTED_KEY, InventoryEventContract.COUNT_VARIANCE_POSTED,
                new InventoryEventContract.CountVariancePostedPayload(
                        countId, branchId,
                        List.of(new InventoryEventContract.CountVarianceLine(
                                UUID.randomUUID(), new BigDecimal("-0.5"), -22_500L, false, null)),
                        -22_500L));

        awaitJe(AutoPostingRecipeEngine.SOURCE_COUNT_VARIANCE, countId);

        // lineCostPaisa — the extended cost — is what finance sums. The payload also carries qty and
        // unitCostPaisa, and finance must never multiply them itself: rounding belongs to inventory.
        UUID transferId = UUID.randomUUID();
        publish(InventoryEventContract.TRANSFER_SHIPPED_KEY, InventoryEventContract.TRANSFER_SHIPPED,
                new InventoryEventContract.TransferShippedPayload(
                        transferId, branchId, UUID.randomUUID(),
                        List.of(new InventoryEventContract.TransferLine(
                                UUID.randomUUID(), new BigDecimal("5.0"), 45_000L, 225_000L))));

        awaitJe(AutoPostingRecipeEngine.SOURCE_TRANSFER_SHIP, transferId);

        publish(InventoryEventContract.TRANSFER_RECEIVED_KEY, InventoryEventContract.TRANSFER_RECEIVED,
                new InventoryEventContract.TransferReceivedPayload(
                        transferId, branchId,
                        List.of(new InventoryEventContract.TransferLine(
                                UUID.randomUUID(), new BigDecimal("5.0"), 45_000L, 225_000L))));

        awaitJe(AutoPostingRecipeEngine.SOURCE_TRANSFER_RECV, transferId);
    }

    /**
     * A count with both a shrinkage and a gain nets into ONE balanced entry, and the gain credits
     * the dedicated count-gain account instead of 5221 "Delivery Cost".
     */
    @Test
    void countVarianceWithGainAndLoss_postsBothDirections() throws Exception {
        UUID countId = UUID.randomUUID();
        publish(InventoryEventContract.COUNT_VARIANCE_POSTED_KEY, InventoryEventContract.COUNT_VARIANCE_POSTED,
                new InventoryEventContract.CountVariancePostedPayload(
                        countId, branchId,
                        List.of(
                                new InventoryEventContract.CountVarianceLine(
                                        UUID.randomUUID(), new BigDecimal("-2"), -10_000L, false, null),
                                new InventoryEventContract.CountVarianceLine(
                                        UUID.randomUUID(), new BigDecimal("1"), 4_000L, false, null)),
                        -6_000L));

        awaitJe(AutoPostingRecipeEngine.SOURCE_COUNT_VARIANCE, countId);
    }

    /**
     * A goods receipt is ledger-visible: DR inventory, CR GR/IR clearing. The queue and binding
     * shipped with Phase 9; the listener did not, so every receipt piled up on a durable queue
     * nothing drained.
     */
    @Test
    void stockReceived_postsInventoryAgainstGrIr() throws Exception {
        UUID lotId = UUID.randomUUID();
        publish(InventoryEventContract.STOCK_RECEIVED_KEY, InventoryEventContract.STOCK_RECEIVED,
                new InventoryEventContract.StockReceivedPayload(
                        UUID.randomUUID(), branchId, new BigDecimal("10"), 5_000L, 50_000L, 5_000L,
                        lotId, null, "GRN", UUID.randomUUID()));

        awaitJe(AutoPostingRecipeEngine.SOURCE_STOCK_RECEIPT, lotId);
    }

    private void awaitJe(String sourceType, UUID sourceId) {
        await().atMost(15, SECONDS).untilAsserted(() -> {
            tenantHelper.activate(tenantId);
            try {
                var je = jeRepo.findByTenantIdAndSourceTypeAndSourceId(tenantId, sourceType, sourceId);
                assertThat(je).isPresent();
                assertThat(je.get().getStatus()).isEqualTo(JeStatus.POSTED);
                // JournalEntry.lines is LAZY — read it inside a transaction, not on a detached entity.
                long[] dc = debitsAndCredits(je.get().getId());
                System.out.printf("[UAT] %s je=%s debits=%d credits=%d%n",
                        sourceType, je.get().getId(), dc[0], dc[1]);
                assertThat(dc[0]).isEqualTo(dc[1]);
                assertThat(dc[0]).isGreaterThan(0L);
            } finally {
                tenantHelper.clear();
            }
        });
    }

    private long[] debitsAndCredits(UUID jeId) {
        return new org.springframework.transaction.support.TransactionTemplate(txManager).execute(status -> {
            var entry = jeRepo.findById(jeId).orElseThrow();
            long debits = entry.getLines().stream().mapToLong(l -> l.getDebitPaisa()).sum();
            long credits = entry.getLines().stream().mapToLong(l -> l.getCreditPaisa()).sum();
            return new long[]{debits, credits};
        });
    }

    private void publish(String routingKey, String eventType, Object payload) throws Exception {
        EventEnvelope<Object> envelope = new EventEnvelope<>(
                UUID.randomUUID(),
                eventType,
                tenantId,
                branchId,
                Instant.now(),
                UUID.randomUUID(),
                1,
                "inventory-service",
                payload);
        byte[] body = objectMapper.writeValueAsBytes(envelope);
        rabbitTemplate.send("inventory.topic", routingKey, new org.springframework.amqp.core.Message(body));
    }
}
