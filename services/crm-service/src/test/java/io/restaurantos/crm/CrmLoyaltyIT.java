package io.restaurantos.crm;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.crm.consumer.OrderClosedLoyaltyConsumer;
import io.restaurantos.crm.consumer.OrderRefundedLoyaltyConsumer;
import io.restaurantos.crm.dto.CrmDtos.CreateCustomerRequest;
import io.restaurantos.crm.entity.LoyaltyAccountEntity;
import io.restaurantos.crm.repository.LoyaltyAccountRepository;
import io.restaurantos.crm.repository.LoyaltyTransactionRepository;
import io.restaurantos.crm.service.CustomerService;
import io.restaurantos.crm.service.LoyaltyService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.persistence.EntityManager;
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
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static java.util.concurrent.TimeUnit.SECONDS;

@SpringBootTest(classes = CrmServiceApplication.class)
@Testcontainers
class CrmLoyaltyIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                    .withDatabaseName("crm_db")
                    .withUsername("crm_user")
                    .withPassword("crm_pass");

    @Container
    static final RabbitMQContainer RABBIT =
            new RabbitMQContainer(DockerImageName.parse("rabbitmq:3.12-management"));

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.liquibase.contexts", () -> "");
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        r.add("eureka.client.enabled", () -> "false");
        // Consumer listeners start with the context, before this test declares its topology.
        r.add("spring.rabbitmq.listener.simple.missing-queues-fatal", () -> "false");
        r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

    @Autowired private CustomerService customerService;
    @Autowired private LoyaltyService loyaltyService;
    @Autowired private LoyaltyAccountRepository loyaltyAccountRepo;
    @Autowired private LoyaltyTransactionRepository txRepo;
    @Autowired private TenantContext tenantContext;
    @Autowired private EntityManager entityManager;
    @Autowired private RabbitTemplate rabbitTemplate;
    @Autowired private AmqpAdmin amqpAdmin;
    @Autowired private ObjectMapper objectMapper;

    private UUID tenantId;
    private UUID customerId;
    private UUID orderId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        orderId = UUID.randomUUID();
        setRls(tenantId);
        tenantContext.set(tenantId, null, null, null);
        loyaltyService.ensureTierConfig(tenantId);
        customerId = customerService.create(new CreateCustomerRequest("+923001234567", "Ali Khan", null, null)).id();
        declareTopology();
    }

    private void declareTopology() {
        amqpAdmin.declareExchange(new TopicExchange("pos.topic", true, false));
        amqpAdmin.declareQueue(new Queue(OrderClosedLoyaltyConsumer.QUEUE_NAME, true));
        amqpAdmin.declareBinding(BindingBuilder.bind(new Queue(OrderClosedLoyaltyConsumer.QUEUE_NAME))
                .to(new TopicExchange("pos.topic")).with("pos.order.closed"));
        amqpAdmin.declareQueue(new Queue(OrderRefundedLoyaltyConsumer.QUEUE_NAME, true));
        amqpAdmin.declareBinding(BindingBuilder.bind(new Queue(OrderRefundedLoyaltyConsumer.QUEUE_NAME))
                .to(new TopicExchange("pos.topic")).with("pos.order.refunded"));
    }

    @Test
    void orderClosed_accruesPoints_tierUpgrade_refundDebits_dedup() throws Exception {
        UUID eventId = UUID.randomUUID();
        publishOrderClosed(eventId, 6_000_000);

        await().atMost(15, SECONDS).untilAsserted(() -> {
            setRls(tenantId);
            tenantContext.set(tenantId, null, null, null);
            LoyaltyAccountEntity account = loyaltyAccountRepo.findByCustomerId(customerId).orElseThrow();
            assertThat(account.getPointsBalance()).isEqualTo(60_000);
            assertThat(account.getLifetimeSpendPaisa()).isEqualTo(6_000_000);
            assertThat(account.getTier()).isEqualTo("SILVER");
        });

        publishOrderClosed(eventId, 6_000_000);
        await().atMost(3, SECONDS).pollDelay(500, java.util.concurrent.TimeUnit.MILLISECONDS).untilAsserted(() -> {
            setRls(tenantId);
            tenantContext.set(tenantId, null, null, null);
            assertThat(txRepo.count()).isEqualTo(1);
        });

        publishOrderRefunded(UUID.randomUUID(), 1_000_000);
        await().atMost(15, SECONDS).untilAsserted(() -> {
            setRls(tenantId);
            tenantContext.set(tenantId, null, null, null);
            LoyaltyAccountEntity account = loyaltyAccountRepo.findByCustomerId(customerId).orElseThrow();
            assertThat(account.getPointsBalance()).isLessThan(60_000);
        });
    }

    private void publishOrderClosed(UUID eventId, long totalPaisa) throws Exception {
        EventEnvelope<Map<String, Object>> envelope = new EventEnvelope<>(
                eventId, "ORDER_CLOSED", tenantId, UUID.randomUUID(), Instant.now(),
                UUID.randomUUID(), 1, "pos-service",
                Map.of("orderId", orderId.toString(), "customerId", customerId.toString(), "totalPaisa", totalPaisa));
        rabbitTemplate.send("pos.topic", "pos.order.closed",
                new org.springframework.amqp.core.Message(objectMapper.writeValueAsBytes(envelope)));
    }

    private void publishOrderRefunded(UUID eventId, long refundPaisa) throws Exception {
        EventEnvelope<Map<String, Object>> envelope = new EventEnvelope<>(
                eventId, "ORDER_REFUNDED", tenantId, UUID.randomUUID(), Instant.now(),
                UUID.randomUUID(), 1, "pos-service",
                Map.of("orderId", orderId.toString(), "customerId", customerId.toString(), "refundPaisa", refundPaisa));
        rabbitTemplate.send("pos.topic", "pos.order.refunded",
                new org.springframework.amqp.core.Message(objectMapper.writeValueAsBytes(envelope)));
    }

    private void setRls(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, false)")
                .setParameter("tid", tenantId.toString())
                .getSingleResult();
    }
}
