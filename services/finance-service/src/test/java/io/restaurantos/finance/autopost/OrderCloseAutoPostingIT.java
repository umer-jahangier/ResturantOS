package io.restaurantos.finance.autopost;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.finance.FinanceServiceApplication;
import io.restaurantos.finance.util.PakistanFiscalYear;
import io.restaurantos.finance.autopost.consumer.OrderClosedConsumer;
import io.restaurantos.finance.autopost.consumer.StockDepletedConsumer;
import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.autopost.PostedSourceEventRepository;
import io.restaurantos.finance.autopost.ProcessedEventRepository;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.payload.InventoryEventContract;
import io.restaurantos.shared.event.payload.PosEventContract;
import io.restaurantos.shared.time.BusinessDay;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.Binding;
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
class OrderCloseAutoPostingIT extends AutoPostingITBase {




    @MockitoBean
    private io.restaurantos.shared.idempotency.IdempotencyKeyRepository idempotencyKeyRepository;

    @MockitoBean
    private io.restaurantos.shared.event.OutboxRepository outboxRepository;

    @Autowired private ProvisioningService provisioningService;
    @Autowired private InternalTenantContextHelper tenantHelper;
    @Autowired private JournalEntryRepository jeRepo;
    @Autowired private org.springframework.transaction.PlatformTransactionManager txManager;
    @Autowired private PostedSourceEventRepository postedSourceRepo;
    @Autowired private RabbitTemplate rabbitTemplate;
    @Autowired private AmqpAdmin amqpAdmin;
    @Autowired private ObjectMapper objectMapper;

    private UUID tenantId;
    private UUID branchId;
    private UUID orderId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        orderId = UUID.randomUUID();

        tenantHelper.activate(tenantId);
        try {
            // Events below are stamped Instant.now(), so the periods provisioned here must
            // cover TODAY. A hardcoded year makes this test expire at the FY rollover.
            provisioningService.provision(tenantId, PakistanFiscalYear.current());
        } finally {
            tenantHelper.clear();
        }

    }

    private long[] debitsAndCredits(UUID jeId) {
        return new org.springframework.transaction.support.TransactionTemplate(txManager).execute(status -> {
            var entry = jeRepo.findById(jeId).orElseThrow();
            long debits = entry.getLines().stream().mapToLong(l -> l.getDebitPaisa()).sum();
            long credits = entry.getLines().stream().mapToLong(l -> l.getCreditPaisa()).sum();
            return new long[]{debits, credits};
        });
    }


    @Test
    void orderClosedAndStockDepleted_postBalancedJes_idempotent() throws Exception {
        UUID eventId1 = UUID.randomUUID();
        publishOrderClosed(eventId1);

        await().atMost(15, SECONDS).untilAsserted(() -> {
            tenantHelper.activate(tenantId);
            try {
                var revenueJe = jeRepo.findByTenantIdAndSourceTypeAndSourceId(
                        tenantId, AutoPostingRecipeEngine.SOURCE_ORDER_REVENUE, orderId);
                assertThat(revenueJe).isPresent();
                assertThat(postedSourceRepo.existsByTenantIdAndSourceTypeAndSourceId(
                        tenantId, AutoPostingRecipeEngine.SOURCE_ORDER_REVENUE, orderId))
                        .isTrue();
                // The original test only asserted the revenue JE EXISTS — never that it balances,
                // which is the whole point of double-entry. Assert it here.
                assertThat(revenueJe.get().getStatus()).isEqualTo(JeStatus.POSTED);
                long[] dc = debitsAndCredits(revenueJe.get().getId());
                System.out.printf("[UAT] ORDER_REVENUE je=%s debits=%d credits=%d%n",
                        revenueJe.get().getId(), dc[0], dc[1]);
                assertThat(dc[0]).isEqualTo(dc[1]);
                assertThat(dc[0]).isGreaterThan(0L);
            } finally {
                tenantHelper.clear();
            }
        });

        publishStockDepleted(UUID.randomUUID());

        await().atMost(15, SECONDS).untilAsserted(() -> {
            tenantHelper.activate(tenantId);
            try {
                var cogsJe = jeRepo.findByTenantIdAndSourceTypeAndSourceId(
                        tenantId, AutoPostingRecipeEngine.SOURCE_ORDER_COGS, orderId);
                assertThat(cogsJe).isPresent();
                assertThat(cogsJe.get().getStatus()).isEqualTo(JeStatus.POSTED);
                // JournalEntry.lines is LAZY — read it inside a transaction, not on a detached entity.
                long[] dc = debitsAndCredits(cogsJe.get().getId());
                System.out.printf("[UAT] ORDER_COGS je=%s debits=%d credits=%d%n",
                        cogsJe.get().getId(), dc[0], dc[1]);
                assertThat(dc[0]).isEqualTo(dc[1]);
                assertThat(dc[0]).isGreaterThan(0L);
            } finally {
                tenantHelper.clear();
            }
        });

        publishOrderClosed(eventId1);
        publishOrderClosed(UUID.randomUUID());

        await().atMost(5, SECONDS).untilAsserted(() -> {
            tenantHelper.activate(tenantId);
            try {
                long revenueCount = jeRepo.findAll().stream()
                        .filter(j -> AutoPostingRecipeEngine.SOURCE_ORDER_REVENUE.equals(j.getSourceType())
                                && orderId.equals(j.getSourceId()))
                        .count();
                assertThat(revenueCount).isEqualTo(1);
            } finally {
                tenantHelper.clear();
            }
        });
    }

    /**
     * Built from pos-service's OWN record, so the money invariant the revenue entry depends on —
     * {@code sum(payments[].amountPaisa) == totalPaisa} and
     * {@code totalPaisa == subtotal - discount + tax + serviceCharge} — is expressed in the same
     * types the producer uses. Service charge is deliberately non-zero: it rides on the total, and
     * before the recipe credited it, any service-charged order produced an unbalanceable entry.
     */
    private void publishOrderClosed(UUID eventId) throws Exception {
        long subtotal = 80_000L;
        long tax = 5_600L;
        long serviceCharge = 4_000L;
        long total = subtotal + tax + serviceCharge;

        publish("pos.topic", PosEventContract.ORDER_CLOSED_KEY, eventId,
                PosEventContract.ORDER_CLOSED, "pos-service",
                new PosEventContract.OrderClosedPayload(
                        orderId, "ORD-1", "TAKEAWAY", null,
                        subtotal, 0L, serviceCharge, tax, total,
                        // amountPaisa is what was APPLIED; the customer handed over 1000 paisa more
                        // and got it back as change. Only the applied amount reaches the ledger.
                        List.of(new PosEventContract.PaymentEntry("CASH", total, total + 1_000L, 1_000L, null)),
                        List.of(new PosEventContract.ItemEntry(UUID.randomUUID(), "Nihari", 1, subtotal, subtotal)),
                        null, null, Instant.now(), BusinessDay.of(Instant.now())));
    }

    private void publishStockDepleted(UUID eventId) throws Exception {
        publish("inventory.topic", InventoryEventContract.STOCK_DEPLETED_KEY, eventId,
                InventoryEventContract.STOCK_DEPLETED, "inventory-service",
                new InventoryEventContract.StockDepletedPayload(
                        orderId,
                        List.of(new InventoryEventContract.DepletedLine(
                                UUID.randomUUID(), new BigDecimal("0.8"), 36_000L)),
                        36_000L));
    }

    private void publish(String exchange, String routingKey, UUID eventId,
                         String eventType, String source, Object payload) throws Exception {
        EventEnvelope<Object> envelope = new EventEnvelope<>(
                eventId, eventType, tenantId, branchId, Instant.now(),
                UUID.randomUUID(), 1, source, payload);
        byte[] body = objectMapper.writeValueAsBytes(envelope);
        rabbitTemplate.send(exchange, routingKey, new org.springframework.amqp.core.Message(body));
    }
}
