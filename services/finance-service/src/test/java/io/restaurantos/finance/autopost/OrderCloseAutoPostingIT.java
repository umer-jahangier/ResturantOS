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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static java.util.concurrent.TimeUnit.SECONDS;

@SpringBootTest(classes = FinanceServiceApplication.class)
@Testcontainers
class OrderCloseAutoPostingIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                    .withDatabaseName("finance_db")
                    .withUsername("finance_user")
                    .withPassword("finance_pass");

    @Container
    static final RabbitMQContainer RABBIT =
            new RabbitMQContainer(DockerImageName.parse("rabbitmq:3.12-management"));

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.flyway.enabled", () -> "true");
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        r.add("eureka.client.enabled", () -> "false");
        r.add("spring.cloud.config.enabled", () -> "false");
        // @EnableRabbit starts all 7 consumers' listeners at context startup, before the
        // test declares its topology. Listeners for queues this test does not declare must
        // not abort startup; they retry and attach if/when the queue appears.
        r.add("spring.rabbitmq.listener.simple.missing-queues-fatal", () -> "false");
        r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

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

        declareTopology();
    }

    private long[] debitsAndCredits(UUID jeId) {
        return new org.springframework.transaction.support.TransactionTemplate(txManager).execute(status -> {
            var entry = jeRepo.findById(jeId).orElseThrow();
            long debits = entry.getLines().stream().mapToLong(l -> l.getDebitPaisa()).sum();
            long credits = entry.getLines().stream().mapToLong(l -> l.getCreditPaisa()).sum();
            return new long[]{debits, credits};
        });
    }

    private void declareTopology() {
        amqpAdmin.declareExchange(new TopicExchange("pos.topic", true, false));
        amqpAdmin.declareExchange(new TopicExchange("inventory.topic", true, false));

        amqpAdmin.declareQueue(new Queue(OrderClosedConsumer.QUEUE_NAME, true));
        amqpAdmin.declareBinding(BindingBuilder.bind(new Queue(OrderClosedConsumer.QUEUE_NAME))
                .to(new TopicExchange("pos.topic")).with("pos.order.closed"));

        amqpAdmin.declareQueue(new Queue(StockDepletedConsumer.QUEUE_NAME, true));
        amqpAdmin.declareBinding(BindingBuilder.bind(new Queue(StockDepletedConsumer.QUEUE_NAME))
                .to(new TopicExchange("inventory.topic")).with("inventory.stock.depleted"));
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

    private void publishOrderClosed(UUID eventId) throws Exception {
        EventEnvelope<Map<String, Object>> envelope = new EventEnvelope<>(
                eventId,
                "ORDER_CLOSED",
                tenantId,
                branchId,
                Instant.now(),
                UUID.randomUUID(),
                1,
                "pos-service",
                Map.of(
                        "orderId", orderId.toString(),
                        "subtotalPaisa", 80000,
                        "discountPaisa", 0,
                        "taxPaisa", 5600,
                        "totalPaisa", 85600,
                        "payments", List.of(Map.of("method", "CASH", "amountPaisa", 85600))
                ));
        byte[] body = objectMapper.writeValueAsBytes(envelope);
        rabbitTemplate.send("pos.topic", "pos.order.closed", new org.springframework.amqp.core.Message(body));
    }

    private void publishStockDepleted(UUID eventId) throws Exception {
        EventEnvelope<Map<String, Object>> envelope = new EventEnvelope<>(
                eventId,
                "STOCK_DEPLETED",
                tenantId,
                branchId,
                Instant.now(),
                UUID.randomUUID(),
                1,
                "inventory-service",
                Map.of(
                        "orderId", orderId.toString(),
                        "totalCogsPaisa", 36000,
                        "lines", List.of(Map.of("ingredientId", UUID.randomUUID().toString(),
                                "qty", 0.8, "cogsPaisa", 36000))
                ));
        byte[] body = objectMapper.writeValueAsBytes(envelope);
        rabbitTemplate.send("inventory.topic", "inventory.stock.depleted",
                new org.springframework.amqp.core.Message(body));
    }
}
