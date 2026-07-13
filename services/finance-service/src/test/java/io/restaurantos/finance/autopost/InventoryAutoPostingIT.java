package io.restaurantos.finance.autopost;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.finance.FinanceServiceApplication;
import io.restaurantos.finance.util.PakistanFiscalYear;
import io.restaurantos.finance.autopost.consumer.CountVarianceConsumer;
import io.restaurantos.finance.autopost.consumer.TransferReceivedConsumer;
import io.restaurantos.finance.autopost.consumer.TransferShippedConsumer;
import io.restaurantos.finance.autopost.consumer.WastageConsumer;
import io.restaurantos.finance.config.InternalTenantContextHelper;
import io.restaurantos.finance.domain.enums.JeStatus;
import io.restaurantos.finance.repository.JournalEntryRepository;
import io.restaurantos.finance.service.ProvisioningService;
import io.restaurantos.shared.event.EventEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.AmqpAdmin;
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
class InventoryAutoPostingIT {

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
        // See OrderCloseAutoPostingIT: listeners for undeclared queues must not abort startup.
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
        declareTopology();
    }

    private void declareTopology() {
        amqpAdmin.declareExchange(new TopicExchange("inventory.topic", true, false));
        bind(WastageConsumer.QUEUE_NAME, "inventory.wastage.recorded");
        bind(CountVarianceConsumer.QUEUE_NAME, "inventory.count.variance");
        bind(TransferShippedConsumer.QUEUE_NAME, "inventory.transfer.shipped");
        bind(TransferReceivedConsumer.QUEUE_NAME, "inventory.transfer.received");
    }

    private void bind(String queueName, String routingKey) {
        amqpAdmin.declareQueue(new Queue(queueName, true));
        amqpAdmin.declareBinding(BindingBuilder.bind(new Queue(queueName))
                .to(new TopicExchange("inventory.topic")).with(routingKey));
    }

    @Test
    void inventoryEvents_postBalancedJes() throws Exception {
        UUID wastageId = UUID.randomUUID();
        publish("inventory.wastage.recorded", "WASTAGE_RECORDED", Map.of(
                "wastageId", wastageId.toString(),
                "ingredientId", UUID.randomUUID().toString(),
                "qty", 1.0,
                "costPaisa", 45000,
                "reason", "SPOILAGE"));

        awaitJe(AutoPostingRecipeEngine.SOURCE_WASTAGE, wastageId);

        UUID countId = UUID.randomUUID();
        publish("inventory.count.variance", "COUNT_VARIANCE_POSTED", Map.of(
                "countId", countId.toString(),
                "lines", List.of(Map.of(
                        "ingredientId", UUID.randomUUID().toString(),
                        "systemQty", 10.0,
                        "countedQty", 9.5,
                        "varianceQty", -0.5,
                        "variancePaisa", -22500))));

        awaitJe(AutoPostingRecipeEngine.SOURCE_COUNT_VARIANCE, countId);

        UUID transferId = UUID.randomUUID();
        publish("inventory.transfer.shipped", "TRANSFER_SHIPPED", Map.of(
                "transferId", transferId.toString(),
                "fromBranchId", branchId.toString(),
                "toBranchId", UUID.randomUUID().toString(),
                "lines", List.of(Map.of(
                        "ingredientId", UUID.randomUUID().toString(),
                        "qty", 5.0,
                        "costPaisa", 225000))));

        awaitJe(AutoPostingRecipeEngine.SOURCE_TRANSFER_SHIP, transferId);

        publish("inventory.transfer.received", "TRANSFER_RECEIVED", Map.of(
                "transferId", transferId.toString(),
                "toBranchId", branchId.toString(),
                "lines", List.of(Map.of(
                        "ingredientId", UUID.randomUUID().toString(),
                        "qtyReceived", 5.0,
                        "costPaisa", 225000))));

        awaitJe(AutoPostingRecipeEngine.SOURCE_TRANSFER_RECV, transferId);
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

    private void publish(String routingKey, String eventType, Map<String, Object> payload) throws Exception {
        EventEnvelope<Map<String, Object>> envelope = new EventEnvelope<>(
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
